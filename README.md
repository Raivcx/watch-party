# Watch Party Platform

Discord bot + real-time web server for synchronized watch parties: movies/series (Pomfy), YouTube sync, and WebRTC screen sharing with live chat.

## Quick Start (Local)

```bash
cd watch-party
cp .env.example .env
# Fill in DISCORD_TOKEN, CLIENT_ID, TMDB_API_KEY
npm install
npm run deploy-commands   # register slash commands (run once)
npm start                 # starts Express + Socket.IO + Discord bot
```

Open `http://localhost:3000` for the landing page.

## Commands (in Discord)

| Command | Example | Result |
|---------|---------|--------|
| `/watch movie <name>` | `/watch movie Inception` | Room with Pomfy movie player |
| `/watch serie <name>` | `/watch serie Breaking Bad` | Room; bot asks for season/episode |
| `/yt <link>` | `/yt https://youtu.be/dQw4w9WgXcQ` | Room with synced YouTube player |
| `/screenshare` | `/screenshare` | Room; host shares screen via WebRTC |

## Architecture

```
watch-party/
├── server.js              # Express + Socket.IO (chat, YT sync, WebRTC signaling)
├── bot/
│   ├── index.js           # Discord bot — slash command listeners
│   └── deploy-commands.js # One-time slash command registration
├── lib/
│   ├── roomStore.js       # In-memory room store (create/get/prune)
│   ├── tmdb.js            # TMDB search API wrapper
│   └── youtube.js         # YouTube ID extraction
├── public/
│   ├── index.html         # Landing page
│   ├── room.html          # Room layout (75% media / 25% chat)
│   ├── css/style.css
│   └── js/room.js         # Chat, YT sync, Pomfy iframe, WebRTC client
├── package.json
└── .env.example
```

### How it works

- **Discord bot** runs in the same Node process as the web server (Render free tier = 1 web service).
- **Rooms** are stored in-memory (`Map`). Render's free tier gives ~512 MB RAM — plenty for dozens of concurrent rooms. Idle rooms auto-prune after 6 hours.
- **YouTube sync** uses the IFrame Player API. Play/pause/seek events are broadcast over Socket.IO. A `suppressYTEvent` flag prevents echo loops.
- **Screen sharing** uses WebRTC. The backend Socket.IO server relays SDP offers/answers and ICE candidates between peers. The host calls `getDisplayMedia()` and streams to each viewer via a peer connection.
- **Chat** is plain Socket.IO broadcast within the room.

## Deployment (Free Tier)

See [DEPLOY.md](DEPLOY.md) for full Render + Supabase + Discord setup.
