# Google setup

Gmail and Google Calendar run inside Roost through Google's official APIs. Google needs an "OAuth client" for that. Roost has no server, so **you make your own** (it is free). It takes about 10 minutes. You do it once.

You will:
1. Make a project in Google Cloud.
2. Turn on two APIs.
3. Set up the consent screen.
4. Add yourself as a test user.
5. Make a "Desktop app" key.
6. Paste the key into Roost.

Keep your Client secret private. Never post it or commit it to git.

## Why not just sign in?

Google blocks its normal sign-in inside embedded and automated browsers. So:
- Gmail and Calendar use the official API and your own key.
- Keep, Drive and Docs open in a private Chrome (or Edge or Brave) window with its own profile. Google Chrome must be installed.

## Part 1: Make the project

1. Open <https://console.cloud.google.com/> and sign in with the Google account you want to own the key.
2. If Google shows terms, read and accept them.
3. At the top of the page, click the **project picker** (next to the Google Cloud logo).
4. Click **New project**.
5. For **Project name**, type `Roost` (any name works).
6. Leave **Organization** and **Location** as they are. Click **Create**.
7. Wait a few seconds. Click the project picker again and select your new project. Check that the project name at the top shows `Roost`.

## Part 2: Turn on the APIs

1. Open the menu (three lines, top left). Click **APIs & Services**, then **Library**.
2. In the search box, type `Gmail API`. Click **Gmail API**. Click **Enable**.
3. Go back to **Library**. Search `Google Calendar API`. Click **Google Calendar API**. Click **Enable**.

If you skip the Calendar API, Roost shows: "The Google Calendar API is not turned on for your Google key."

## Part 3: Branding

1. Open the menu. Click **Google Auth Platform**. If you see **Get started**, click it.
2. Click **Branding** in the left list (in the first-time wizard, this is the first form).
3. **App name:** type `Roost` (or any name).
4. **User support email:** pick your email from the list.
5. **Developer contact information:** type your email.
6. Do not upload a logo. A logo can trigger Google's verification.
7. Click **Save** (or **Next** in the wizard).

## Part 4: Audience and Test users

1. In **Google Auth Platform**, click **Audience**. (In the wizard, pick **External** and click **Next**.)
2. **User type** must be **External**. (Internal is only for Google Workspace.)
3. **Publishing status** says **Testing**. Keep it for now.
4. Under **Test users**, click **Add users**.
5. Type each Gmail address you will use in Roost. One per line. The maximum is 100.
6. Click **Save**.

You must add **every** Gmail address. If you forget one, Google shows:

> Access blocked: Roost has not completed the Google verification process (Error 403: access_denied)

Fix: add that address under **Test users**, then try again.

In Testing mode, Google signs you out after **7 days**. You sign in again in Roost. To avoid that, see "Optional: go beyond Testing" below.

## Part 5: Make the Desktop app key

1. In **Google Auth Platform**, click **Clients**.
2. Click **Create client**.
3. **Application type:** choose **Desktop app**. (Not "Web application".)
4. **Name:** type `Roost desktop`.
5. Click **Create**.
6. A box shows **Client ID** and **Client secret**. Copy both. You can open the client later to see them again.

The Client ID looks like `YOUR_CLIENT_ID.apps.googleusercontent.com`. Roost checks for the `.apps.googleusercontent.com` ending.

## Part 6: Paste the key into Roost

1. Open Roost.
2. Click **+** (or press ⌘T). Pick **Gmail**. Name it, for example `Work Gmail`.
3. The first Gmail tile shows a setup form. Paste your **Client ID** and **Client secret**. Save.
4. Click **Sign in with Google**. Your browser opens Google's own page.
5. Pick the Gmail account.
6. If Google says "Google hasn't verified this app", this is normal for your own key. Click **Continue** (in Testing mode). In Production mode, follow the unverified-app steps below.
7. Tick the Gmail permission box. Click **Continue**.
8. Go back to Roost. Your inbox loads.

The same key is reused for Calendar and for every other Gmail account. You paste it once.

Roost asks for these permissions:

| Scope | Used for |
| --- | --- |
| `https://www.googleapis.com/auth/gmail.modify` | Read, send, archive, delete and label mail. |
| `https://www.googleapis.com/auth/calendar` | Read and edit your calendars and events. |

## Calendar and the top bar

- Click the **Google Calendar** button in the top bar. The first time for each account, sign in once for Calendar. Calendar refuses a sign-in with a different account than the one it follows.
- The top bar follows the **active Gmail tab**. Calendar, Keep, Drive and Docs use the account of the last Gmail tab you picked.
- The first time for each account, you sign in once in the private Chrome window for Keep, Drive and Docs.

## Optional: go beyond Testing

Testing mode has two limits: only listed test users can sign in, and sign-ins expire after 7 days. You can move to **In production** without Google verification. This works for personal use.

Rules to follow so Google does not ask for verification:
- Do **not** upload a logo.
- Do **not** add the Gmail or Calendar scopes on the **Data Access** page. (`gmail.modify` is a "restricted" scope. Verifying restricted scopes needs a paid security assessment.) Roost still asks for the scopes when you sign in.

Steps:

1. Get a home page and a privacy policy page on the web. A free GitHub Pages site works (for example `https://YOUR_USERNAME.github.io`). Write a short privacy policy that says you do not collect data.
2. In **Google Auth Platform**, click **Branding**.
3. Under **App domain**, fill **Application home page** and **Application privacy policy link** with your URLs.
4. Under **Authorized domains**, click **Add domain**. Type your domain (for example `YOUR_USERNAME.github.io`). Click **Save**.
5. Click **Audience**.
6. Under **Publishing status**, click **Publish app**. Click **Confirm**. Status changes to **In production**.
7. In Roost, sign in again once. (The old Testing sign-in does not carry over.)
8. On Google's page you will see **Google hasn't verified this app**. Click **Advanced**, then **Go to Roost (unsafe)**. This is safe: it is your own app. Click **Continue**.

What you get:
- Any Google account can sign in.
- No 7-day expiry.
- A lifetime cap of **100 users** on an unverified app.

## Troubleshooting

| You see | Do this |
| --- | --- |
| Access blocked ... has not completed the Google verification process (Error 403) | Add the Gmail address under **Audience > Test users**. |
| Asked to sign in every 7 days | Normal in Testing. Sign in again, or move to Production (above). |
| "The Google Calendar API is not turned on for your Google key" | Enable **Google Calendar API** in **APIs & Services > Library**. |
| "Your sign-in does not include this permission yet" | Sign in again in Roost and tick every permission box on Google's page. |
| Redirect or `redirect_uri` error | The client type must be **Desktop app**. Make a new client. |
| Client ID rejected in Roost | It must end with `.apps.googleusercontent.com`. |

## Take access away

Go to <https://myaccount.google.com/permissions>, pick your Roost app, and remove its access. You can also delete the OAuth client in Google Cloud under **Google Auth Platform > Clients**.
