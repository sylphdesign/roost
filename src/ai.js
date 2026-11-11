// AI writing help for Gmail inside Roost ("Help me write", refine, smart replies, summaries).
// Uses Claude through the official Anthropic SDK with the user's own API key (saved in Settings).
// Called from src/main.js (handleApiCall, method "ai").
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';
const STYLES = {
  polish: 'Polish it: fix grammar, make it clear and natural. Keep the meaning, tone and length.',
  formal: 'Make it more formal and professional.',
  casual: 'Make it more casual and friendly.',
  shorter: 'Make it shorter and more direct. Keep all key facts.',
  longer: 'Elaborate: add helpful detail and make it fuller, without inventing facts.',
  proofread: 'Proofread: only fix spelling, grammar and punctuation. Change nothing else.',
  bullets: 'Rewrite the main points as a short intro line plus "- " bullet points.',
};
const TASKS = new Set(['write', 'rewrite', 'replies', 'summarize', 'subject', 'complete']);

const SYSTEM = `You help a person write email in their mail app. Write as the person (first person), in plain text.
Never add a subject line, notes, quotes around the text, or explanations: output only what was asked for.
Do not invent facts, names, dates or promises; if something is unknown, leave a short [placeholder].
Match the language of the person's request or draft.`;

class AiError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
}

const clip = (s, n) => String(s || '').slice(0, n);

function threadText(thread) {
  if (!thread || !Array.isArray(thread.messages) || !thread.messages.length) return '';
  const msgs = thread.messages.slice(-10).map((m, i) => `--- Message ${i + 1}\nFrom: ${clip(m.from, 200)}\nDate: ${clip(m.date, 80)}\n\n${clip(m.text, 4000)}`);
  return `<thread subject="${clip(thread.subject, 300).replace(/"/g, "'")}">\n${msgs.join('\n\n')}\n</thread>`;
}

// Build the user prompt for one task. Exported for tests.
function buildPrompt({ task, prompt, draft, style, to, subject, thread }) {
  if (!TASKS.has(task)) throw new AiError('Unknown AI task.');
  const ctx = threadText(thread);
  const head = [ctx && `This is the email conversation I am replying to:\n${ctx}`, to && `To: ${clip(to, 500)}`, subject && `Subject: ${clip(subject, 300)}`].filter(Boolean).join('\n\n');
  const draftBlock = draft ? `<draft>\n${clip(draft, 20000)}\n</draft>` : '';
  switch (task) {
    case 'write':
      if (!String(prompt || '').trim()) throw new AiError('Say what the email should be about.');
      return [head, draftBlock && `My current draft:\n${draftBlock}`, `Write the email body. What I want: ${clip(prompt, 4000)}`].filter(Boolean).join('\n\n');
    case 'rewrite':
      if (!String(draft || '').trim()) throw new AiError('Write something first.');
      if (!STYLES[style]) throw new AiError('Unknown style.');
      return [head, draftBlock, `${STYLES[style]} Output only the new email body.`].filter(Boolean).join('\n\n');
    case 'subject':
      if (!String(draft || '').trim()) throw new AiError('Write something first.');
      return `${draftBlock}\n\nWrite one short subject line for this email (max 8 words). Output only the subject line.`;
    case 'complete':
      // Smart Compose: a few words that continue the draft at the cursor (shown as gray text, Tab to accept).
      if (!String(draft || '').trim()) throw new AiError('Write something first.');
      return [head, `My email so far (it stops where my cursor is):\n<draft>\n${clip(draft, 6000).slice(-3000)}\n</draft>`,
        `Predict how I continue, right where the draft stops. Output only the next words: at most 10 words, never past the end of the current sentence.
If the draft stops in the middle of a word, start by finishing that word (no leading space). Otherwise start with one space.
Never repeat text from the draft. If you are not confident what comes next, output exactly: <none>`].filter(Boolean).join('\n\n');
    case 'replies':
      if (!ctx) throw new AiError('No conversation.');
      return `${ctx}\n\nSuggest 3 different short replies I could send to the last message (each max 12 words, plain sentences).
Output exactly 3 lines, one reply per line, no numbers or bullets.`;
    case 'summarize':
      if (!ctx) throw new AiError('No conversation.');
      return `${ctx}\n\nSummarize this conversation for me in 2-5 short "- " bullet points: what it is about, what was decided, and what is asked of me.`;
    default: throw new AiError('Unknown AI task.');
  }
}

