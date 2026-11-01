# Watch Party Platform

Discord bot and real-time web application for watch parties, movie/series embeds and WebRTC screen sharing.

## Setup

1. Copy `.env.example` to `.env`.
2. Configure `DISCORD_TOKEN`, `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `SESSION_SECRET`, `DISCORD_REDIRECT_URI`, `PUBLIC_URL` and `TMDB_API_KEY`.
3. Register the exact callback URL in Discord Developer Portal. For local development: `http://localhost:3000/auth/discord/callback`.
4. Run `npm install`, `npm run deploy-commands` and `npm start`.
5. Open the app, authenticate with Discord and join a room created with a bot command.

Generate a session secret with `openssl rand -base64 48`. Never commit real credentials.

## Authentication and security

The app requests only Discord OAuth2 `identify`. The browser cannot choose its display name or Discord ID: the server exchanges the OAuth code, retrieves the profile from Discord and issues a signed HttpOnly session cookie. Socket.IO requires this session. The room creator's Discord ID is the initial host identity. WebRTC signaling is limited to the same screen-share room and host/viewer peer pairs. The arbitrary URL subtitle proxy is disabled to prevent SSRF.

The session store is in memory; users must authenticate again after a process restart. Use a shared persistent session store before running multiple instances.

## Media limitations

Movie and series sources are third-party embeds. Cross-origin iframe providers do not expose a common playback API, so universal automatic play/pause/seek synchronization cannot be guaranteed. The current sync action is best-effort and providers may ignore URL seek parameters.

Screen sharing currently uses host-to-viewer peer-to-peer WebRTC. A host can stream to multiple viewers, with capture quality presets, a system-audio track toggle, connection status, reconnect attempts and fullscreen playback. The browser's native picker selects a monitor, window or tab where supported. This is not multi-host simultaneous screen sharing or an SFU; larger rooms require an SFU (such as LiveKit or mediasoup) and TURN infrastructure.

## Deployment

For Render, configure all required environment variables in the service dashboard and register `https://YOUR_HOST/auth/discord/callback` in Discord Developer Portal. Use HTTPS in production. In-memory rooms and sessions are cleared on restart and are not shared between instances.
