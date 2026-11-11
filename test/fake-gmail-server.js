'use strict';
// Fake Google OAuth + Gmail REST API server for automated tests.
// Plain Node, `http` only. Mimics real URL paths, query params and JSON shapes.

const http = require('node:http');
const crypto = require('node:crypto');

const MIN = 60e3;
const HOUR = 36e5;
const DAY = 864e5;

const rand = (n = 8) => crypto.randomBytes(n).toString('hex');
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// ---------- small MIME / header helpers ----------

function encodeWord(s) {
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function charsetOf(cs) {
  cs = (cs || 'utf-8').toLowerCase();
  return cs === 'iso-8859-1' || cs === 'latin1' || cs === 'us-ascii' ? 'latin1' : 'utf8';
}

function qpDecode(s, bytes) {
  const str = s.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  return bytes ? Buffer.from(str, 'latin1') : str;
}

function decodeWords(str) {
  if (!str) return str;
  return String(str)
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?([\w-]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, text) => {
      const buf =
        enc.toLowerCase() === 'b'
          ? Buffer.from(text, 'base64')
          : Buffer.from(qpDecode(text.replace(/_/g, ' ')), 'latin1');
      return buf.toString(charsetOf(cs));
    });
}

function rfc2822(ms) {
  return new Date(ms).toUTCString().replace('GMT', '+0000');
}

function parseHeaders(str) {
  const out = [];
  for (const l of str.split(/\r?\n/)) {
    if (/^[ \t]/.test(l) && out.length) out[out.length - 1].value += ' ' + l.trim();
    else {
      const i = l.indexOf(':');
      if (i > 0) out.push({ name: l.slice(0, i).trim(), value: l.slice(i + 1).trim() });
    }
  }
  return out;
}

function hget(headers, name) {
  const h = headers.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : undefined;
}

function splitEntity(str) {
  if (/^\r?\n/.test(str)) return ['', str.replace(/^\r?\n/, '')];
  const m = /\r?\n\r?\n/.exec(str);
  if (!m) return [str, ''];
  return [str.slice(0, m.index), str.slice(m.index + m[0].length)];
}

function parseParams(value) {
  const parts = String(value || '');
  const type = parts.split(';')[0].trim().toLowerCase();
  const params = {};
  const re = /;\s*([\w*-]+)\s*=\s*(?:"([^"]*)"|([^;]*))/g;
  let m;
  while ((m = re.exec(parts))) {
    let key = m[1].toLowerCase();
    let val = m[2] !== undefined ? m[2] : (m[3] || '').trim();
    const star = /^utf-8''(.*)$/i.exec(val);
    if (key.endsWith('*')) {
      key = key.slice(0, -1);
      if (star) val = decodeURIComponent(star[1]);
    }
    params[key] = val;
  }
  return { type, params };
}

function splitMultipart(body, boundary) {
  const parts = [];
  let cur = null;
  for (const line of body.split(/\r?\n/)) {
    if (line.trimEnd() === '--' + boundary) {
      if (cur) parts.push(cur);
      cur = [];
    } else if (line.trimEnd() === '--' + boundary + '--') {
      if (cur) parts.push(cur);
      cur = null;
      break;
    } else if (cur) cur.push(line);
  }
  if (cur) parts.push(cur);
  return parts.map((l) => l.join('\r\n'));
}

function decodeBody(headers, body) {
  const cte = (hget(headers, 'content-transfer-encoding') || '7bit').toLowerCase();
  if (cte === 'base64') return { buf: Buffer.from(body.replace(/\s+/g, ''), 'base64'), encoded: true };
  if (cte === 'quoted-printable') return { buf: qpDecode(body, true), encoded: true };
  return { buf: Buffer.from(body, 'utf8'), encoded: false };
}

function walkEntity(headers, body, acc) {
  const ct = parseParams(hget(headers, 'content-type') || 'text/plain; charset=us-ascii');
  if (ct.type.startsWith('multipart/') && ct.params.boundary) {
    for (const part of splitMultipart(body, ct.params.boundary)) {
      const [h, b] = splitEntity(part);
      walkEntity(parseHeaders(h), b, acc);
    }
    return;
  }
  const { buf, encoded } = decodeBody(headers, body);
  const disp = parseParams(hget(headers, 'content-disposition') || '');
  const filename = disp.params.filename || ct.params.name || null;
  if (filename || disp.type === 'attachment') {
    acc.attachments.push({ filename: decodeWords(filename || 'attachment'), mimeType: ct.type, data: buf });
    return;
  }
  const toText = () => {
    let t = buf.toString(charsetOf(ct.params.charset)).replace(/\r\n/g, '\n');
    if (!encoded) t = t.replace(/\n$/, '');
    return t;
  };
  if (ct.type === 'text/plain' && acc.text == null) acc.text = toText();
  else if (ct.type === 'text/html' && acc.html == null) acc.html = toText();
}

