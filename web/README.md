# DevGuard private dashboard

Separate Railway service using the same GitHub repository as the bot.

## Railway
- Create a new Railway **GitHub service** connected to `6henrikas6-dotcom/blox`.
- Set **Root Directory** to `/web`. Do not change the existing bot service's root directory.
- Add a **public domain** for the web service. Use the exact https URL as `APP_URL` (no trailing slash).
- Add web service variables from `.env.example`. Use Railway references to the **existing Postgres** service for `DATABASE_URL`.
- Set `DISCORD_BOT_TOKEN` using a Railway variable reference to the bot service's `DISCORD_TOKEN` (or set securely in Railway).
- `ADMIN_USER_IDS` is your *personal Discord user ID*, not application ID or server ID. Comma-separated for additional trusted admins.
- Generate `AUTH_SECRET` with at least 32 random characters, e.g. `openssl rand -hex 32`. Keep it secret.
- `DISCORD_CLIENT_SECRET` comes from the Discord Developer Portal OAuth2 settings; never commit it.
- `DISCORD_CLIENT_ID` is the application's ID and `DISCORD_GUILD_ID` is your server ID.
- In Discord Developer Portal → OAuth2 → Redirects, add exactly `https://YOUR-DASHBOARD-DOMAIN/api/auth/callback`.
- Deploy. The bot service owns migrations; the dashboard **must not run migrations**.
- Visit the dashboard domain and choose **Prisijungti su Discord**.

## Security
- Explicit allowlist + current guild membership check on login and on protected requests.
- Encrypted, HTTP-only session cookies (8 hours) and OAuth state check.
- Origin checks for settings, announcement publishing, and logout.
- No arbitrary channel IDs are accepted outside Discord snowflake format.
- Announcement mentions disabled; no bulk DM sender.
- Use a dedicated private admin Discord account and avoid sharing OAuth secrets.
- The initial dashboard only exposes existing bot config and audit records. Future features require separate backend work.

## Local
```sh
cd web
cp .env.example .env
npm install
npm run dev
```
Add `http://localhost:3000/api/auth/callback` to Discord OAuth redirects for local development. Use a separate dev database when testing.
