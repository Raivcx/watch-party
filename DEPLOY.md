# Deployment Guide — 100% Free Tier

This guide deploys the Watch Party Platform on **Render** (web server + Discord bot in one process) and optionally **Supabase** (if you later want persistent room state). Total cost: **$0**.

---

## Prerequisites

You need:
1. A **Discord Bot Token** and **Client ID** — [Discord Developer Portal](https://discord.com/developers/applications)
2. A **TMDB API Key** — [TMDB Settings](https://www.themoviedb.org/settings/api)
3. A **GitHub account** — to push the code (Render deploys from Git)
4. A **Render account** — [render.com](https://render.com) (free)

---

## Step 1 — Discord Bot Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Give it a name (e.g. "Watch Party Bot").
3. Go to the **Bot** tab → **Add Bot** → copy the **Token**. This is `DISCORD_TOKEN`.
4. Go to **OAuth2 → General** and copy the **Client ID** (`CLIENT_ID`) and **Client Secret** (`DISCORD_CLIENT_SECRET`).
5. Under **OAuth2 → Redirects**, add the exact web callback URL: `https://YOUR_HOST.onrender.com/auth/discord/callback`. Set the same value as `DISCORD_REDIRECT_URI` in Render after the first deploy.
6. The web login uses only the `identify` scope. To invite the bot, use **OAuth2 → URL Generator** with scopes `bot` and `applications.commands`, plus permissions `Send Messages`, `Embed Links` and `Read Message History`. Open the generated URL and add the bot to your server.

---

## Step 2 — TMDB API Key

1. Create an account at [themoviedb.org](https://www.themoviedb.org).
2. Go to **Settings → API** → request an API key (Developer type).
3. Copy the **API Key (v3 auth)**. This is `TMDB_API_KEY`.

---

## Step 3 — Push to GitHub

```bash
cd watch-party
git init
git add .
git commit -m "Watch party platform"
git branch -M main
git remote add origin https://github.com/<your-username>/watch-party.git
git push -u origin main
```

---

## Step 4 — Deploy on Render

### Create the Web Service

1. Go to [render.com](https://render.com) → **New → Web Service**.
2. Connect your GitHub repo.
3. Settings:
   - **Name:** `watch-party`
   - **Environment:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Add **Environment Variables** (Environment tab):

   | Key | Value |
   |-----|-------|
   | `DISCORD_TOKEN` | Your bot token |
   | `CLIENT_ID` | Discord application/client ID |
   | `DISCORD_CLIENT_SECRET` | Discord OAuth2 client secret |
   | `SESSION_SECRET` | Random secret from `openssl rand -base64 48` |
   | `DISCORD_REDIRECT_URI` | `https://watch-party-xxxx.onrender.com/auth/discord/callback` |
   | `TMDB_API_KEY` | Your TMDB API key |
   | `PUBLIC_URL` | `https://watch-party-xxxx.onrender.com` (set after first deploy) |
   | `PORT` | `3000` (Render auto-provides `PORT`, but this is a fallback) |

5. Click **Create Web Service**.

### Get Your Public URL

After the first deploy, Render assigns a URL like `https://watch-party-xxxx.onrender.com`. Copy it, then:
1. Go back to Environment Variables.
2. Update `PUBLIC_URL` to that exact URL (no trailing slash).
3. Trigger a redeploy (Render → Manual Deploy → Deploy latest commit).

---

## Step 5 — Slash Commands (Automatic)

Slash commands are **auto-registered on startup** — no shell access needed.

When the bot starts, it registers `/watch`, `/screenshare` and `/status` in each server where it is installed.

After your first deploy:
1. Set `DISCORD_REDIRECT_URI` to the exact Render callback URL and register the same URL in Discord Developer Portal.
2. Wait for the server to fully start (check logs for `Discord bot online`).
3. Open the web app, select **Entrar com Discord**, authorize the `identify` scope, then test `/watch` or `/screenshare` in Discord.

> If commands don't appear, restart the service from the Render dashboard (Manual Deploy → Restart). The auto-registration runs on every startup.

---

## Step 6 — Keep the Free Tier Awake (Optional)

Render's free tier **sleeps after 15 minutes of inactivity**. The bot will go offline and rooms reset. To keep it awake:

1. Sign up at [UptimeRobot](https://uptimerobot.com) (free).
2. Add an **HTTP monitor**:
   - URL: `https://watch-party-xxxx.onrender.com/health`
   - Interval: 5 minutes
3. This pings your `/health` endpoint, keeping Render from sleeping.

> ⚠️ Render's free tier gives **750 hours/month**. A single always-on service uses ~720 hours. You're fine with one service.

---

## Step 7 (Optional) — Supabase for Persistent State

The in-memory store resets when Render sleeps or restarts. If you want room state to survive:

1. Create a project at [supabase.com](https://supabase.com) (free).
2. Run this SQL in the SQL Editor:

```sql
CREATE TABLE rooms (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,
  media       JSONB NOT NULL DEFAULT '{}',
  host_user_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + INTERVAL '6 hours'
);
```

3. Add these environment variables on Render:

   | Key | Value |
   |-----|-------|
   | `SUPABASE_URL` | `https://xxxxx.supabase.co` |
   | `SUPABASE_KEY` | Your anon/public key |

4. Replace `lib/roomStore.js` with a Supabase-backed version (use the `@supabase/supabase-js` client). The API (`createRoom`, `getRoom`) stays the same, so no other code changes.

> The current in-memory implementation works for active watch parties. Supabase is only needed if rooms must survive process restarts.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot doesn't respond to commands | Run `npm run deploy-commands` again; check `DISCORD_TOKEN` and `CLIENT_ID` |
| Room link shows "Room Unavailable" | Render restarted (free tier sleep). Create a new room from Discord. |
| Discord login returns an OAuth error | Confirm `DISCORD_CLIENT_SECRET`, `SESSION_SECRET` and that `DISCORD_REDIRECT_URI` exactly matches a redirect URL registered in Discord. |\n| Pomfy player is blank | The selected third-party provider may be unavailable or the content may be region-locked. |
| Screen share doesn't work for viewers | Host must click "Iniciar compartilhamento" and allow browser permission. System-audio capture varies by browser. If peers cannot connect across restrictive networks, configure TURN (for example Coturn). |
| `PORT` already defined | Render injects `PORT` automatically. Don't override it. |

---

## Environment Variables Summary

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `DISCORD_TOKEN` | Yes | Discord Developer Portal → Bot |
| `CLIENT_ID` | Yes | Discord Developer Portal → OAuth2 |
| `DISCORD_CLIENT_SECRET` | Yes | Discord Developer Portal → OAuth2 → General |
| `DISCORD_REDIRECT_URI` | Yes | Exact callback URL registered in Discord |
| `SESSION_SECRET` | Yes | Generate with `openssl rand -base64 48` |
| `TMDB_API_KEY` | Yes | TMDB → Settings → API |
| `PUBLIC_URL` | Yes | Render dashboard (after first deploy) |
| `PORT` | No | Auto-provided by Render |
| `SUPABASE_URL` | No | Supabase dashboard (optional) |
| `SUPABASE_KEY` | No | Supabase dashboard (optional) |
