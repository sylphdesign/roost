// Runs INSIDE Roost (ROOST_E2E_SCRIPT). Uses the Gmail SCREEN like a person would: fills the setup form,
// clicks Sign in, opens emails, shows images, replies, archives, composes. Writes ui.json + screenshots.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ win, getState, quit }) => {
  const out = { steps: [], screenshots: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  let wc;
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { try { const f = path.join(dir, `ui-${name}.png`); fs.writeFileSync(f, (await wc.capturePage()).toPNG()); out.screenshots.push(f); } catch (e) { out.screenshots.push(`${name}: not captured (${e.message})`); } };
  const until = async (code, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await js(code)) return true; await wait(200); } return false; };
  const helpers = `
    const vis = (id) => { const n = document.getElementById(id); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; };
    const setVal = (id, v) => { const n = document.getElementById(id); n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
    const byText = (sel, re) => [...document.querySelectorAll(sel)].find((n) => re.test(n.textContent || n.getAttribute('aria-label') || ''));
    const byLabel = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') || b.title || b.textContent));
  `;
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html')); if (!wc) await wait(250); }
    await wait(1500);
    step('setup screen shows first', await until(`${helpers} return vis('screen-setup');`));
    await js(`${helpers} setVal('setup-client-id', '123-abc.apps.googleusercontent.com'); setVal('setup-client-secret', 'GOCSPX-test'); document.getElementById('setup-save').click(); return true;`);
    step('setup form saves and shows sign-in', await until(`${helpers} return vis('screen-signin');`));
    await shot('signin');
    await js(`document.getElementById('signin-btn').click(); return true;`);
    step('Sign in button opens the mailbox', await until(`${helpers} return vis('screen-mail') && document.querySelectorAll('#thread-list .row').length > 5;`, 15000),
      await js(`return document.getElementById('account-email').textContent;`));
    await wait(800);

    await js(`${helpers} byText('#thread-list .row-open', /Weekly Digest/).click(); return true;`);
    const frame = await until(`return !!document.querySelector('#reader iframe.msg-frame') && document.querySelector('#reader iframe.msg-frame').offsetHeight > 50;`);
    step('HTML email shows in a sandboxed frame', frame,
      await js(`const f=document.querySelector('#reader iframe.msg-frame'); return f && { sandbox: f.getAttribute('sandbox'), h: f.offsetHeight };`));
    const csp = await js(`const d=document.querySelector('#reader iframe.msg-frame').contentDocument; return d.querySelector('meta[http-equiv="Content-Security-Policy"]').content;`);
    step('images show by default, scripts stay blocked', /img-src[^;]*https:/.test(csp) && /default-src 'none'/.test(csp)
      && !(await js(`return !!document.querySelector('.images-bar');`)), csp);
    await shot('newsletter');

    await js(`${helpers} byText('#thread-list .row-open', /Project kickoff/).click(); return true;`);
    step('conversation shows 3 messages', await until(`return document.querySelectorAll('#reader article.msg').length === 3;`));
    await shot('conversation');
    await js(`${helpers} (byText('.reply-bar button', /^\\s*Reply\\s*$/) || byLabel(/^Reply$/)).click(); return true;`);
    const prefill = await until(`${helpers} return vis('compose') && document.getElementById('compose-to').value.includes('@');`);
    const pre = await js(`return { to: document.getElementById('compose-to').value, subject: document.getElementById('compose-subject').value, body: document.getElementById('compose-quote').textContent.slice(0, 120), quoteToggle: !document.getElementById('compose-quote-toggle').hidden };`);
    step('Reply opens compose with To, Re: subject and quote', prefill && /^Re: Project kickoff$/.test(pre.subject) && /wrote:/.test(pre.body) && pre.quoteToggle, pre);
    await js(`${helpers} const b=document.getElementById('compose-body'); b.focus(); document.execCommand('insertText', false, 'UI reply works'); document.getElementById('compose-send').click(); return true;`);
    step('Send closes compose and confirms', await until(`${helpers} return !vis('compose') && /Sent/.test(document.getElementById('toasts').textContent);`, 10000),
      await js(`return document.getElementById('toasts').textContent;`));
    const sent = await (await fetch('http://127.0.0.1:47556/')).json().catch(() => ({ sent: [] }));
    const last = sent.sent[sent.sent.length - 1];
    step('fake Google received the reply in the thread', last && /UI reply works/.test(last.text) && /wrote:/.test(last.text) && /conv-3@/.test(last.headers['in-reply-to'] || ''), last && last.headers);

    const before = await js(`return document.querySelectorAll('#thread-list .row').length;`);
    await js(`${helpers} byLabel(/^Archive/).click(); return true;`);
    step('Archive removes the conversation and shows Undo', await until(`return document.querySelectorAll('#thread-list .row').length === ${before} - 1 && /Archived/.test(document.getElementById('toasts').textContent);`),
      { before, after: await js(`return document.querySelectorAll('#thread-list .row').length;`) });

    await js(`document.getElementById('compose-btn').click(); return true;`);
    await until(`return !document.getElementById('compose').hidden;`);
    // Recipient autofill from my own mail
    await js(`${helpers} const t=document.getElementById('compose-to'); t.focus(); t.value='a'; t.setSelectionRange(1,1); t.dispatchEvent(new Event('input',{bubbles:true})); return true;`);
    const acOk = await until(`return !document.getElementById('addr-suggest').hidden && document.querySelectorAll('#addr-suggest .addr-opt').length > 0;`, 6000);
    const acList = await js(`return [...document.querySelectorAll('#addr-suggest .addr-opt')].map((li) => li.textContent);`);
    step('typing in To shows contact suggestions', acOk, acList);
    await shot('autofill');
    await js(`${helpers} document.getElementById('compose-to').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})); return true;`);
    const picked = await js(`return document.getElementById('compose-to').value;`);
    step('Enter picks the contact', /@/.test(picked) && /, $/.test(picked), picked);
    await js(`${helpers} setVal('compose-to', 'friend@example.com'); setVal('compose-subject', 'Hello from Roost UI'); return true;`);
    // Rich text: type, select a word, make it bold, add a bulleted list
    const boldRun = await js(`${helpers} try { const b=document.getElementById('compose-body'); b.focus(); document.execCommand('insertText', false, 'New email body');
      const w=document.createTreeWalker(b, NodeFilter.SHOW_TEXT); const tn=w.nextNode(); const r=document.createRange(); r.setStart(tn,0); r.setEnd(tn,3);
      const s=getSelection(); s.removeAllRanges(); s.addRange(r); document.getElementById('fmt-bold').click(); return 'ok'; } catch (e) { return String(e.stack || e) + ' | ' + document.getElementById('compose-body').innerHTML; }`);
    if (boldRun !== 'ok') step('select text in the editor', false, boldRun);
    step('Bold button makes the selection bold', await js(`return /<b>New<\\/b>/.test(document.getElementById('compose-body').innerHTML) && document.getElementById('fmt-bold').getAttribute('aria-pressed') === 'true';`),
      await js(`return document.getElementById('compose-body').innerHTML;`));
    await js(`const b=document.getElementById('compose-body'); const r=document.createRange(); r.selectNodeContents(b); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r);
      document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'point one'); document.getElementById('fmt-ul').click(); return true;`);
    step('Bulleted list button makes a list', await js(`return !!document.querySelector('#compose-body ul li');`), await js(`return document.getElementById('compose-body').innerHTML;`));
    await js(`document.getElementById('fmt-color').click(); return true;`);
    step('Color menu shows text and background colors', await js(`return !document.getElementById('fmt-pop').hidden && document.querySelectorAll('#fmt-pop .fmt-swatch').length === 112;`));
    await shot('format');
    await js(`document.getElementById('fmt-color').click(); return true;`);
    await shot('compose');
    await js(`document.getElementById('compose-send').click(); return true;`);
    await wait(1500);
    const sent2 = await (await fetch('http://127.0.0.1:47556/')).json().catch(() => ({ sent: [] }));
    const l2 = sent2.sent[sent2.sent.length - 1];
    step('Compose sends a new email', l2 && l2.headers.subject === 'Hello from Roost UI' && /friend@example\.com/.test(l2.headers.to), l2 && l2.headers);
    const rawSent = l2 ? Buffer.from(l2.raw, 'base64url').toString('utf8') : '';
    const htmlPart = (() => { const m = rawSent.match(/Content-Type: text\/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/); return m ? Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8') : ''; })();
    step('the email is sent as rich text (HTML + plain text)', /multipart\/alternative/.test(rawSent) && /<b>New<\/b>/.test(htmlPart) && /<li>point one<\/li>/.test(htmlPart) && /New email body/.test(l2.text), htmlPart.slice(0, 300));

    await js(`document.getElementById('search-input').focus(); document.getElementById('search-input').value = 'invoice'; document.getElementById('search-form').requestSubmit(); return true;`);
    step('Search shows matching mail', await until(`const r=[...document.querySelectorAll('#thread-list .row')]; return r.length >= 1 && r.every((x) => /invoice/i.test(x.textContent));`));

    win.setSize(820, 700);
    await wait(1200);
    await shot('narrow');
    const narrow = await js(`const w = (id) => document.getElementById(id).getBoundingClientRect().width; return { list: w('col-list'), reader: w('col-reader'), back: !![...document.querySelectorAll('button')].find((b) => /back/i.test(b.getAttribute('aria-label') || b.textContent) && b.offsetWidth) };`);
    step('narrow window shows one full-width column with Back', Math.max(narrow.list, narrow.reader) > 500 && Math.min(narrow.list, narrow.reader) < 50 && narrow.back, narrow);
    const badge = (getState().services.find((s) => s.type === 'gmail') || {}).unread;
    step('sidebar badge shows inbox unread', typeof badge === 'number' && badge > 0, badge);
  } catch (err) {
    step('crashed', false, err.stack);
  }
  fs.writeFileSync(path.join(dir, 'ui.json'), JSON.stringify(out, null, 2));
  quit();
};
