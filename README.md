# DevGuard

Discord development server bot, deployed with Railway.

## Setup

1. Create a Discord application and enable Server Members and Message Content intents.
2. Create a Railway PostgreSQL service and link `DATABASE_URL` into the bot service.
3. Configure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` in Railway.
4. Deploy the bot service and register slash commands using `npm run commands` from a trusted terminal with the same environment variables.

**Never commit `.env` or production credentials.**

This repository starts with the Railway deployment scaffold. The full bot modules, tests, migrations, and dashboard are subsequent implementation work.