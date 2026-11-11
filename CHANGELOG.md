# Changelog

## Unreleased

### Added
- **Rich text composer.** The Gmail compose box is now a rich text editor with a Gmail-style formatting bar: undo/redo, font, size, bold, italic, underline, text and background color, align, numbered and bulleted lists, indent, quote, strikethrough, remove formatting and links. Gmail keyboard shortcuts work (⌘K, ⌘⇧7, ⌘⇧8, ⌘⇧9, ⌘], ⌘[, ⌘\\, ⌘Enter to send). The "Aa" button shows or hides the bar.
- **HTML email.** Emails are sent as `multipart/alternative` (HTML plus plain text). Pasted HTML is cleaned first: no scripts, images, frames or unsafe links.
- **Recipient autofill** in To, Cc and Bcc, ranked by who you write to most. Built from your own mail headers (new Gmail method `listContacts`); no new Google scope.
- **Smart Compose** with your Claude key: gray suggestions while you type, Tab or → to accept, ✨ to turn off (new AI task `complete`).
- Reply quotes now sit behind a "•••" button, like Gmail, and are sent as a Gmail-style quote.
- Non-ASCII names in To, Cc and Bcc are encoded (RFC 2047).
- New app test `test/gmail-ui.e2e.js` (compose, formatting, autofill, HTML sending). The fake Gmail server now supports `GET messages`.

### Notes
- Google's own Gemini writing features are not offered to other apps, so Smart Compose uses Claude. The ↗ button opens the draft in Gmail in your browser.
- Smart Compose calls Claude on each pause in typing. That uses your Anthropic API credits.
