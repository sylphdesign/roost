// Read the unread count from a page title.
// "Inbox (12) - me@gmail.com - Gmail" -> 12, "(3) WhatsApp" -> 3, "* Slack" -> dot.
function parseUnread(title = '') {
  const m = String(title).match(/\((\d[\d,.]*)\)/);
  const count = m ? parseInt(m[1].replace(/[,.]/g, ''), 10) || 0 : 0;
  const dot = count === 0 && /^\s*[*!•●]/.test(String(title));
  return { count, dot };
}

module.exports = { parseUnread };
