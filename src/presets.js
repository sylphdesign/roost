// Built-in app types. "url" is where a new account of this type starts.
// "icon" is shown until the app's own page icon loads (and for apps that never load a page icon).
// "group" is where a new app goes: 'mail' (top of the sidebar), 'chat' (below the line) or 'top' (the bar at the top).
const fs = require('fs');
const path = require('path');

// Chat app icons ship with Roost (src/app-icons), so showing them sends no request to those companies.
function bundledIcon(name) {
  try { return 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, 'app-icons', name + '.png')).toString('base64'); } catch { return null; }
}

const PRESETS = [
  { type: 'gmail', name: 'Gmail', url: 'https://mail.google.com/mail/', color: '#EA4335', group: 'mail', googleWindow: true, titleHint: 'gmail', icon: 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico' },
  { type: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com/', color: '#25D366', group: 'chat', icon: bundledIcon('whatsapp') },
  { type: 'slack', name: 'Slack', url: 'https://app.slack.com/client', color: '#4A154B', group: 'chat', icon: bundledIcon('slack') },
  { type: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/a/', color: '#2AABEE', group: 'chat', icon: bundledIcon('telegram') },
  { type: 'discord', name: 'Discord', url: 'https://discord.com/app', color: '#5865F2', group: 'chat', icon: bundledIcon('discord') },
  { type: 'messenger', name: 'Messenger', url: 'https://www.messenger.com/', color: '#0084FF', group: 'chat', icon: bundledIcon('messenger') },
  { type: 'calendar', name: 'Google Calendar', url: 'https://calendar.google.com/', color: '#4285F4', group: 'top', googleWindow: true, titleHint: 'calendar', icon: 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico' },
  { type: 'drive', name: 'Google Drive', url: 'https://drive.google.com/', color: '#1FA463', group: 'top', googleWindow: true, titleHint: 'drive', icon: 'https://ssl.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png' },
  { type: 'docs', name: 'Google Docs', url: 'https://docs.google.com/document/', color: '#4285F4', group: 'top', googleWindow: true, titleHint: 'docs', icon: 'https://ssl.gstatic.com/images/branding/product/2x/docs_2020q4_48dp.png' },
  { type: 'keep', name: 'Google Keep', url: 'https://keep.google.com/', color: '#FBBC04', group: 'top', googleWindow: true, titleHint: 'keep', icon: 'https://ssl.gstatic.com/images/branding/product/2x/keep_2020q4_48dp.png' },
  { type: 'custom', name: 'Custom', url: '', color: '#6B7280', group: 'chat' },
];
const GROUPS = ['mail', 'chat', 'top'];

module.exports = { PRESETS, GROUPS };
