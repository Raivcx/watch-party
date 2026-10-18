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
4. Go to **OAuth2** → copy the **Client ID**. This is `CLIENT_ID`.
5. Under **OAuth2 → URL Generator**, select:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Embed Links`, `Read Message History`
6. Open the generated URL and add the bot to your server.

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
   | `CLIENT_ID` | Your bot client ID |
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

When the bot starts, it calls Discord's API to register `/watch`, `/yt`, and `/screenshare`. You'll see `Slash commands registered automatically.` in the Render logs.

After your first deploy:
1. Wait for the server to fully start (check logs for `Discord bot online`).
2. Go to Discord and try `/watch movie Inception`.

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
| Pomfy player is blank | Pomfy API may be down; try another title. Some content may be region-locked. |
| YouTube sync is off by a few seconds | Normal — network latency. Seek events re-sync automatically. |
| Screen share doesn't work for viewers | Host must click "Start Screen Share" and allow the browser permission. STUN works on free tier; for large groups add a TURN server (Coturn). |
| `PORT` already defined | Render injects `PORT` automatically. Don't override it. |

---

## Environment Variables Summary

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `DISCORD_TOKEN` | Yes | Discord Developer Portal → Bot |
| `CLIENT_ID` | Yes | Discord Developer Portal → OAuth2 |
| `TMDB_API_KEY` | Yes | TMDB → Settings → API |
| `PUBLIC_URL` | Yes | Render dashboard (after first deploy) |
| `PORT` | No | Auto-provided by Render |
| `SUPABASE_URL` | No | Supabase dashboard (optional) |
| `SUPABASE_KEY` | No | Supabase dashboard (optional) |