// ---------- MIME tree for stored messages ----------

function leaf(contentType, mimeType, data) {
  return { contentType, mimeType, data: Buffer.from(data) };
}

function makeTree(id, { text, html, attachments }) {
  const t = text != null ? leaf('text/plain; charset="UTF-8"', 'text/plain', text) : null;
  const h = html != null ? leaf('text/html; charset="UTF-8"', 'text/html', html) : null;
  let body;
  if (t && h) {
    body = {
      mimeType: 'multipart/alternative',
      contentType: `multipart/alternative; boundary="alt_${id}"`,
      parts: [t, h],
    };
  } else body = t || h || leaf('text/plain; charset="UTF-8"', 'text/plain', '');
  if (!attachments || !attachments.length) return body;
  const attParts = attachments.map((a, i) => ({
    mimeType: a.mimeType,
    contentType: `${a.mimeType}; name="${a.filename}"`,
    filename: a.filename,
    attachmentId: `att_${id}_${i}`,
    data: Buffer.from(a.data),
  }));
  return {
    mimeType: 'multipart/mixed',
    contentType: `multipart/mixed; boundary="mix_${id}"`,
    parts: [body, ...attParts],
  };
}

function collectAttachments(node, out = {}) {
  if (node.attachmentId) out[node.attachmentId] = node.data;
  (node.parts || []).forEach((p) => collectAttachments(p, out));
  return out;
}

function toPayload(node, partId, headers) {
  const p = { partId, mimeType: node.mimeType, filename: node.filename || '' };
  if (headers) p.headers = headers;
  else if (node.attachmentId) {
    p.headers = [
      { name: 'Content-Type', value: node.contentType },
      { name: 'Content-Disposition', value: `attachment; filename="${node.filename}"` },
      { name: 'Content-Transfer-Encoding', value: 'base64' },
      { name: 'X-Attachment-Id', value: node.attachmentId },
    ];
  } else p.headers = [{ name: 'Content-Type', value: node.contentType }];
  if (node.parts) {
    p.body = { size: 0 };
    p.parts = node.parts.map((c, i) => toPayload(c, partId === '' ? String(i) : `${partId}.${i}`));
  } else if (node.attachmentId) p.body = { attachmentId: node.attachmentId, size: node.data.length };
  else p.body = { size: node.data.length, data: b64url(node.data) };
  return p;
}

// ---------- query parsing ----------

function parseQ(q) {
  const terms = [];
  const re = /(-?)(?:(\w+):)?(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(q || ''))) {
    const neg = m[1] === '-';
    const val = (m[3] !== undefined ? m[3] : m[4]).toLowerCase();
    if (m[2] && ['from', 'to', 'subject', 'is', 'has', 'in', 'label', 'category'].includes(m[2].toLowerCase()))
      terms.push({ k: m[2].toLowerCase(), v: val, neg });
    else terms.push({ k: 'word', v: (m[2] ? m[2] + ':' : '') + val, neg });
  }
  return terms;
}

// ---------- server ----------

