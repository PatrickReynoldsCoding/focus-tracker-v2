# Choosing files from Google Drive (optional)

You do not need this. **Add from Drive** on a project (Projects tab, or a project's Resources card) always works by pasting Google Docs and Drive addresses. This page is for the extra button **Choose from Google Drive**, which opens Google's own file chooser (the Picker) so you can tick files instead of pasting.

Nothing is set up by default. The button stays hidden until all three things are true:

1. The Worker has `GOOGLE_PICKER_CLIENT_ID` and `GOOGLE_PICKER_API_KEY` (steps 1 to 6 below).
2. The feature flag **Google Drive picker** (`google-picker`) is on (Settings → Features; it is off by default).
3. You click the button. Google's scripts are only loaded then, so the app makes no requests to Google until you do.

## What it does and does not do

- Your browser asks Google for a short-lived access token with the scope `https://www.googleapis.com/auth/drive.file`. The token stays in the browser's memory. The server never sees it and nothing is stored.
- The Picker hands back each chosen file's name, address and type. The tracker saves those as resources, the same as pasted addresses. It never reads a file's contents.
- `drive.file` is a non-sensitive scope, so Google does not need to review your app. Do not switch to `drive.readonly` or `drive.metadata.readonly`: they are restricted scopes that need a security review, and the Picker does not need them.
- The client ID and API key are public values by design (they appear in any page that uses the Picker). The tracker only sends them to you when you are signed in. Restrict them as below so nobody else can use them.

## Setup

You need a Google account. Everything is free.

1. **Make a project.** Open <https://console.cloud.google.com/>, then the project picker at the top, then **New project**. Name it "Focus Tracker". Open **IAM & Admin → Settings** and note the **Project number** (digits only). You need it in step 6.
2. **Turn on the Picker API.** **APIs & Services → Library**, search for **Google Picker API**, **Enable**.
3. **Set up the consent screen.** **APIs & Services → OAuth consent screen** (also called Google Auth Platform).
   - User type: **External**. App name: Focus Tracker. Support email and developer email: yours.
   - Under **Data access** (or **Scopes**) add `.../auth/drive.file`.
   - Leave the app in **Testing**. Under **Audience** (or **Test users**) add your own Google address. Only test users can sign in, which is what you want. (In Testing mode Google asks you to sign in again every 7 days.)
4. **Make an OAuth client ID.** **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Web application**. Name: Focus Tracker web.
   - **Authorised JavaScript origins**: your tracker's address, such as `https://focus-tracker.YOURNAME.workers.dev` (no path, no trailing slash). For local testing also add `http://localhost:8787`.
   - Leave **Authorised redirect URIs** empty. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). You do not need the client secret.
5. **Make an API key.** **Credentials → Create credentials → API key**. Copy it, then **Edit API key**:
   - Application restrictions: **Websites**, and add your tracker's address with `/*` on the end (and `http://localhost:8787/*` for local testing).
   - API restrictions: **Restrict key**, choose **Google Picker API** only.
6. **Give the Worker the values.** In the repository folder:

   ```sh
   npx wrangler secret put GOOGLE_PICKER_CLIENT_ID    # paste the client ID
   npx wrangler secret put GOOGLE_PICKER_API_KEY      # paste the API key
   npx wrangler secret put GOOGLE_PICKER_APP_ID       # paste the project number (recommended)
   ```

   For `wrangler dev`, put the same three lines in `.dev.vars` instead: `GOOGLE_PICKER_CLIENT_ID=...` and so on. `GOOGLE_PICKER_APP_ID` is optional; with it, Google links the files you pick to your project.
7. **Turn the feature on.** Settings → Features → **Google Drive picker**.
8. **Try it.** Open a project, **Add from Drive**, **Choose from Google Drive**. The first time, Google asks you to sign in and allow "See, edit, create and delete only the specific Google Drive files you use with this app". Tick one or more files, press **Select**. They appear in the list with their icons. Press **Add all**.

## If it does not work

- **The button is not there.** Check the flag is on, both secrets are set (`npx wrangler secret list`), and you are signed in. `GET /api/resources/picker` shows `{"enabled": false}` until both are true.
- **"Access blocked: this app has not been verified" or "access_denied".** Your Google address is not in the test users list (step 3).
- **"origin_mismatch".** The address in the browser bar is not in the client's Authorised JavaScript origins (step 4). It must match exactly, including `https://` and any port.
- **The Picker opens but is blank, or shows an error code.** The API key is restricted to another address, or the Picker API is not enabled (steps 2 and 5).
- **Google's scripts do not load.** An ad blocker or a network rule is blocking `apis.google.com` or `accounts.google.com`.

To switch it off again, turn the flag off in Settings → Features. To remove it completely, delete the secrets with `npx wrangler secret delete GOOGLE_PICKER_CLIENT_ID` (and the other two), and delete the OAuth client and API key in the Google console.

This was written without Google credentials, so the Picker itself has not been run end to end. The settings route and the hidden state are tested.
