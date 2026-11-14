# Blox DevGuard

Discord development community bot (TypeScript, discord.js 14, PostgreSQL + Prisma 6), designed for Railway hosting.

## Included in this milestone
- Basic anti-raid: guild join rate tracking, automatic channel lockdown and persistent permission restoration records
- Mass mention automoderation, activity XP, audit logs
- /ping, /setup, /security status|lockdown|unlock
- /mod warn|timeout, /announce, /updates subscribe|unsubscribe, /rank
- Explicit opt-in records for future update DMs (no DM broadcast sender yet)

**Not yet implemented:** Next.js dashboard, CAPTCHA, anti-nuke audit-log defense, AI scam detection, tickets, reaction/button roles, giveaways, actual DM broadcast delivery, staff-management screens. Do not deploy expecting these features yet.

## Deploy on Railway

1. Connect this repo to a new Railway **service from GitHub**. Deploy from the `main` branch, repository root.
2. Add a **PostgreSQL** service to the same Railway project.
3. In bot service **Variables**, create:
   - `DISCORD_TOKEN`: from your Discord application Bot tab (secret).
   - `DISCORD_CLIENT_ID`: Discord application ID.
   - `DISCORD_GUILD_ID`: server ID for command registration.
   - `DATABASE_URL`: reference the Railway PostgreSQL service's `DATABASE_URL` variable (Railway variable reference, not literal placeholder text).
   - `NODE_ENV=production` and optionally `LOG_LEVEL=info`.
4. On Discord Developer Portal, enable **Server Members Intent** and **Message Content Intent** for the bot. Invite with `bot` and `applications.commands` scopes. Grant only the needed server permissions: Manage Roles (lockdown), Moderate Members (timeout), Manage Messages (automod), View Channels, Send Messages, Embed Links, Read Message History.
5. Railway reads `railway.json`: it installs dependencies, builds TypeScript and generates Prisma client; the pre-deploy step runs `prisma migrate deploy`; the bot starts with `node dist/index.js`.
6. **Register slash commands separately** from a terminal that has your Discord credentials set by running `npm run commands`. This is intentionally separate from app boot so slash command changes are not registered at every bot restart. Alternatively, run the command one time from a secure Railway shell.
7. Watch Railway deployment logs, then run `/ping` in the test server and configure `/setup`.

You **do not** need a Railway public HTTP domain or PORT for the Discord gateway bot. Future dashboard is a separate service that will need a public domain and Discord OAuth callback.

### Local development

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run commands
npm run dev
```

Use an isolated development PostgreSQL database. Never commit `.env`, bot tokens, database passwords, session secrets, or OAuth client secrets.

### Database changes

Modify `prisma/schema.prisma`, run `npx prisma migrate dev --name descriptive_name` against a local development database, commit `prisma/migrations`, and let Railway apply committed migrations with `prisma migrate deploy`. Do **not** run `prisma migrate dev` against production.

### Safety notes

- Auto-lockdown is a starter defense, not a tested anti-nuke system. Review its permissions and test in a disposable server.
- Permissions are checked at Discord command level and at runtime for privileged commands.
- The bot never mass-DMs users as a side effect of announcements. DM subscriptions are stored for a future rate-limited, consent-based sender.
- Do not run multiple bot replicas against the same guild until distributed event handling and locking are implemented.
- GitHub Actions checks TypeScript build on pushes and pull requests.
