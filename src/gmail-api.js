// Gmail inside Roost, through Google's official Gmail API.
//
// Sign-in uses Google's approved flow for desktop apps: the user's own browser opens Google's
// sign-in page, and Google sends a one-time code back to a local address on this computer
// (OAuth 2.0 "loopback" flow with PKCE). Roost never sees the password.
// The refresh token is stored encrypted with the macOS Keychain (Electron safeStorage).
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { EventEmitter } = require('events');

const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const ENDPOINTS = {
  auth: process.env.ROOST_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth',
  token: process.env.ROOST_GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  revoke: process.env.ROOST_GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  api: process.env.ROOST_GMAIL_API_BASE || 'https://gmail.googleapis.com',
};
const POLL_MS = Number(process.env.ROOST_GMAIL_POLL_MS || 60000);
const MAX_SEND_BYTES = 20 * 1024 * 1024;

// ---------- small helpers (exported for tests) ----------

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function decodeBytes(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(buf); } catch { return buf.toString('utf8'); }
}

// RFC 2047 encoded words: =?UTF-8?B?...?= and =?ISO-8859-1?Q?...?=
function decodeWords(value) {
  if (!value || !value.includes('=?')) return value || '';
  return String(value)
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_m, charset, enc, text) => {
      let bytes;
      if (enc.toUpperCase() === 'B') bytes = Buffer.from(text, 'base64');
      else {
        const s = text.replace(/_/g, ' ');
        const out = [];
        for (let i = 0; i < s.length; i++) {
          if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) { out.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2; }
          else out.push(s.charCodeAt(i));
        }
        bytes = Buffer.from(out);
      }
      return decodeBytes(bytes, charset.split('*')[0]);
    });
}

function parseAddress(value) {
  const v = decodeWords(value).trim();
  const m = v.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim() };
  return { name: v, email: v };
}

