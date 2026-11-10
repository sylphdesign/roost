# Security

## Report a problem privately

Please do not open a public issue for a security problem.

1. Go to <https://github.com/sylphdesign/roost/security/advisories>.
2. Click **Report a vulnerability**.
3. Say what you found, how to repeat it, and what could happen.

We will reply as soon as we can. Please give us time to fix it before you share it.

## Never paste secrets

Do not put real Google tokens, Client secrets, Claude API keys, passwords or email content in issues, pull requests or logs. Hide them first. Use placeholders like `YOUR_CLIENT_ID`. If you leaked a secret, revoke it now: delete the OAuth client in Google Cloud, remove access at <https://myaccount.google.com/permissions>, or rotate the Claude key in the Anthropic console.

## What is in scope

- Roost's own code in this repo (`src/`, `native/`).
- How Roost stores and sends tokens, keys and mail data.
- Sign-in flow bugs (Google loopback sign-in with PKCE).
- Ways a web page or email could run code or read data it should not.

Out of scope: problems in Google, Anthropic, WhatsApp, Slack, Telegram, Discord or Messenger themselves; problems that need full control of your Mac or your unlocked account; missing Apple notarization (known, see [docs/PERMISSIONS.md](docs/PERMISSIONS.md)).

## What is stored where

All on your Mac, in `~/Library/Application Support/Roost/`.

| Data | Where | Protection |
| --- | --- | --- |
| Google sign-in tokens | `gmail-accounts.json` | Encrypted with the macOS Keychain (Electron `safeStorage`, item "Roost Safe Storage") |
| Claude API key (if you add one) | Roost settings | Encrypted the same way |
| Your Google Client ID and secret | Roost settings | Stays local. Your own key, not shared. |
| Apps, names, settings | `config.json` | Plain file |
| Cookies and sessions of each app | `Partitions/` | Private storage per app |
| Private Chrome profiles (Keep, Drive, Docs) | `chrome-profiles/` | Normal Chrome profile files |

## What leaves your Mac

- Calls to Google (Gmail API, Calendar API, sign-in) with your own OAuth client.
- Calls to Anthropic only if you add a Claude key and click an AI button. The email text you ask about is sent with that request.
- The messenger apps (WhatsApp, Slack and so on) talk to their own services, like in a browser.

Roost has no server of its own. It sends no analytics.

## How sign-in works

Roost opens Google's own page in your browser. It listens on `127.0.0.1` for the answer and uses PKCE. It never sees your Google password. Emails show images by default. Scripts in emails are blocked.

## Supported versions

Only the latest version on `main` gets fixes.