async function startFakeGmail({ port = 0, email = 'test.user@example.com' } = {}) {
  const calendar = require('./fake-calendar').createFakeCalendar({ email });
  const state = {
    email,
    threads: {}, // id -> { id, messageIds: [] }
    messages: {}, // id -> message (see addMessage)
    labels: [],
    sent: [],
    tokens: { access: new Set(), refresh: new Map(), codes: new Map() },
    historyId: 1000,
    history: [], // { id, messageId }
    requests: [],
    lastAuthRequest: null,
  };

  const SYSTEM = ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'STARRED', 'UNREAD', 'IMPORTANT', 'CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];
  for (const id of SYSTEM) {
    state.labels.push({
      id,
      name: id,
      type: 'system',
      messageListVisibility: 'show',
      labelListVisibility: 'labelShow',
    });
  }
  state.labels.push({
    id: 'Label_1',
    name: 'Work',
    type: 'user',
    messageListVisibility: 'show',
    labelListVisibility: 'labelShow',
  });

  const me = `"Test User" <${email}>`;

  // ----- data model -----
  function addMessage(spec) {
    const id = spec.id || 'm' + rand(7);
    const threadId = spec.threadId || 't' + rand(7);
    const ts = spec.ts != null ? spec.ts : Date.now();
    const tree = makeTree(id, spec);
    let headers = spec.headers;
    if (!headers) {
      headers = [{ name: 'From', value: spec.from }, { name: 'To', value: spec.to || me }];
      if (spec.cc) headers.push({ name: 'Cc', value: spec.cc });
      headers.push(
        { name: 'Subject', value: spec.subject || '' },
        { name: 'Date', value: rfc2822(ts) },
        { name: 'Message-ID', value: spec.messageId || `<${id}@mail.example.com>` }
      );
      if (spec.inReplyTo) headers.push({ name: 'In-Reply-To', value: spec.inReplyTo });
      if (spec.references) headers.push({ name: 'References', value: spec.references });
    } else headers = headers.slice();
    headers.push({ name: 'MIME-Version', value: '1.0' }, { name: 'Content-Type', value: tree.contentType });
    const plain = spec.text != null ? spec.text : String(spec.html || '').replace(/<[^>]*>/g, ' ');
    const snippet = plain.replace(/\s+/g, ' ').trim().slice(0, 100);
    const attachments = collectAttachments(tree);
    const size =
      headers.reduce((n, h) => n + h.name.length + h.value.length + 4, 0) +
      Buffer.byteLength(plain) +
      Buffer.byteLength(spec.html || '') +
      Object.values(attachments).reduce((n, b) => n + b.length, 0);
    const msg = {
      id,
      threadId,
      labelIds: spec.labels.slice(),
      snippet,
      historyId: ++state.historyId,
      internalDate: ts,
      sizeEstimate: size,
      headers,
      tree,
      attachments,
    };
    state.messages[id] = msg;
    (state.threads[threadId] = state.threads[threadId] || { id: threadId, messageIds: [] }).messageIds.push(id);
    if (spec.track) state.history.push({ id: msg.historyId, messageId: id });
    return msg;
  }

  const threadMessages = (t) =>
    t.messageIds.map((i) => state.messages[i]).sort((a, b) => a.internalDate - b.internalDate || a.historyId - b.historyId);

  const knownLabel = (id) => state.labels.some((l) => l.id === id);

  function msgOut(m, format, mh) {
    const o = {
      id: m.id,
      threadId: m.threadId,
      labelIds: m.labelIds.slice(),
      snippet: m.snippet,
      historyId: String(m.historyId),
      internalDate: String(m.internalDate),
      sizeEstimate: m.sizeEstimate,
    };
    if (format === 'full') o.payload = toPayload(m.tree, '', m.headers);
    else if (format === 'metadata') {
      const want = mh && mh.length ? mh.map((x) => x.toLowerCase()) : null;
      o.payload = {
        partId: '',
        mimeType: m.tree.mimeType,
        filename: '',
        headers: m.headers.filter((h) => !want || want.includes(h.name.toLowerCase())),
        body: { size: 0 },
      };
    }
    return o;
  }

  const threadOut = (t, format, mh) => {
    const msgs = threadMessages(t);
    return {
      id: t.id,
      historyId: String(Math.max(...msgs.map((m) => m.historyId))),
      messages: msgs.map((m) => msgOut(m, format, mh)),
    };
  };

  function labelFull(l) {
    const msgs = Object.values(state.messages).filter((m) => m.labelIds.includes(l.id));
    const threads = new Set(msgs.map((m) => m.threadId));
    const unreadMsgs = msgs.filter((m) => m.labelIds.includes('UNREAD'));
    return {
      ...l,
      messagesTotal: msgs.length,
      messagesUnread: unreadMsgs.length,
      threadsTotal: threads.size,
      threadsUnread: new Set(unreadMsgs.map((m) => m.threadId)).size,
    };
  }

  function matchTerm(m, t) {
    const from = decodeWords(hget(m.headers, 'from') || '').toLowerCase();
    const subject = decodeWords(hget(m.headers, 'subject') || '').toLowerCase();
    let r;
    switch (t.k) {
      case 'from': r = from.includes(t.v); break;
      case 'to': r = ((hget(m.headers, 'to') || '') + (hget(m.headers, 'cc') || '')).toLowerCase().includes(t.v); break;
      case 'subject': r = subject.includes(t.v); break;
      case 'is':
        r = t.v === 'unread' ? m.labelIds.includes('UNREAD')
          : t.v === 'read' ? !m.labelIds.includes('UNREAD')
          : m.labelIds.includes(t.v.toUpperCase());
        break;
      case 'has': r = t.v === 'attachment' ? Object.keys(m.attachments).length > 0 : false; break;
      case 'category': {
        const cat = { primary: 'CATEGORY_PERSONAL', promotions: 'CATEGORY_PROMOTIONS', social: 'CATEGORY_SOCIAL', updates: 'CATEGORY_UPDATES', forums: 'CATEGORY_FORUMS' }[t.v];
        r = !!cat && m.labelIds.includes(cat);
        break;
      }
      case 'in': r = t.v === 'anywhere' ? true : m.labelIds.includes(t.v === 'drafts' ? 'DRAFT' : t.v.toUpperCase()); break;
      case 'label': {
        const l = state.labels.find((x) => x.id.toLowerCase() === t.v || x.name.toLowerCase() === t.v);
        r = !!l && m.labelIds.includes(l.id);
        break;
      }
      default: r = subject.includes(t.v) || m.snippet.toLowerCase().includes(t.v) || from.includes(t.v);
    }
    return t.neg ? !r : r;
  }

  function listThreads(u) {
    const labelIds = u.searchParams.getAll('labelIds');
    const terms = parseQ(u.searchParams.get('q'));
    const max = Math.min(parseInt(u.searchParams.get('maxResults'), 10) || 100, 500);
    const offset = parseInt(u.searchParams.get('pageToken'), 10) || 0;
    const showAll =
      u.searchParams.get('includeSpamTrash') === 'true' ||
      labelIds.some((l) => l === 'SPAM' || l === 'TRASH') ||
      terms.some((t) => t.k === 'in' && (t.v === 'trash' || t.v === 'spam' || t.v === 'anywhere'));
    const hits = [];
    for (const t of Object.values(state.threads)) {
      const msgs = threadMessages(t);
      const ok = msgs.some(
        (m) =>
          (showAll || !(m.labelIds.includes('SPAM') || m.labelIds.includes('TRASH'))) &&
          labelIds.every((l) => m.labelIds.includes(l)) &&
          terms.every((x) => matchTerm(m, x))
      );
      if (ok) hits.push({ t, msgs, last: msgs[msgs.length - 1] });
    }
    hits.sort((a, b) => b.last.internalDate - a.last.internalDate || (a.t.id < b.t.id ? -1 : 1));
    const page = hits.slice(offset, offset + max);
    const out = {
      threads: page.map((h) => ({
        id: h.t.id,
        snippet: h.last.snippet,
        historyId: String(Math.max(...h.msgs.map((m) => m.historyId))),
      })),
      resultSizeEstimate: hits.length,
    };
    if (!page.length) delete out.threads;
    if (offset + max < hits.length) out.nextPageToken = String(offset + max);
    return out;
  }

  function bump(msgs) {
    const h = ++state.historyId;
    msgs.forEach((m) => (m.historyId = h));
    return h;
  }

  function modifyThread(t, add, remove) {
    const msgs = threadMessages(t);
    bump(msgs);
    for (const m of msgs) {
      for (const a of add) if (!m.labelIds.includes(a)) m.labelIds.push(a);
      m.labelIds = m.labelIds.filter((l) => !remove.includes(l));
    }
  }

  function deliver({ from, subject = '', text = '', html }) {
    const m = addMessage({
      from,
      subject,
      text,
      html,
      labels: ['INBOX', 'UNREAD'],
      ts: Date.now(),
      track: true,
    });
    return { id: m.id, threadId: m.threadId };
  }

  // ----- seed -----
  (function seed() {
    const NOW = Date.now();
    const ago = (ms) => NOW - ms;
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
      Buffer.alloc(240, 0x2d),
    ]);
    const add = (o) => addMessage({ track: false, ...o });

    add({
      id: 'msg_welcome', threadId: 'thr_welcome', labels: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], ts: ago(5 * MIN),
      from: 'Roost Team <team@roost.example.com>', subject: 'Welcome to Roost',
      text: 'Hi Test User,\n\nWelcome to Roost! This is your first message. Archive it, star it, or reply to try things out.\n\nThe Roost Team\n',
    });

    // 3-message conversation
    add({
      id: 'msg_conversation_1', threadId: 'thr_conversation', labels: ['INBOX'], ts: ago(26 * HOUR),
      from: 'Alice Johnson <alice@example.com>', subject: 'Project kickoff',
      messageId: '<conv-1@mail.example.com>',
      text: 'Hi Test User,\n\nCan we kick off the project on Monday? Let me know what time works.\n\nAlice\n',
    });
    add({
      id: 'msg_conversation_2', threadId: 'thr_conversation', labels: ['SENT'], ts: ago(5 * HOUR),
      from: me, to: 'Alice Johnson <alice@example.com>', subject: 'Re: Project kickoff',
      messageId: '<conv-2@mail.example.com>', inReplyTo: '<conv-1@mail.example.com>',
      references: '<conv-1@mail.example.com>',
      text: 'Hi Alice,\n\nMonday at 10am works for me.\n\nTest User\n',
    });
    add({
      id: 'msg_conversation_3', threadId: 'thr_conversation', labels: ['INBOX', 'UNREAD'], ts: ago(2 * HOUR),
      from: 'Alice Johnson <alice@example.com>', subject: 'Re: Project kickoff',
      messageId: '<conv-3@mail.example.com>', inReplyTo: '<conv-2@mail.example.com>',
      references: '<conv-1@mail.example.com> <conv-2@mail.example.com>',
      text: 'Great, 10am it is. I will send the calendar invite shortly.\n\nAlice\n',
    });

    add({
      id: 'msg_newsletter', threadId: 'thr_newsletter', labels: ['INBOX', 'CATEGORY_PERSONAL'], ts: ago(DAY),
      from: 'News Digest <digest@news.example.com>', subject: 'Weekly Digest: 5 things worth reading',
      text: 'Weekly Digest\n\nRead our latest article: https://news.example.com/article/1\n\nUnsubscribe: https://news.example.com/unsub\n',
      html:
        '<html><body><h1>Weekly Digest</h1><p>Read our <a href="https://news.example.com/article/1">latest article</a> now.</p>' +
        '<img src="https://tracker.example.com/pixel.gif" width="1" height="1" alt="">' +
        '<p><a href="https://news.example.com/unsub">Unsubscribe</a></p></body></html>',
    });

    add({
      id: 'msg_attachment', threadId: 'thr_attachment', labels: ['INBOX'], ts: ago(3 * DAY),
      from: 'Billing <billing@vendor.example.com>', subject: 'Your invoice for October',
      text: 'Hello,\n\nPlease find your invoice attached.\n\nVendor Billing\n',
      attachments: [{ filename: 'invoice.pdf', mimeType: 'application/pdf', data: pdf }],
    });

    add({
      id: 'msg_starred', threadId: 'thr_starred', labels: ['INBOX', 'STARRED', 'IMPORTANT'], ts: ago(9 * DAY),
      from: 'Bob Builder <bob@example.com>', subject: 'Important: contract draft',
      text: 'Here is the contract draft we talked about. Please review it when you can.\n',
    });

    add({
      id: 'msg_work', threadId: 'thr_work', labels: ['INBOX', 'Label_1'], ts: ago(20 * DAY),
      from: 'Carol Manager <carol@work.example.com>', subject: 'Quarterly planning',
      text: 'Team, planning for next quarter starts next week. Please add your items to the doc.\n',
    });

    add({
      id: 'msg_nosubject', threadId: 'thr_nosubject', labels: ['INBOX'], ts: ago(33 * DAY),
      from: 'Dave <dave@example.com>', subject: '',
      text: 'Sent without a subject line.\n',
    });

    add({
      id: 'msg_zoe', threadId: 'thr_zoe', labels: ['INBOX'], ts: ago(50 * DAY),
      from: `${encodeWord('Zoë Müller')} <zoe@example.com>`, subject: 'Hallo from Zoë',
      text: 'Hallo! Schöne Grüße aus Zürich.\n',
    });

    // 19 filler inbox threads, 60..395 days old; 4 unread
    const names = ['Eve Adams', 'Frank Lee', 'Grace Hopper', 'Heidi Klum', 'Ivan Petrov', 'Judy Garland', 'Karl Marx'];
    const subjects = [
      'Lunch tomorrow?', 'Your receipt', 'Meeting notes', 'Happy birthday', 'Trip photos', 'Security alert',
      'Invoice reminder', 'Re: budget', 'Weekend plans', 'Book recommendation', 'Subscription renewed',
      'Package shipped', 'Feedback requested', 'Team offsite', 'Reading list', 'Quick question',
      'Holiday schedule', 'New feature announcement', 'Old thread from last year',
    ];
    for (let k = 0; k < 19; k++) {
      const n = String(k + 1).padStart(2, '0');
      const name = names[k % names.length];
      const handle = name.split(' ')[0].toLowerCase();
      const labels = ['INBOX'];
      if ([0, 3, 6, 9].includes(k)) labels.push('UNREAD');
      if (k % 5 === 2) labels.push('CATEGORY_PERSONAL');
      // The last four fillers sit in Gmail's other inbox tabs.
      const tab = { 15: 'CATEGORY_PROMOTIONS', 16: 'CATEGORY_UPDATES', 17: 'CATEGORY_SOCIAL', 18: 'CATEGORY_FORUMS' }[k];
      if (tab) labels.push(tab);
      add({
        id: `msg_filler_${n}`, threadId: `thr_filler_${n}`, labels,
        ts: ago(60 * DAY + Math.round((k * 335 * DAY) / 18)),
        from: `${name} <${handle}@example.com>`, subject: subjects[k],
        text: `Filler message ${n}: ${subjects[k]}. Nothing important here, just seed data for list paging tests.\n`,
      });
    }

    add({
      id: 'msg_sent_1', threadId: 'thr_sent_1', labels: ['SENT'], ts: ago(6 * HOUR),
      from: me, to: 'Bob Builder <bob@example.com>', subject: 'Sent: draft thoughts',
      text: 'Bob, here are my thoughts on the draft.\n',
    });
    add({
      id: 'msg_sent_2', threadId: 'thr_sent_2', labels: ['SENT'], ts: ago(12 * DAY),
      from: me, to: 'Carol Manager <carol@work.example.com>', subject: 'Sent: status update',
      text: 'Carol, status update: everything is on track.\n',
    });
    add({
      id: 'msg_spam', threadId: 'thr_spam', labels: ['SPAM', 'UNREAD'], ts: ago(7 * DAY),
      from: 'Totally Legit <win@spam.example.net>', subject: 'You won a prize!!!',
      text: 'Click here to claim your prize now.\n',
    });
    add({
      id: 'msg_trash', threadId: 'thr_trash', labels: ['TRASH'], ts: ago(8 * DAY),
      from: 'Old Sender <old@example.com>', subject: 'Deleted message',
      text: 'This message was moved to the trash.\n',
    });
  })();

  // ----- http helpers -----
  const json = (res, status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  };
  const gerr = (res, code, message, status) => json(res, code, { error: { code, message, status } });
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  const parseJson = (s) => {
    try { return s ? JSON.parse(s) : {}; } catch { return null; }
  };
  const newToken = (prefix) => prefix + crypto.randomBytes(24).toString('base64url');

  function makeIdToken(scope) {
    if (!/\b(openid|email)\b/.test(scope || '')) return undefined;
    const enc = (o) => b64url(JSON.stringify(o));
    return `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ iss: 'https://accounts.google.com', sub: '1234567890', email, email_verified: true })}.`;
  }

  // ----- request handling -----
  async function handle(req, res) {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    state.requests.push({ method: req.method, path: p });
    const raw = await readBody(req);

    // OAuth
    if (req.method === 'GET' && p === '/o/oauth2/v2/auth') {
      const q = u.searchParams;
      const redirect = q.get('redirect_uri') || '';
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(redirect)) {
        return json(res, 400, { error: 'invalid_request', error_description: 'Invalid redirect_uri' });
      }
      if (q.get('response_type') !== 'code' || !q.get('client_id') || !q.get('code_challenge') || q.get('code_challenge_method') !== 'S256') {
        return json(res, 400, { error: 'invalid_request', error_description: 'Missing or invalid OAuth parameters' });
      }
      state.lastAuthRequest = Object.fromEntries(q.entries());
      const code = '4/0A' + crypto.randomBytes(24).toString('base64url');
      state.tokens.codes.set(code, {
        challenge: q.get('code_challenge'),
        clientId: q.get('client_id'),
        redirectUri: redirect,
        scope: q.get('scope') || '',
      });
      const loc = new URL(redirect);
      loc.searchParams.set('code', code);
      if (q.get('state') != null) loc.searchParams.set('state', q.get('state'));
      loc.searchParams.set('scope', q.get('scope') || '');
      res.writeHead(302, { location: loc.toString() });
      return res.end();
    }

    if (req.method === 'POST' && p === '/token') {
      const f = new URLSearchParams(raw);
      const bad = (error = 'invalid_grant') => json(res, 400, { error, error_description: 'Bad Request' });
      const gt = f.get('grant_type');
      if (gt === 'authorization_code') {
        const rec = state.tokens.codes.get(f.get('code'));
        if (!rec) return bad();
        const verifier = f.get('code_verifier');
        if (!verifier) return bad();
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        if (challenge !== rec.challenge) return bad();
        if (f.get('redirect_uri') && f.get('redirect_uri') !== rec.redirectUri) return bad();
        state.tokens.codes.delete(f.get('code'));
        const access = newToken('ya29.');
        const refresh = newToken('1//');
        state.tokens.access.add(access);
        state.tokens.refresh.set(refresh, rec.scope);
        const out = { access_token: access, expires_in: 3599, refresh_token: refresh, scope: rec.scope, token_type: 'Bearer' };
        const idt = makeIdToken(rec.scope);
        if (idt) out.id_token = idt;
        return json(res, 200, out);
      }
      if (gt === 'refresh_token') {
        const rt = f.get('refresh_token');
        if (!state.tokens.refresh.has(rt)) return bad();
        const access = newToken('ya29.');
        state.tokens.access.add(access);
        return json(res, 200, { access_token: access, expires_in: 3599, scope: state.tokens.refresh.get(rt), token_type: 'Bearer' });
      }
      return bad('unsupported_grant_type');
    }

    if (req.method === 'POST' && p === '/revoke') {
      const tok = u.searchParams.get('token') || new URLSearchParams(raw).get('token');
      state.tokens.access.delete(tok);
      state.tokens.refresh.delete(tok);
      return json(res, 200, {});
    }

    // Test hooks
    if (req.method === 'POST' && p === '/__test/deliver') {
      const b = parseJson(raw);
      if (!b || !b.from) return gerr(res, 400, 'from required', 'INVALID_ARGUMENT');
      return json(res, 200, deliver(b));
    }
    if (req.method === 'GET' && p === '/__test/calendar-log') return json(res, 200, calendar.cal.log);
    if (req.method === 'POST' && p === '/__test/expire') {
      state.expireAll();
      return json(res, 200, {});
    }

    // Calendar (test/fake-calendar.js)
    if (calendar.handle(req, res, u, p, raw, {
      json, gerr,
      authed: () => { const a = /^Bearer (.+)$/.exec(req.headers.authorization || ''); return !!a && state.tokens.access.has(a[1]); },
    })) return undefined;

    // Gmail
    const gm = /^\/gmail\/v1\/users\/([^/]+)\/(.*)$/.exec(p);
    if (!gm) return gerr(res, 404, 'Not Found', 'NOT_FOUND');
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (!auth || !state.tokens.access.has(auth[1])) {
      return gerr(res, 401, 'Request had invalid authentication credentials.', 'UNAUTHENTICATED');
    }
    const rest = gm[2];
    const notFound = () => gerr(res, 404, 'Requested entity was not found.', 'NOT_FOUND');
    let m;

    if (req.method === 'GET' && rest === 'profile') {
      return json(res, 200, {
        emailAddress: email,
        messagesTotal: Object.keys(state.messages).length,
        threadsTotal: Object.keys(state.threads).length,
        historyId: String(state.historyId),
      });
    }

    if (req.method === 'GET' && rest === 'labels') return json(res, 200, { labels: state.labels.map((l) => ({ ...l })) });
    if (req.method === 'GET' && (m = /^labels\/([^/]+)$/.exec(rest))) {
      const l = state.labels.find((x) => x.id === decodeURIComponent(m[1]));
      return l ? json(res, 200, labelFull(l)) : notFound();
    }

    if (req.method === 'GET' && rest === 'threads') return json(res, 200, listThreads(u));

    if (req.method === 'GET' && (m = /^threads\/([^/]+)$/.exec(rest))) {
      const t = state.threads[decodeURIComponent(m[1])];
      if (!t) return notFound();
      const format = u.searchParams.get('format') || 'full';
      return json(res, 200, threadOut(t, format, u.searchParams.getAll('metadataHeaders')));
    }

    if (req.method === 'POST' && (m = /^threads\/([^/]+)\/(modify|trash|untrash)$/.exec(rest))) {
      const t = state.threads[decodeURIComponent(m[1])];
      if (!t) return notFound();
      let add = [];
      let remove = [];
      if (m[2] === 'modify') {
        const b = parseJson(raw);
        if (!b) return gerr(res, 400, 'Invalid JSON payload received.', 'INVALID_ARGUMENT');
        add = b.addLabelIds || [];
        remove = b.removeLabelIds || [];
        const bad = add.concat(remove).find((l) => !knownLabel(l));
        if (bad) return gerr(res, 400, `Invalid label: ${bad}`, 'INVALID_ARGUMENT');
      } else if (m[2] === 'trash') {
        add = ['TRASH'];
        remove = ['INBOX'];
      } else remove = ['TRASH'];
      modifyThread(t, add, remove);
      return json(res, 200, threadOut(t, 'minimal'));
    }

    if (req.method === 'GET' && rest === 'messages') {
      const labelIds = u.searchParams.getAll('labelIds');
      const max = Math.min(parseInt(u.searchParams.get('maxResults'), 10) || 100, 500);
      const msgs = Object.values(state.messages)
        .filter((x) => !x.labelIds.includes('SPAM') && !x.labelIds.includes('TRASH') && labelIds.every((l) => x.labelIds.includes(l)))
        .sort((a, b) => b.internalDate - a.internalDate)
        .slice(0, max);
      return json(res, 200, { messages: msgs.map((x) => ({ id: x.id, threadId: x.threadId })), resultSizeEstimate: msgs.length });
    }

    if (req.method === 'GET' && (m = /^messages\/([^/]+)$/.exec(rest))) {
      const msg = state.messages[decodeURIComponent(m[1])];
      if (!msg) return notFound();
      return json(res, 200, msgOut(msg, u.searchParams.get('format') || 'full', u.searchParams.getAll('metadataHeaders')));
    }

    if (req.method === 'GET' && (m = /^messages\/([^/]+)\/attachments\/([^/]+)$/.exec(rest))) {
      const msg = state.messages[decodeURIComponent(m[1])];
      const data = msg && msg.attachments[decodeURIComponent(m[2])];
      if (!data) return notFound();
      return json(res, 200, { size: data.length, data: b64url(data) });
    }

    if (req.method === 'POST' && rest === 'messages/send') {
      const b = parseJson(raw);
      if (!b || !b.raw) return gerr(res, 400, 'Invalid JSON payload received.', 'INVALID_ARGUMENT');
      const rawStr = Buffer.from(b.raw, 'base64url').toString('utf8');
      const [hs, body] = splitEntity(rawStr);
      const hdrs = parseHeaders(hs);
      if (!hget(hdrs, 'to') && !hget(hdrs, 'cc') && !hget(hdrs, 'bcc')) {
        return gerr(res, 400, 'Recipient address required', 'INVALID_ARGUMENT');
      }
      if (b.threadId && !state.threads[b.threadId]) return notFound();
      const acc = { text: null, html: null, attachments: [] };
      walkEntity(hdrs, body, acc);
      const ts = Date.now();
      const stored = hdrs.filter((h) => !/^(content-type|content-transfer-encoding|mime-version)$/i.test(h.name));
      if (!hget(stored, 'from')) stored.unshift({ name: 'From', value: me });
      if (!hget(stored, 'date')) stored.push({ name: 'Date', value: rfc2822(ts) });
      const id = 'sent_' + rand(6);
      if (!hget(stored, 'message-id')) stored.push({ name: 'Message-ID', value: `<${id}@mail.example.com>` });
      const msg = addMessage({
        id,
        threadId: b.threadId,
        labels: ['SENT'],
        ts,
        headers: stored,
        text: acc.text != null ? acc.text : acc.html == null ? '' : null,
        html: acc.html,
        attachments: acc.attachments,
        track: true,
      });
      const lower = {};
      for (const h of hdrs) lower[h.name.toLowerCase()] = decodeWords(h.value);
      const rec = {
        id: msg.id,
        raw: b.raw,
        threadId: msg.threadId,
        headers: {
          ...lower,
          to: lower.to, cc: lower.cc, bcc: lower.bcc, subject: lower.subject,
          'in-reply-to': lower['in-reply-to'], references: lower.references,
        },
        text: acc.text != null ? acc.text : '',
        attachments: acc.attachments.map((a) => {
          const o = { filename: a.filename, mimeType: a.mimeType, size: a.data.length };
          Object.defineProperty(o, 'data', { value: a.data, enumerable: false });
          return o;
        }),
      };
      if (acc.html != null) rec.html = acc.html;
      state.sent.push(rec);
      return json(res, 200, { id: msg.id, threadId: msg.threadId, labelIds: ['SENT'] });
    }

    if (req.method === 'GET' && rest === 'history') {
      const start = parseInt(u.searchParams.get('startHistoryId'), 10);
      if (!Number.isFinite(start)) return gerr(res, 400, 'Missing startHistoryId', 'INVALID_ARGUMENT');
      const types = u.searchParams.getAll('historyTypes');
      const labelId = u.searchParams.get('labelId');
      const out = { historyId: String(state.historyId) };
      if (!types.length || types.includes('messageAdded')) {
        const history = [];
        for (const h of state.history) {
          if (h.id <= start) continue;
          const msg = state.messages[h.messageId];
          if (!msg || (labelId && !msg.labelIds.includes(labelId))) continue;
          history.push({
            id: String(h.id),
            messages: [{ id: msg.id, threadId: msg.threadId }],
            messagesAdded: [{ message: { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds.slice() } }],
          });
        }
        if (history.length) out.history = history;
      }
      return json(res, 200, out);
    }

    return gerr(res, 404, 'Not Found', 'NOT_FOUND');
  }

  state.expireAll = () => state.tokens.access.clear();
  state.deliver = deliver;

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      if (!res.headersSent) gerr(res, 500, String(e && e.stack), 'INTERNAL');
      else res.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const close = () =>
    new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  state.calendar = calendar.cal;
  return { url, state, close };
}

module.exports = { startFakeGmail };
