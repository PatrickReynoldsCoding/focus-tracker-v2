# Run your own Focus Tracker

Everything fits Cloudflare's free plan (limits in [DECISIONS.md](DECISIONS.md#d1-stack-cloudflare-workers--d1-as-the-spec-proposed)). You need a Cloudflare account and Node.js 20 or newer.

## With the button

1. Press **Deploy to Cloudflare** in the README. Cloudflare copies the repository to your GitHub account, creates the database (D1) and the key-value store (KV), and deploys.
2. When it asks for secrets, set `OWNER_PASSWORD` (your password) and `SESSION_SECRET` (32+ random characters, for example from `openssl rand -base64 32`).
3. Open the `*.workers.dev` address it gives you and sign in. The database sets itself up on the first request.

## From a terminal

```sh
git clone https://github.com/PatrickReynoldsCoding/focus-tracker-v2 focus-tracker
cd focus-tracker
npm install
npx wrangler login
npm run deploy
npx wrangler secret put OWNER_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`npm run deploy` builds the web app, creates the D1 database and KV namespace on the first run, applies database migrations and deploys. Run it again to update.

## After deploying

- **Time zone**: Settings → General (default Europe/London). "Today" follows it.
- **Claude**: [connect-claude.md](connect-claude.md).
- **Mac menu bar**: [../clients/swiftbar/README.md](../clients/swiftbar/README.md).
- **Your own domain** (optional): add a route or custom domain in the Cloudflare dashboard, then set the `PUBLIC_URL` variable to it so Claude's connector advertises the right address.

## Changing the password

`npx wrangler secret put OWNER_PASSWORD`. Every web sign-in ends; API tokens and Claude's connection keep working (revoke tokens in Settings).

## Backups

`npx wrangler d1 export focus-tracker --remote --output backup.sql` writes the whole database to a file. D1 also keeps 30 days of point-in-time history (`npx wrangler d1 time-travel`).