function parseReplies(text) {
  return String(text || '').split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["“]|["”]$/g, '').trim())
    .filter(Boolean).slice(0, 3);
}

// Smart Compose answer: one line, no quotes, no "<none>", no repeat of the draft. Keeps a leading space.
function cleanCompletion(raw, draft) {
  let t = String(raw || '').split(/\r?\n/).find((l) => l.trim()) || '';
  if (/<none>/i.test(t)) return '';
  t = t.replace(/^(\s?)["“]/, '$1').replace(/["”]\s*$/, '').replace(/\s+$/, '');
  const d = String(draft || '');
  let lead = /^\s/.test(t) && !/\s$/.test(d) ? ' ' : '';
  let body = t.trim();
  // The model sometimes starts by repeating the end of the draft: drop the longest repeated word run.
  const dt = d.trimEnd();
  const lower = body.toLowerCase();
  for (let k = Math.min(dt.length, 80); k >= 4; k--) {
    const suffix = dt.slice(-k);
    if (/\w/.test(dt[dt.length - k - 1] || '') || !lower.startsWith(suffix.toLowerCase())) continue;
    if (k === body.length || /\W/.test(body[k] || ' ')) {
      body = body.slice(k).trim();
      if (!/\s$/.test(d) && /^\w/.test(body)) lead = ' ';
      break;
    }
  }
  const words = body.split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  return lead + words.slice(0, 12).join(' ');
}

function fakeAnswer(a) {
  if (a.task === 'replies') return { replies: ['Thanks, got it!', 'Sounds good to me.', 'Let me check and get back to you.'] };
  if (a.task === 'summarize') return { text: `- Summary of: ${a.thread?.subject || ''}` };
  if (a.task === 'complete') return { text: /\s$/.test(a.draft) ? 'thanks for your help.' : ' and thanks for your help.' };
  return { text: `AI ${a.task}${a.style ? ` ${a.style}` : ''}: ${a.prompt || a.draft || ''}` };
}

// getKey() returns the saved API key or null.
async function runAiTask(args, { getKey, fake = !!process.env.ROOST_AI_FAKE, baseURL = process.env.ROOST_ANTHROPIC_BASE_URL } = {}) {
  const a = args && typeof args === 'object' ? args : {};
  const userPrompt = buildPrompt(a); // validates first
  if (fake) return fakeAnswer(a);
  const apiKey = getKey();
  if (!apiKey) throw new AiError('Add your Claude API key in Roost Settings to use AI writing.', { needsAiKey: true });
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 1, timeout: 120000 });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low' }, // short writing tasks: fast answers
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('Your Claude API key was not accepted. Check it in Roost Settings.', { needsAiKey: true });
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Claude is busy right now. Try again in a moment.');
    if (err instanceof Anthropic.APIConnectionError) throw new AiError('Cannot reach Claude. Check your internet connection.');
    if (err instanceof Anthropic.APIError) throw new AiError(`Claude error: ${err.message}`);
    throw err;
  }
  if (msg.stop_reason === 'refusal') throw new AiError('Claude could not help with this one.');
  const raw = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (a.task === 'complete') return { text: cleanCompletion(raw, a.draft) };
  const text = raw.trim();
  if (!text) throw new AiError('Claude gave no answer. Try again.');
  if (a.task === 'replies') return { replies: parseReplies(text) };
  if (a.task === 'subject') return { text: text.split('\n')[0].replace(/^subject:\s*/i, '').replace(/^["“]|["”]$/g, '').trim() };
  return { text };
}

module.exports = { runAiTask, buildPrompt, parseReplies, cleanCompletion, STYLES, MODEL, AiError };
