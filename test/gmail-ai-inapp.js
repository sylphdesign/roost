// Runs INSIDE Roost (ROOST_E2E_SCRIPT). Uses the AI writing tools on the Gmail screen like a person would.
// Phase "fake" runs with ROOST_AI_FAKE=1 (AI on, fixed answers). Phase "nokey" has no AI key.
// Writes <phase>.json + screenshots to ROOST_E2E_OUT.
const { webContents } = require('electron');
const fs = require('fs');
const path = require('path');

module.exports = async ({ quit }) => {
  const phase = process.env.ROOST_E2E_PHASE || 'fake';
  const out = { steps: [], screenshots: [] };
  const dir = process.env.ROOST_E2E_OUT;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const step = (name, ok, detail = null) => out.steps.push({ name, ok: !!ok, detail });
  let wc;
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { try { const f = path.join(dir, `ai-${phase}-${name}.png`); fs.writeFileSync(f, (await wc.capturePage()).toPNG()); out.screenshots.push(f); } catch (e) { out.screenshots.push(`${name}: not captured (${e.message})`); } };
  const until = async (code, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await js(code)) return true; await wait(200); } return false; };
  const H = `
    const $ = (id) => document.getElementById(id);
    const vis = (id) => { const n = $(id); return !!n && !n.hidden && getComputedStyle(n).display !== 'none'; };
    const setVal = (id, v) => { const n = $(id); n.focus(); n.value = v; n.dispatchEvent(new Event('input', { bubbles: true })); };
    const byText = (sel, re) => [...document.querySelectorAll(sel)].find((n) => re.test(n.textContent || n.getAttribute('aria-label') || ''));
    const key = (n, k, extra) => n.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
    const panelMode = () => vis('ai-panel') ? $('ai-panel').dataset.mode : null;
    const body = () => $('compose-body').value;
    window.confirm = () => true;
  `;
  const panel = () => js(`${H} return { mode: panelMode(), text: $('ai-panel').textContent.slice(0, 300) };`);
  try {
    for (let i = 0; i < 40 && !wc; i++) { wc = webContents.getAllWebContents().find((w) => w.getURL().includes('/gmail/index.html')); if (!wc) await wait(250); }
    await wait(1500);
    await until(`${H} return vis('screen-setup');`);
    await js(`${H} setVal('setup-client-id', '123-abc.apps.googleusercontent.com'); setVal('setup-client-secret', 'GOCSPX-test'); $('setup-save').click(); return true;`);
    await until(`${H} return vis('screen-signin');`);
    await js(`document.getElementById('signin-btn').click(); return true;`);
    step('signed in to the fake mailbox', await until(`${H} return vis('screen-mail') && document.querySelectorAll('#thread-list .row').length > 3;`, 15000));
    await wait(600);

    await js(`${H} byText('#thread-list .row-open', /Project kickoff/).click(); return true;`);
    await until(`return document.querySelectorAll('#reader article.msg').length === 3;`);
    step('Summarize button is in the thread toolbar', await js(`return !!document.querySelector('.reader-toolbar .ai-summarize-btn:not([disabled])');`));

    if (phase === 'fake') {
      // ---- Reader: smart replies + summary ----
      const chipsOk = await until(`return document.querySelectorAll('.smart-replies .smart-reply').length === 3;`);
      const chips = await js(`return [...document.querySelectorAll('.smart-replies .smart-reply')].map((b) => b.textContent);`);
      step('smart reply chips show 3 suggestions', chipsOk && chips[1] === 'Sounds good to me.', chips);
      step('smart replies sit below the last message', await js(`const s=document.querySelector('.smart-replies'); return s.previousElementSibling.classList.contains('messages') && s.nextElementSibling.classList.contains('reply-bar');`));

      await js(`document.querySelector('.ai-summarize-btn').click(); return true;`);
      const sumOk = await until(`const c=document.querySelector('.ai-summary'); return !!c && /Summary of: Project kickoff/.test(c.textContent);`);
      step('Summarize shows a summary card at the top (with thread context)', sumOk && await js(`const c=document.querySelector('.ai-summary'); return c.previousElementSibling.classList.contains('thread-head') && !!c.querySelector('ul.ai-bullets li');`),
        await js(`const c=document.querySelector('.ai-summary'); return c && c.textContent;`));
      await shot('reader');
      await js(`document.querySelector('.ai-summary .ai-close').click(); return true;`);
      step('summary card closes', await until(`return !document.querySelector('.ai-summary');`));

      // ---- Smart reply opens compose ----
      await js(`${H} byText('.smart-reply', /Sounds good/).click(); return true;`);
      const replyOk = await until(`${H} return vis('compose') && body().startsWith('Sounds good to me.');`);
      step('clicking a chip opens Reply with that text', replyOk && await js(`${H} return /wrote:/.test(body()) && /^Re: /.test($('compose-subject').value);`),
        await js(`${H} return body().slice(0, 120);`));
      step('AI button says Refine when the body has text', await js(`${H} return $('compose-ai-label').textContent === 'Refine';`), await js(`${H} return $('compose-ai-label').textContent;`));
      step('Open in Gmail button is in compose', await js(`${H} return vis('compose-gmail') && $('compose-gmail').getAttribute('aria-label') === 'Open in Gmail';`));

      // ---- Refine: Polish + Undo ----
      await js(`${H} $('compose-ai').click(); return true;`);
      const p1 = await until(`${H} return panelMode() === 'refine';`);
      const items = await js(`return [...document.querySelectorAll('#ai-panel .ai-item')].map((b) => b.textContent);`);
      step('Refine menu lists all options', p1 && ['Polish', 'Formalize', 'Make casual', 'Shorten', 'Elaborate', 'Proofread', 'Bullet points', 'Suggest subject'].every((x) => items.includes(x)), items);
      step('Refine menu gets focus; arrow keys move', await js(`${H} const it=[...document.querySelectorAll('#ai-panel .ai-item')]; if (document.activeElement !== it[0]) return false; key(it[0], 'ArrowDown'); return document.activeElement === it[1];`));
      await shot('refine');
      await js(`${H} byText('#ai-panel .ai-item', /^Polish$/).click(); return true;`);
      const polished = await until(`${H} return body().startsWith('AI rewrite polish: Sounds good to me.');`);
      step('Polish replaces only my text and keeps the quote', polished && await js(`${H} return /\\n\\nOn .* wrote:\\n> /.test(body()) && !vis('ai-panel');`), await js(`${H} return body().slice(0, 160);`));
      step('toast offers Undo', await js(`return /Polished/.test(document.getElementById('toasts').textContent) && !!document.querySelector('#toasts .link-btn');`), await js(`return document.getElementById('toasts').textContent;`));
      await js(`document.querySelector('#toasts .link-btn').click(); return true;`);
      step('Undo restores the previous body', await until(`${H} return body().startsWith('Sounds good to me.\\n');`), await js(`${H} return body().slice(0, 80);`));

      // ---- Working state + cancel (late result is ignored) ----
      await js(`${H} $('compose-ai').click(); return true;`);
      await until(`${H} return panelMode() === 'refine';`);
      const busy = await js(`${H} byText('#ai-panel .ai-item', /^Shorten$/).click(); const r = { mode: panelMode(), disabled: $('compose-ai').disabled, label: $('compose-ai-label').textContent, readOnly: $('compose-body').readOnly, send: $('compose-send').disabled, cancel: !!$('ai-cancel') }; $('ai-cancel').click(); return r;`);
      step('while working: buttons disabled, Writing… shown, Cancel offered', busy.mode === 'working' && busy.disabled && busy.label === 'Writing…' && busy.readOnly && busy.send && busy.cancel, busy);
      await wait(1000);
      step('Cancel ignores the late result', await js(`${H} return body().startsWith('Sounds good to me.\\n') && panelMode() === 'refine' && !$('compose-ai').disabled && !$('compose-body').readOnly;`), await panel());
      await js(`${H} key($('ai-panel').querySelector('.ai-item'), 'Escape'); return true;`);
      step('Esc closes the AI panel but keeps the draft', await js(`${H} return !vis('ai-panel') && vis('compose');`));

      // ---- Refine with a free prompt (write with draft) ----
      await js(`${H} $('compose-ai').click(); return true;`);
      await until(`${H} return panelMode() === 'refine';`);
      await js(`${H} const i=$('ai-input'); i.value = 'make it warmer'; key(i, 'Enter'); return true;`);
      step('free prompt in Refine updates the draft', await until(`${H} return body().startsWith('AI write: make it warmer');`), await js(`${H} return body().slice(0, 80);`));
      await js(`${H} $('compose-discard').click(); return true;`);
      await until(`${H} return !vis('compose');`);

      // ---- New message: Help me write + Suggest subject ----
      await js(`${H} $('compose-btn').click(); return true;`);
      await until(`${H} return vis('compose');`);
      step('AI button says Help me write on an empty draft', await js(`${H} return $('compose-ai-label').textContent === 'Help me write';`));
      await js(`${H} $('compose-ai').click(); return true;`);
      const wOpen = await until(`${H} return panelMode() === 'write' && document.activeElement === $('ai-input');`);
      step('Help me write opens a prompt box with focus', wOpen, await panel());
      await shot('help-me-write');
      await js(`${H} const i=$('ai-input'); i.value = 'Invite the team to lunch on Friday'; key(i, 'Enter'); return true;`);
      step('Enter creates a new draft', await until(`${H} return body() === 'AI write: Invite the team to lunch on Friday' && !vis('ai-panel');`), await js(`${H} return body();`));
      step('after writing, the button says Refine', await js(`${H} return $('compose-ai-label').textContent === 'Refine';`));
      await js(`${H} $('compose-ai').click(); return true;`);
      await until(`${H} return panelMode() === 'refine';`);
      await js(`${H} byText('#ai-panel .ai-item', /Suggest subject/).click(); return true;`);
      step('Suggest subject fills an empty subject', await until(`${H} return $('compose-subject').value === 'AI subject: AI write: Invite the team to lunch on Friday';`), await js(`${H} return $('compose-subject').value;`));
      await js(`${H} window.confirm = () => false; $('compose-ai').click(); return true;`);
      await until(`${H} return panelMode() === 'refine';`);
      await js(`${H} byText('#ai-panel .ai-item', /Suggest subject/).click(); return true;`);
      await wait(800);
      step('Suggest subject keeps my subject when I say no', await js(`${H} return $('compose-subject').value === 'AI subject: AI write: Invite the team to lunch on Friday';`));
      await js(`${H} window.confirm = () => true; $('compose-discard').click(); return true;`);
      // Focus re-check must not break anything.
      await js(`window.dispatchEvent(new Event('focus')); return true;`);
      await wait(400);
      step('screen still works after a focus re-check', await js(`${H} return vis('screen-mail');`));
    } else {
      // ---- No AI key ----
      await wait(1500);
      step('no smart replies without a key', await js(`const s=document.querySelector('.smart-replies'); return !!s && s.hidden && !s.children.length;`));
      await js(`document.querySelector('.ai-summarize-btn').click(); return true;`);
      step('Summarize without a key asks to add one', await until(`const c=document.querySelector('.ai-summary'); return !!c && /add your Claude key/.test(c.textContent);`),
        await js(`const c=document.querySelector('.ai-summary'); return c && c.textContent;`));
      await js(`${H} $('compose-btn').click(); return true;`);
      await until(`${H} return vis('compose');`);
      step('sparkle button still shows', await js(`${H} return vis('compose-ai');`));
      await js(`${H} $('compose-ai').click(); return true;`);
      const sOk = await until(`${H} return panelMode() === 'setup';`);
      step('setup panel: Turn on AI writing + Settings + Gmail options', sOk && await js(`${H} return /Turn on AI writing/.test($('ai-panel').textContent) && !!$('ai-open-settings') && /Gmail’s own AI/.test($('ai-use-gmail').textContent);`), await panel());
      await shot('setup');
      await js(`${H} $('ai-open-settings').click(); return true;`);
      await wait(800);
      step('Open Roost Settings works (no error)', await js(`return !document.querySelector('#toasts .toast.error');`), await js(`return document.getElementById('toasts').textContent;`));
      await js(`${H} key($('ai-open-settings'), 'Escape'); return true;`);
      step('Esc closes the setup panel', await js(`${H} return !vis('ai-panel') && vis('compose');`));
    }
  } catch (err) {
    step('crashed', false, err.stack);
  }
  fs.writeFileSync(path.join(dir, `${phase}.json`), JSON.stringify(out, null, 2));
  quit();
};
