# Changelog

## 0.2.3 — 2026-11-27

### Safer
- **Only files you pick can be attached.** Roost attaches a file to an email only if you chose it in the file dialog.
- **Google sign-ins are never saved as plain text.** If the macOS Keychain is not available, Roost says so and does not save the sign-in.

### Added
- **Error log on your Mac.** Roost writes errors to `~/Library/Logs/Roost/roost.log`. Help › Show Error Log opens it. Nothing is sent anywhere.
- **Intel Macs:** `npm run dist:universal` builds one app for Intel and Apple Silicon.
- **Automatic tests on GitHub** for each push and pull request.

### Fixed
- **Email view in small windows.** In a Roost window 980 px wide or less, the List width setting now works, and "Under the list" puts the email under the list (it was next to it).

### Changed
- Electron 45.5.0 (security fixes) and Anthropic SDK 1.14.0.

## 0.2.2 — 2026-11-27

Safety and reliability fixes.

### Safer
- **Links cannot open fake pages inside Roost.** A link like `google.attacker.com/url?q=…` is no longer seen as a Google link. Roost decides about a popup from the page that really loads. A popup can only go to the app's own site or a sign-in page; other pages open in your browser.
- **Camera, microphone and clipboard only for the app's own site.** Other sites inside an app get no permissions.
- **Test settings do nothing in the installed app.** The `ROOST_*` environment variables (for tests) are ignored when Roost is packaged, so they cannot send your keys to another server.
- Reply headers (In-Reply-To, References) cannot add extra lines to a sent email.

### Fixed
- **Calendar reminders are correct.** A moved, deleted or declined meeting no longer gives an old reminder. After your Mac sleeps, Roost does not show a reminder for a meeting that already started, and it checks mail and reminders again when the Mac wakes.
- **No double new-mail alerts.** Mail checks cannot overlap. A Google request that gets no answer stops after 30 seconds, with a clear message.
- **Rate limit:** after Google says "too fast", Roost starts slowly again, not with a full burst. Calendar now also waits before it tries again, and the message names the right service.
- **Recipient autofill** tries again when loading contacts fails, and Roost does not keep a partial contact list.
- **Sign-out clears** the contact list and summaries of that account.
- **Sign-in:** parallel requests share one token refresh, and a late error cannot sign you out right after you sign in.
- Notification clicks always open the email or event.

### Changed
- **Smart Compose uses Claude Haiku** with short replies. It costs much less than before. Other AI writing still uses Claude Opus.

## 0.2.1 — 2026-11-12

A fix for Gmail's "Quota exceeded" error.

### Fixed
- **No more random "Quota exceeded … Units per minute per user" errors.** Google limits how fast one user can call Gmail, and it blocks short bursts. Roost sent too many requests at the same time (for example, 20 at once to build your contact list). Now:
  - Roost **paces its Gmail requests** under Google's limit, with a small burst allowance. Each request counts with Google's own cost (a thread is 10 units, a message is 5, sending is 100).
  - When Google still says "too fast", Roost **waits and tries again** (1, 2, 4, then 8 seconds, or the wait Google asks for), and all other requests wait too. Only after that do you see a message: "Gmail is busy … Wait one minute, then try again."
  - **Fewer requests.** Roost does not fetch an email again when it did not change. A refresh after new mail now needs a few requests, not one for each email in the list.
  - Fewer requests at the same time: 4 for mail lists (was 8), 3 per folder for contacts (was 10).

### Notes
- Your contact list for recipient autofill now fills in about 5–8 seconds. It loads in the background and is kept for 30 minutes.
- New tests for the request costs, the retry and the summary cache.

## 0.2.0 — 2026-11-11

An easier start, a calmer sidebar and safer mistakes. Plus a new Gmail composer.

### Easier to start
- **Welcome tiles.** Pick your apps from tiles and add them all with one click. Each tile says what it needs ("Just sign in", or "Needs your own Google key · about 10 min").
- **Connect Gmail is now a 4-step guide** with a progress bar and "minutes left". Drop the downloaded `client_secret_….json` file to fill in both fields, or paste the whole file into a field. The fields say "✓ Looks right" as you type and catch a wrong Client ID before you save. The step you were on is remembered.
- **No surprise at sign-in.** Before you click Sign in, Roost shows what Google's "Google hasn't verified this app" page looks like and what to click.

### Calmer
- **Red badges mean people.** A red number counts unread mail in your Primary tab and unread chats. Other unread mail (Promotions, Updates …) shows a gray number. A dot is gray. The Dock and menu bar count only red numbers.
- **Real app icons** for WhatsApp, Slack, Telegram, Discord and Messenger, instead of letters.
- **Settings has a menu**: Quiet time · Email view · Sounds · Apps · AI writing. Apps lists only the apps you changed, with "Show all apps".
- **Quiet time shows when it ends**: "Quiet until 07:00".
- **The shortcut bar steps back.** After you use a shortcut 5 times, it leaves the bar. When you know them all, the bar says so once and hides in your inbox. ⌘/ still shows every shortcut.

### Safer
- **Undo for Delete.** "Moved to Trash · Undo" now works like Archive, for one email or many. Undo puts the email back in your Inbox.
- **Heads-up before the 7-day sign-out.** With a Google key in Testing mode, Google ends your sign-in every 7 days. About a day before, a banner offers "Sign in now" or "Later". (Starts after your next sign-in.)
- **Ticked rows look different** from the open email: ticked rows are blue, the open email is purple with a stripe.

### Clearer
- **Words on the reader toolbar**: Archive, Delete, Unread, Summary. Reply, Reply all and Forward appear once, under the email, with Reply as the main button.
- **"All done" when an inbox tab is empty**, with how many emails you cleared today and your next meetings from Google Calendar.
- **Inbox tabs that do not fit** fade at the edge and get a › button.

### Composer
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

## 0.1.0 — 2026-11-10

First public release: Gmail and Google Calendar inside Roost (official Google APIs), WhatsApp, Slack, Telegram, Discord and Messenger in one window, many accounts, search all inboxes, quiet time, optional Claude writing help.
