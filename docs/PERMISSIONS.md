# Permissions and prompts

Roost is not notarized by Apple, so you will see some prompts. Here is each one and what to click.

## 1. Gatekeeper: "Roost can't be opened"

Roost is ad-hoc signed and not notarized. macOS blocks the first launch.

Do one of these:
- Right-click `Roost.app`, click **Open**, then click **Open**.
- Or open **System Settings > Privacy & Security**, scroll down, and click **Open Anyway** next to Roost.
- If you downloaded a built copy, you can clear the quarantine flag:

```bash
xattr -dr com.apple.quarantine /Applications/Roost.app
```

You only do this once per build.

## 2. Keychain: "Roost wants to use your confidential information stored in 'Roost Safe Storage'"

Roost encrypts your Google tokens and cookies with a key kept in the macOS Keychain.

1. Enter your **Mac password**.
2. Click **Always Allow**.

This prompt comes back after each rebuild. An ad-hoc signature changes every build, so macOS sees a "new" app.

## 3. Notifications

macOS asks if Roost may send notifications. Click **Allow**. You can change it later in **System Settings > Notifications > Roost**. Inside Roost, use Settings (⌘,) to set notifications per app.

## 4. Microphone and camera

When WhatsApp, Slack, Discord and others start a call, macOS asks for microphone or camera access. Click **OK** (or **Allow**). Roost includes the usage text for these prompts. Change it later in **System Settings > Privacy & Security > Microphone** or **Camera**.

Screen sharing in calls needs **Screen Recording**. macOS asks the first time.

Roost also checks if any app is using the microphone, so it can go quiet during calls (Settings > Quiet time). It does not record audio.

## 5. Google consent screen (in your browser)

When you click **Sign in with Google**, your browser opens Google's own page.

- Pick the account and click **Continue**.
- Tick the Gmail (or Calendar) permission box.
- If your Google app is **In production** without verification, you will see **Google hasn't verified this app**. Click **Advanced**, then **Go to Roost (unsafe)**. This is your own app, so it is safe.
- If Google says **Access blocked ... has not completed the Google verification process**, add that Gmail address under **Test users**. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

Roost asks for two scopes:
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar`

## 6. Open at Login

Open the **Roost** menu and tick **Open at Login**. This works in the packaged app only.

## 7. Google Chrome

Keep, Drive and Docs open in a private Chrome window with its own profile, stored in `~/Library/Application Support/Roost/chrome-profiles/`. It does not touch your normal Chrome profile. Chrome must be installed.

## Take permissions back

- macOS permissions: **System Settings > Privacy & Security**.
- Google access: <https://myaccount.google.com/permissions>.
- All Roost data: see "Remove Roost and all data" in [INSTALL.md](INSTALL.md).