// Split an address list on commas that are not inside quotes or angle brackets.
function splitAddresses(value) {
  const out = [];
  let cur = '';
  let quote = false;
  let angle = 0;
  for (const ch of decodeWords(value || '')) {
    if (ch === '"') quote = !quote;
    if (!quote && ch === '<') angle++;
    if (!quote && ch === '>') angle = Math.max(0, angle - 1);
    if (ch === ',' && !quote && !angle) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const header = (headers, name) => {
  const h = (headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : '';
};
const charsetOf = (part) => (header(part.headers, 'Content-Type').match(/charset="?([^";\s]+)/i) || [])[1];

// Walk a Gmail "full" payload: text, html, attachments and inline (cid:) images.
function parsePayload(payload) {
  const out = { text: null, html: null, attachments: [], inline: [] };
  const walk = (part) => {
    if (!part) return;
    const type = String(part.mimeType || '').toLowerCase();
    const disposition = header(part.headers, 'Content-Disposition').toLowerCase();
    const cid = header(part.headers, 'Content-ID').replace(/^<|>$/g, '');
    if (part.parts && part.parts.length) { part.parts.forEach(walk); return; }
    const isAttachment = part.filename || disposition.startsWith('attachment');
    if (!isAttachment && type === 'text/plain' && out.text === null && part.body?.data) {
      out.text = decodeBytes(fromB64url(part.body.data), charsetOf(part));
    } else if (!isAttachment && type === 'text/html' && out.html === null && part.body?.data) {
      out.html = decodeBytes(fromB64url(part.body.data), charsetOf(part));
    } else if (cid && type.startsWith('image/') && !disposition.startsWith('attachment')) {
      out.inline.push({ cid, mimeType: type, attachmentId: part.body?.attachmentId || null, data: part.body?.data || null, size: part.body?.size || 0 });
    } else if (part.filename || part.body?.attachmentId) {
      out.attachments.push({
        id: part.body?.attachmentId || null, filename: decodeWords(part.filename) || 'attachment', mimeType: type, size: part.body?.size || 0,
        data: part.body?.attachmentId ? null : part.body?.data || null,
      });
    }
  };
  walk(payload);
  return out;
}

function encodeHeaderValue(v) {
  const s = String(v || '').replace(/[\r\n]+/g, ' ');
  return /[^\x20-\x7E]/.test(s) ? `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=` : s;
}
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();

// Build an RFC 2822 message (plain text body, optional attachments).
function buildRawMessage({ from, to, cc, bcc, subject, body, inReplyTo, references, attachments = [] }) {
  const lines = [];
  const push = (name, value) => { if (value) lines.push(`${name}: ${value}`); };
  push('From', from);
  push('To', to);
  push('Cc', cc);
  push('Bcc', bcc);
  push('Subject', encodeHeaderValue(subject || ''));
  push('In-Reply-To', inReplyTo);
  push('References', references);
  push('MIME-Version', '1.0');
  const textPart = ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '',
    wrap76(Buffer.from(String(body || '').replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64'))];
  if (!attachments.length) return [...lines, ...textPart].join('\r\n');
  const boundary = `roost_${crypto.randomBytes(12).toString('hex')}`;
  const out = [...lines, `Content-Type: multipart/mixed; boundary="${boundary}"`, '', `--${boundary}`, ...textPart];
  for (const a of attachments) {
    const safe = String(a.filename).replace(/["\r\n]/g, '_');
    const name = /[^\x20-\x7E]/.test(safe) ? `filename*=UTF-8''${encodeURIComponent(safe)}` : `filename="${safe}"`;
    out.push(`--${boundary}`, `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${safe.replace(/[^\x20-\x7E]/g, '_')}"`,
      `Content-Disposition: attachment; ${name}`, 'Content-Transfer-Encoding: base64', '', wrap76(a.data.toString('base64')));
  }
  out.push(`--${boundary}--`, '');
  return out.join('\r\n');
}

const MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', html: 'text/html', zip: 'application/zip', json: 'application/json',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', mp4: 'video/mp4', mov: 'video/quicktime', heic: 'image/heic', svg: 'image/svg+xml',
};
const mimeOf = (file) => MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const INBOX_CATEGORIES = { promotions: 'CATEGORY_PROMOTIONS', social: 'CATEGORY_SOCIAL', updates: 'CATEGORY_UPDATES', forums: 'CATEGORY_FORUMS' };

class ApiError extends Error {
  constructor(message, { status, needsSignIn = false, needsSetup = false, apiDisabled = false } = {}) {
    super(message);
    this.status = status;
    this.needsSignIn = needsSignIn;
    this.needsSetup = needsSetup;
    this.apiDisabled = apiDisabled;
  }
}

// ---------- secure storage of the Google key and per-account tokens ----------

class GmailStore {
  constructor(file, safeStorage) {
    this.file = file;
    this.safe = !process.env.ROOST_PLAIN_TOKENS && safeStorage && safeStorage.isEncryptionAvailable() ? safeStorage : null;
    this.data = { client: null, accounts: {} };
    try { this.data = { client: null, accounts: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* first run */ }
  }

  enc(text) { return this.safe ? `enc:${this.safe.encryptString(text).toString('base64')}` : `plain:${text}`; }

  dec(value) {
    if (!value) return null;
    if (value.startsWith('plain:')) return value.slice(6);
    if (value.startsWith('enc:') && this.safe) {
      try { return this.safe.decryptString(Buffer.from(value.slice(4), 'base64')); } catch { return null; }
    }
    return null;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  getClient() {
    const c = this.data.client;
    if (!c || !c.id) return null;
    return { id: c.id, secret: this.dec(c.secret) || '' };
  }

  setClient(id, secret) { this.data.client = { id, secret: this.enc(secret) }; this.save(); }

  getAccount(serviceId) {
    const a = this.data.accounts[serviceId];
    if (!a) return null;
    return { email: a.email, refreshToken: this.dec(a.refresh) };
  }

  setAccount(serviceId, { email, refreshToken }) {
    this.data.accounts[serviceId] = { email, refresh: this.enc(refreshToken) };
    this.save();
  }

  removeAccount(serviceId) { delete this.data.accounts[serviceId]; this.save(); }

  accountIds() { return Object.keys(this.data.accounts); }
}

// ---------- one Google account (one Roost app tile): sign-in, tokens, REST ----------

class GoogleAccount extends EventEmitter {
  constructor({ serviceId, store, deps, scope = SCOPE, apiBase = ENDPOINTS.api, expectEmail = '' }) {
    super();
    this.expectEmail = String(expectEmail || '').toLowerCase(); // set: only this Google account may sign in here
    this.scope = scope;
    this.apiBase = apiBase;
    this.apiDisabledText = 'This Google API is not turned on for your Google key. Turn it on in Google Cloud.';
    this.serviceId = serviceId;
    this.store = store;
    this.deps = deps; // { openExternal, showOpenDialog, showSaveDialog, readFile }
    this.access = null; // { token, expires }
    this.signInAbort = null;
    this.pollTimer = null;
    this.historyId = null;
    this.unread = 0;
  }

  account() { return this.store.getAccount(this.serviceId); }

  status() {
    const client = this.store.getClient();
    const acc = this.account();
    return {
      configured: !!client, signedIn: !!(client && acc && acc.refreshToken), email: acc ? acc.email : null,
      expectEmail: this.expectEmail || null,
    };
  }

  // ----- OAuth -----

  async signIn() {
    const client = this.store.getClient();
    if (!client) throw new ApiError('Add your Google key first.', { needsSetup: true });
    if (this.signInAbort) this.signInAbort();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const stateParam = b64url(crypto.randomBytes(16));

    let redirect = '';
    const { code, redirectUri } = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
        const err = url.searchParams.get('error');
        const got = url.searchParams.get('code');
        const okState = url.searchParams.get('state') === stateParam;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><meta charset="utf-8"><title>Roost</title><body style="font:16px -apple-system,sans-serif;
display:grid;place-items:center;height:90vh;background:#15151c;color:#ececf1"><div style="text-align:center">
<h2>${got && okState ? 'Signed in to Roost' : 'Sign-in did not finish'}</h2><p style="color:#9a9aab">You can close this tab and go back to Roost.</p></div>`);
        cleanup();
        if (err) reject(new ApiError(err === 'access_denied' ? 'Sign-in was cancelled.' : `Google said: ${err}`));
        else if (!got || !okState) reject(new ApiError('Sign-in did not finish. Please try again.'));
        else resolve({ code: got, redirectUri: redirect });
      });
      const timer = setTimeout(() => { cleanup(); reject(new ApiError('Sign-in timed out. Please try again.')); }, 5 * 60 * 1000);
      const cleanup = () => { clearTimeout(timer); server.close(); this.signInAbort = null; };
      this.signInAbort = () => { cleanup(); reject(new ApiError('Sign-in was cancelled.')); };
      server.on('error', (e) => { cleanup(); reject(e); });
      server.listen(0, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${server.address().port}/`;
        const q = new URLSearchParams({
          client_id: client.id, redirect_uri: redirect, response_type: 'code', scope: this.scope,
          code_challenge: challenge, code_challenge_method: 'S256', state: stateParam,
          access_type: 'offline', prompt: 'consent select_account',
        });
        const acc = this.account();
        const hint = (acc && acc.email) || this.expectEmail;
        if (hint) q.set('login_hint', hint);
        this.deps.openExternal(`${ENDPOINTS.auth}?${q}`);
      });
    });

    const tokens = await this.tokenRequest({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri,
      client_id: client.id, client_secret: client.secret,
    });
    if (!tokens.refresh_token) throw new ApiError('Google did not give a long-term key. Please try again.');
    this.access = { token: tokens.access_token, expires: Date.now() + (tokens.expires_in - 60) * 1000 };
    this.store.setAccount(this.serviceId, { email: '', refreshToken: tokens.refresh_token });
    const email = await this.fetchEmail().catch((err) => { this.store.removeAccount(this.serviceId); throw err; });
    if (this.expectEmail && String(email).toLowerCase() !== this.expectEmail) {
      // The user picked another Google account. This tile belongs to expectEmail: drop the key.
      // (No revoke: revoking would also end that account's other sign-ins in Roost.)
      this.access = null;
      this.store.removeAccount(this.serviceId);
      throw new ApiError(`You signed in as ${email}. Please sign in as ${this.expectEmail}.`);
    }
    this.store.setAccount(this.serviceId, { email, refreshToken: tokens.refresh_token });
    this.emit('auth', this.status());
    this.startPolling();
    return { email };
  }

  cancelSignIn() { if (this.signInAbort) this.signInAbort(); }

  async tokenRequest(params) {
    const res = await fetch(ENDPOINTS.token, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (json.error === 'invalid_grant') throw new ApiError('Your Google sign-in expired. Please sign in again.', { status: 400, needsSignIn: true });
      if (json.error === 'invalid_client') throw new ApiError('Google did not accept the key (Client ID / secret). Check them in setup.', { status: 401, needsSetup: true });
      throw new ApiError(json.error_description || json.error || `Google sign-in failed (${res.status}).`, { status: res.status });
    }
    return json;
  }

  async accessToken(force = false) {
    if (!force && this.access && this.access.expires > Date.now()) return this.access.token;
    const client = this.store.getClient();
    const acc = this.account();
    if (!client) throw new ApiError('Add your Google key first.', { needsSetup: true });
    if (!acc || !acc.refreshToken) throw new ApiError('Please sign in.', { needsSignIn: true });
    try {
      const t = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: acc.refreshToken, client_id: client.id, client_secret: client.secret });
      this.access = { token: t.access_token, expires: Date.now() + (t.expires_in - 60) * 1000 };
      return this.access.token;
    } catch (err) {
      if (err.needsSignIn) { this.forgetTokens(); }
      throw err;
    }
  }

  forgetTokens() {
    const acc = this.account();
    this.access = null;
    this.stopPolling();
    if (acc) this.store.setAccount(this.serviceId, { email: acc.email, refreshToken: '' });
    this.emit('auth', this.status());
    this.setUnread(0);
  }

  async signOut({ revoke = true } = {}) {
    const acc = this.account();
    this.stopPolling();
    if (revoke && acc && acc.refreshToken) {
      await fetch(`${ENDPOINTS.revoke}?token=${encodeURIComponent(acc.refreshToken)}`, { method: 'POST' }).catch(() => {});
    }
    this.access = null;
    this.store.removeAccount(this.serviceId);
    this.setUnread(0);
    this.emit('auth', this.status());
  }

  // ----- REST -----

  async api(method, apiPath, { query, body, retried = false } = {}) {
    const token = await this.accessToken();
    const url = new URL(this.apiBase + apiPath);
    for (const [k, v] of Object.entries(query || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      this.access = null;
      return this.api(method, apiPath, { query, body, retried: true });
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json.error?.message || `Gmail error ${res.status}`;
      if (res.status === 403 && /not been used|disabled/i.test(msg)) throw new ApiError(this.apiDisabledText, { status: 403, apiDisabled: true });
      if (res.status === 403 && /insufficient.*(scope|permission)/i.test(msg)) {
        throw new ApiError('Your sign-in does not include this permission yet. Sign in again and tick every permission box on Google\'s page.', { status: 403, needsSignIn: true });
      }
      throw new ApiError(msg, { status: res.status });
    }
    return json;
  }

  // Overridden by each Google app.
  async fetchEmail() { throw new Error('fetchEmail not implemented'); }

  startPolling() {}

  stopPolling() {}

  setUnread(n) {
    if (n === this.unread) return;
    this.unread = n;
    this.emit('unread', n);
  }

  dispose() { this.stopPolling(); this.cancelSignIn(); this.removeAllListeners(); }
}

// ---------- Gmail ----------

class GmailAccount extends GoogleAccount {
  constructor(opts) {
    super({ ...opts, scope: SCOPE, apiBase: ENDPOINTS.api });
    this.apiDisabledText = 'The Gmail API is not turned on for your Google key. Turn it on in Google Cloud (setup step 2).';
  }

  async fetchEmail() {
    const profile = await this.api('GET', '/gmail/v1/users/me/profile');
    this.historyId = profile.historyId;
    return profile.emailAddress;
  }

  // ----- contract methods (see src/gmail/gmail.js) -----

  async listLabels() {
    const { labels = [] } = await this.api('GET', '/gmail/v1/users/me/labels');
    const wanted = labels.filter((l) => l.type === 'user' || ['INBOX', 'STARRED', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].includes(l.id));
    const full = await mapLimit(wanted, 6, (l) => this.api('GET', `/gmail/v1/users/me/labels/${encodeURIComponent(l.id)}`).catch(() => l));
    const inbox = full.find((l) => l.id === 'INBOX');
    if (inbox) this.setUnread(inbox.threadsUnread || 0);
    return {
      labels: full.map((l) => ({
        id: l.id, name: l.name, type: l.type === 'user' ? 'user' : 'system', threadsUnread: l.threadsUnread || 0, threadsTotal: l.threadsTotal || 0,
      })),
    };
  }

  async listThreads({ labelId, q, pageToken, max, category } = {}) {
    const query = { maxResults: Math.max(1, Math.min(50, Number(max) || 25)), pageToken, q };
    if (labelId && labelId !== 'ALL') query.labelIds = [labelId];
    // Gmail's inbox tabs. Primary = everything not in the other tabs (works also when Gmail has tabs off).
    if (category === 'primary') {
      query.q = [q, '-category:promotions -category:social -category:updates -category:forums'].filter(Boolean).join(' ');
    } else if (INBOX_CATEGORIES[category]) {
      query.labelIds = [...(query.labelIds || []), INBOX_CATEGORIES[category]];
    }
    if (labelId === 'SPAM' || labelId === 'TRASH') query.includeSpamTrash = true;
    const list = await this.api('GET', '/gmail/v1/users/me/threads', { query });
    const threads = await mapLimit(list.threads || [], 8, async (t) => {
      const full = await this.api('GET', `/gmail/v1/users/me/threads/${t.id}`, {
        query: { format: 'metadata', metadataHeaders: ['From', 'Subject', 'Date'] },
      }).catch(() => null);
      return full ? summarizeThread(full, t.snippet) : null;
    });
    return { threads: threads.filter(Boolean), nextPageToken: list.nextPageToken || null };
  }

  async getThread({ id }) {
    const t = await this.api('GET', `/gmail/v1/users/me/threads/${encodeURIComponent(id)}`, { query: { format: 'full' } });
    const messages = await mapLimit(t.messages || [], 4, async (m) => {
      const h = m.payload?.headers || [];
      const parsed = parsePayload(m.payload);
      let { html } = parsed;
      if (html && parsed.inline.length) html = await this.inlineImages(m.id, html, parsed.inline);
      const fromAddr = parseAddress(header(h, 'From'));
      return {
        id: m.id,
        from: fromAddr.name,
        fromEmail: fromAddr.email,
        to: splitAddresses(header(h, 'To')).join(', '),
        cc: splitAddresses(header(h, 'Cc')).join(', '),
        date: Number(m.internalDate) || Date.parse(header(h, 'Date')) || 0,
        subject: decodeWords(header(h, 'Subject')),
        html,
        text: parsed.text ?? (html ? null : m.snippet || ''),
        attachments: parsed.attachments.filter((a) => a.id).map(({ id: aid, filename, mimeType, size }) => ({ id: aid, filename, mimeType, size })),
        messageIdHeader: header(h, 'Message-ID') || header(h, 'Message-Id'),
        references: header(h, 'References'),
        unread: (m.labelIds || []).includes('UNREAD'),
      };
    });
    const first = messages[0] || {};
    return { thread: { id: t.id, subject: first.subject || '', labelIds: [...new Set((t.messages || []).flatMap((m) => m.labelIds || []))], messages } };
  }

  async inlineImages(messageId, html, inline) {
    let out = html;
    for (const img of inline.slice(0, 20)) {
      if (img.size > 3 * 1024 * 1024) continue;
      let data = img.data;
      if (!data && img.attachmentId) {
        const a = await this.api('GET', `/gmail/v1/users/me/messages/${messageId}/attachments/${img.attachmentId}`).catch(() => null);
        data = a && a.data;
      }
      if (!data) continue;
      const uri = `data:${img.mimeType};base64,${fromB64url(data).toString('base64')}`;
      out = out.split(`cid:${img.cid}`).join(uri);
    }
    return out;
  }

  async modifyThread({ id, add = [], remove = [] }) {
    await this.api('POST', `/gmail/v1/users/me/threads/${encodeURIComponent(id)}/modify`, { body: { addLabelIds: add, removeLabelIds: remove } });
    this.refreshUnread();
    return {};
  }

  async trashThread({ id }) {
    await this.api('POST', `/gmail/v1/users/me/threads/${encodeURIComponent(id)}/trash`);
    this.refreshUnread();
    return {};
  }

  async send({ to, cc, bcc, subject, body, threadId, inReplyTo, references, attachments = [] }) {
    if (!String(to || '').trim() && !String(cc || '').trim() && !String(bcc || '').trim()) throw new ApiError('Add at least one recipient.');
    const acc = this.account();
    const files = [];
    let total = 0;
    for (const a of attachments) {
      const data = await this.deps.readFile(a.path);
      total += data.length;
      files.push({ filename: path.basename(a.path), mimeType: mimeOf(a.path), data });
    }
    if (total > MAX_SEND_BYTES) throw new ApiError('Attachments are too big (over 20 MB). Share large files with a Google Drive link instead.');
    const raw = buildRawMessage({ from: acc?.email, to, cc, bcc, subject, body, inReplyTo, references, attachments: files });
    const res = await this.api('POST', '/gmail/v1/users/me/messages/send', { body: { raw: b64url(Buffer.from(raw, 'utf8')), ...(threadId ? { threadId } : {}) } });
    return { id: res.id };
  }

  async pickAttachments() {
    const files = await this.deps.showOpenDialog();
    return { files };
  }

  async downloadAttachment({ messageId, attachmentId, filename }) {
    const target = await this.deps.showSaveDialog(filename);
    if (!target) throw new ApiError('cancelled');
    const a = await this.api('GET', `/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    await fs.promises.writeFile(target, fromB64url(a.data));
    return { path: target };
  }

  // ----- unread count + new mail -----

  async refreshUnread() {
    try {
      const inbox = await this.api('GET', '/gmail/v1/users/me/labels/INBOX');
      this.setUnread(inbox.threadsUnread || 0);
    } catch { /* offline or signed out */ }
  }

  startPolling() {
    if (this.pollTimer || !this.status().signedIn) return;
    this.pollTimer = setInterval(() => this.poll(), POLL_MS);
    this.poll();
  }

  stopPolling() { clearInterval(this.pollTimer); this.pollTimer = null; }

  async poll() {
    try {
      if (!this.historyId) {
        const p = await this.api('GET', '/gmail/v1/users/me/profile');
        this.historyId = p.historyId;
        await this.refreshUnread();
        return;
      }
      let res;
      try {
        res = await this.api('GET', '/gmail/v1/users/me/history', { query: { startHistoryId: this.historyId, historyTypes: 'messageAdded', labelId: 'INBOX' } });
      } catch (err) {
        if (err.status === 404) { this.historyId = null; return; } // history too old: start again
        throw err;
      }
      this.historyId = res.historyId || this.historyId;
      const added = (res.history || []).flatMap((h) => h.messagesAdded || []).map((x) => x.message)
        .filter((m) => m && (m.labelIds || []).includes('INBOX') && (m.labelIds || []).includes('UNREAD'));
      await this.refreshUnread();
      if (!added.length) return;
      this.emit('changed');
      for (const m of added.slice(0, 3)) {
        const meta = await this.api('GET', `/gmail/v1/users/me/messages/${m.id}`, { query: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } }).catch(() => null);
        if (!meta) continue;
        const h = meta.payload?.headers || [];
        this.emit('new-mail', { threadId: m.threadId, from: parseAddress(header(h, 'From')).name, subject: decodeWords(header(h, 'Subject')) || '(no subject)' });
      }
      if (added.length > 3) this.emit('new-mail', { threadId: null, from: 'Gmail', subject: `${added.length - 3} more new emails` });
    } catch (err) {
      if (err.needsSignIn || err.needsSetup) this.stopPolling();
    }
  }

  dispose() { this.stopPolling(); this.cancelSignIn(); this.removeAllListeners(); }
}

function summarizeThread(t, snippet) {
  const msgs = t.messages || [];
  const first = msgs[0] || {};
  const last = msgs[msgs.length - 1] || {};
  const labels = [...new Set(msgs.flatMap((m) => m.labelIds || []))];
  const fromAddr = parseAddress(header(last.payload?.headers, 'From') || header(first.payload?.headers, 'From'));
  return {
    id: t.id,
    subject: decodeWords(header(first.payload?.headers, 'Subject')),
    from: fromAddr.name,
    fromEmail: fromAddr.email,
    snippet: decodeHtmlEntities(last.snippet || snippet || ''),
    date: Number(last.internalDate) || 0,
    unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
    starred: labels.includes('STARRED'),
    hasAttachments: msgs.some((m) => /^multipart\/mixed/i.test(m.payload?.mimeType || '')),
    messageCount: msgs.length,
    labelIds: labels,
  };
}

// Gmail snippets contain HTML entities such as &#39; and &amp;.
function decodeHtmlEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    if (k === 'nbsp') return ' ';
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

const CONTRACT = ['getStatus', 'saveClientConfig', 'signIn', 'signOut', 'listLabels', 'listThreads', 'getThread',
  'modifyThread', 'trashThread', 'send', 'pickAttachments', 'downloadAttachment', 'openExternal'];

module.exports = {
  GoogleAccount, GmailAccount, GmailStore, ApiError, CONTRACT, ENDPOINTS, mapLimit,
  // helpers for tests
  decodeWords, parseAddress, splitAddresses, parsePayload, buildRawMessage, b64url, fromB64url, summarizeThread, decodeHtmlEntities,
};
