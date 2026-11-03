// v2 — Discord OAuth2 + Discord UI
// Main server: Express (REST + static) + Socket.IO + Discord OAuth2
import "dotenv/config";
import { randomBytes }  from "crypto";
import express          from "express";
import { createServer } from "http";
import { Server }       from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import {
  createRoom, getRoom, deleteRoom, getRoomCount,
  getRoomMembers, listRooms,
} from "./lib/roomStore.js";
import { getEmbedSources }                          from "./lib/streams.js";
import { createSession, getSession, deleteSession, parseCookie } from "./lib/sessions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
});

const PORT       = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");

// Discord OAuth2 config
const DISCORD_CLIENT_ID     = process.env.CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI || `${PUBLIC_URL}/auth/callback`;
const DISCORD_AUTH_URL      = "https://discord.com/api/oauth2/authorize";
const DISCORD_TOKEN_URL     = "https://discord.com/api/oauth2/token";
const DISCORD_API_URL       = "https://discord.com/api/v10";

// UUID v4 validation
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUser(req) {
  return await getSession(parseCookie(req));
}

async function requireAuth(req, res, next) {
  if (await getUser(req)) return next();
  const returnTo = encodeURIComponent(req.originalUrl);
  res.redirect(`/auth/login?return=${returnTo}`);
}

function isSecure() {
  return PUBLIC_URL.startsWith("https");
}

function setCookieHeader(name, value, opts = {}) {
  const path    = opts.path || "/";
  const parts   = [`${name}=${encodeURIComponent(value)}`, "HttpOnly", "SameSite=Lax", `Path=${path}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.secure || isSecure()) parts.push("Secure");
  return parts.join("; ");
}

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (req.path.startsWith("/room/") || req.path === "/") {
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
      "frame-src *",
      "connect-src 'self' wss: ws: https://cdn.discordapp.com",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
    ].join("; "));
  }
  next();
});

// ── Auth routes ───────────────────────────────────────────────────────────────

// Server-side OAuth state store — avoids cross-site cookie issues entirely.
// Map<state, { returnTo: string, expiresAt: number }>
const oauthStates = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of oauthStates) if (v.expiresAt < now) oauthStates.delete(k);
}, 60_000).unref?.();

app.get("/auth/login", (req, res) => {
  if (!DISCORD_CLIENT_SECRET) {
    return res.status(503).send("Discord OAuth2 not configured. Set DISCORD_CLIENT_SECRET and SESSION_SECRET in environment variables.");
  }

  // Decode and validate returnTo — req.query.return arrives URL-encoded
  let returnTo = "/";
  try {
    const raw = decodeURIComponent(String(req.query.return || "/"));
    if (raw.startsWith("/")) returnTo = raw;
  } catch { returnTo = "/"; }

  // Random state stored server-side — no cookie needed
  const state = randomBytes(24).toString("hex");
  oauthStates.set(state, { returnTo, expiresAt: Date.now() + 5 * 60 * 1000 });

  console.log(`[auth] login → state=${state.slice(0, 8)}... returnTo=${returnTo}`);

  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  DISCORD_REDIRECT_URI,
    response_type: "code",
    scope:         "identify",
    state,
    prompt:        "none",
  });
  res.redirect(`${DISCORD_AUTH_URL}?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;

  console.log(`[auth] callback → code=${!!code} state_known=${oauthStates.has(state)}`);

  if (!code || !state) return res.redirect("/?error=no_code");

  // Validate state server-side — single use
  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) {
    console.error("[auth] invalid_state — not found or expired");
    return res.redirect("/?error=invalid_state");
  }
  oauthStates.delete(state);

  const returnTo = stateData.returnTo;

  try {
    const tokenRes = await fetch(DISCORD_TOKEN_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body:    new URLSearchParams({
        client_id:     DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) {
      console.error("[auth] token exchange failed:", tokenRes.status, await tokenRes.text());
      return res.redirect("/?error=token_failed");
    }
    const { access_token } = await tokenRes.json();

    const userRes = await fetch(`${DISCORD_API_URL}/users/@me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) throw new Error(`User fetch failed: ${userRes.status}`);
    const du = await userRes.json();

    const user = {
      id:       du.id,
      username: du.global_name || du.username,
      avatar:   du.avatar
        ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.webp?size=64`
        : `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(du.id) % 5n)}.png`,
    };

    console.log(`[auth] success → ${user.username} (${user.id})`);

    const sessionCookie = await createSession(user);
    res.setHeader("Set-Cookie",
      setCookieHeader("wp_session", sessionCookie, { maxAge: 7 * 24 * 3600 })
    );
    res.redirect(returnTo);
  } catch (err) {
    console.error("[auth] callback error:", err);
    res.redirect("/?error=auth_failed");
  }
});
app.get("/auth/me", async (req, res) => {
  const cookieVal = parseCookie(req);
  const user = await getUser(req);
  console.log(`[auth/me] cookie_present=${!!cookieVal} user=${user?.username || "null"}`);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json(user);
});

app.get("/auth/logout", async (req, res) => {
  await deleteSession(parseCookie(req));
  res.setHeader("Set-Cookie", setCookieHeader("wp_session", "", { maxAge: 0 }));
  res.redirect("/");
});

// ── REST API ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) =>
  res.json({ ok: true, ts: Date.now(), rooms: getRoomCount() })
);

app.get("/api/room/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid room ID" });
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});

app.get("/api/room/:id/members", requireAuth, (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid room ID" });
  const members = getRoomMembers(req.params.id);
  res.json(members);
});

app.get("/api/embed/:roomId", (req, res) => {
  if (!UUID_RE.test(req.params.roomId)) return res.status(400).json({ error: "Invalid room ID" });
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.type !== "movie" && room.type !== "serie")
    return res.status(400).json({ error: "Not a movie/serie room" });
  const sources = getEmbedSources({
    type:    room.type,
    tmdbId:  room.media.tmdbId,
    season:  room.media.season,
    episode: room.media.episode,
  });
  res.json({ sources, media: room.media });
});

app.get("/api/sub-proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(10000) });
    const ct = upstream.headers.get("content-type") || "text/vtt";
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(await upstream.text());
  } catch (err) {
    res.status(502).send("Sub proxy error: " + err.message);
  }
});

// Room page — requires auth
app.get("/room/:id", requireAuth, (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────

// Auth middleware: reject connections without valid session
io.use(async (socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";
  const pair = cookieHeader.split(";").map(s => s.trim()).find(s => s.startsWith("wp_session="));
  const cookieValue = pair ? decodeURIComponent(pair.slice("wp_session=".length)) : null;
  const user = await getSession(cookieValue);
  if (!user) return next(new Error("Unauthorized"));
  socket.data.user = user;
  next();
});

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_MS  = 10_000;

io.on("connection", (socket) => {
  const user = socket.data.user; // { id, username, avatar }
  let currentRoomId = null;
  let msgTimestamps = [];
  console.log(`[socket] connected: ${socket.id} user=${user.username}`);

  socket.on("join-room", (roomId) => {
    if (!UUID_RE.test(String(roomId || ""))) {
      socket.emit("room-error", "Invalid room ID format.");
      return;
    }
    const room = getRoom(roomId);
    if (!room) {
      socket.emit("room-error", "Room does not exist or has expired.");
      return;
    }

    // Check if user was kicked from this room
    if (room.banned.has(user.id)) {
      socket.emit("room-error", "Você foi removido desta sala.");
      return;
    }

    currentRoomId = roomId;
    socket.join(roomId);
    room.userCount++;

    // creatorId set at room creation (roomStore.js) — immutable.
    // Fallback: if room was created before this field existed, init now.
    if (!room.creatorId) room.creatorId = room.hostUserId || user.id;

    // Cancel grace period timer if creator reconnects in time
    if (room._hostGraceTimer && room.creatorId === user.id) {
      clearTimeout(room._hostGraceTimer);
      room._hostGraceTimer = null;
    }

    // Only the original creator is host. If creator's socket dropped and nobody
    // took over yet, leave hostSocketId null — do NOT promote random viewers.
    const isHost = room.creatorId === user.id;
    console.log(`[join-room] user=${user.username}(${user.id}) creatorId=${room.creatorId} isHost=${isHost}`);

    if (isHost) {
      room.hostSocketId = socket.id;
      room.hostUserId   = user.id;
    }

    // Track member
    room.members.set(user.id, {
      username: user.username,
      avatar:   user.avatar,
      socketId: socket.id,
      isHost,
    });

    const userCount = room.userCount;
    const members   = getRoomMembers(roomId);

    socket.to(roomId).emit("user-joined", {
      socketId:  socket.id,
      discordId: user.id,
      name:      user.username,
      avatar:    user.avatar,
      userCount,
    });

    socket.emit("room-info", {
      type:       room.type,
      media:      room.media,
      yourId:     socket.id,
      discordId:  user.id,
      hostUserId: room.hostUserId,
      isHost,
      userCount,
      members,
    });

    // Auto-sync iframe state for late viewers
    if (!isHost && room.syncState) {
      const elapsed      = Math.floor((Date.now() - room.syncState.savedAt) / 1000);
      const adjustedTime = room.syncState.time + elapsed;
      socket.emit("iframe-sync", {
        time:      adjustedTime,
        sourceIdx: room.syncState.sourceIdx,
        autoSync:  true,
      });
    }

    // Notify host when a viewer joins (for iframe sync prompt)
    if (!isHost && room.hostSocketId) {
      io.to(room.hostSocketId).emit("viewer-joined-notify", {
        socketId: socket.id,
        name:     user.username,
      });
    }

    console.log(`[socket] room-info → ${user.username} (${socket.id}) room=${roomId} host=${isHost}`);
  });

  // Chat
  socket.on("chat-message", ({ text }) => {
    if (!currentRoomId || !text) return;
    const now = Date.now();
    msgTimestamps = msgTimestamps.filter(t => now - t < RATE_LIMIT_MS);
    if (msgTimestamps.length >= RATE_LIMIT_MAX) return;
    msgTimestamps.push(now);

    io.to(currentRoomId).emit("chat-message", {
      socketId: socket.id,
      name:     user.username,
      avatar:   user.avatar,
      text:     String(text).slice(0, 500),
      ts:       now,
    });
  });

  // Typing indicators
  socket.on("typing-start", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("user-typing", { socketId: socket.id, name: user.username });
  });
  socket.on("typing-stop", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("user-stop-typing", { socketId: socket.id });
  });

  // YouTube sync
  socket.on("yt-action", ({ action, time }) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("yt-action", { action, time, from: socket.id });
  });

  // Iframe sync — host only; persists state for late joiners
  socket.on("iframe-sync", ({ time, sourceIdx }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    const t = Math.max(0, Math.floor(Number(time) || 0));
    room.syncState = { time: t, sourceIdx: sourceIdx || 0, savedAt: Date.now() };
    socket.to(currentRoomId).emit("iframe-sync", { time: t, sourceIdx: sourceIdx || 0 });
  });

  // Stream lifecycle
  socket.on("stream-started", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("stream-started", { from: socket.id });
  });

  // Stream lifecycle — stop
  socket.on("stream-stopped", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("stream-stopped", { from: socket.id });
  });

  // Kick — host only
  socket.on("kick-user", ({ discordId }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    if (discordId === user.id) return; // can't kick self

    room.banned.add(discordId);

    // Find and disconnect the target socket
    const roomSockets = io.sockets.adapter.rooms.get(currentRoomId);
    if (roomSockets) {
      for (const sid of roomSockets) {
        const s = io.sockets.sockets.get(sid);
        if (s && s.data.user && s.data.user.id === discordId) {
          s.emit("kicked", { message: "Você foi removido da sala pelo host." });
          s.disconnect(true);
          break;
        }
      }
    }
  });

  // Transfer host — host can voluntarily transfer to another socket
  socket.on('transfer-host', ({ targetSocketId }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    if (targetSocketId === socket.id) return;

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket || !targetSocket.data?.user) return;

    const targetUser = targetSocket.data.user;
    room.hostSocketId = targetSocketId;
    room.hostUserId   = targetUser.id;
    // creatorId stays the same — original creator can still reclaim

    // Notify new host
    targetSocket.emit('host-promoted', { message: 'Você recebeu o host da sala.' });
    targetSocket.emit('transfer-host-ack', { message: 'Você é o novo host.' });

    // Notify everyone else
    socket.to(currentRoomId).emit('host-changed', {
      newHostId:   targetSocketId,
      newHostName: targetUser.username,
      userCount:   room.userCount,
    });

    // Notify old host
    socket.emit('transfer-host-ack', { message: 'Host transferido para ' + targetUser.username + '.' });

    console.log('[room] host transferred ' + socket.id + ' → ' + targetSocketId + ' in ' + currentRoomId);
  });

  // Grant stream permission — host allows a viewer to share screen
  socket.on("grant-stream-permission", ({ targetSocketId }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return; // host only
    const target = io.sockets.sockets.get(targetSocketId);
    if (!target) return;

    // Track who has permission
    if (!room.streamPermissions) room.streamPermissions = new Set();
    room.streamPermissions.add(targetSocketId);

    target.emit("stream-permission-granted", {
      message: "O host permitiu que você compartilhe sua tela.",
    });
    // Notify the room so everyone knows
    io.to(currentRoomId).emit("stream-permission-update", {
      socketId: targetSocketId,
      name:     target.data?.user?.username || "Viewer",
      granted:  true,
    });
    console.log(`[room] stream permission granted to ${targetSocketId} in ${currentRoomId}`);
  });

  // Revoke stream permission
  socket.on("revoke-stream-permission", ({ targetSocketId }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    room.streamPermissions?.delete(targetSocketId);
    const target = io.sockets.sockets.get(targetSocketId);
    if (target) target.emit("stream-permission-revoked", { message: "Permissão de stream removida." });
  });

  // Validate stream-started — only permitted sockets can start a stream
  // (override the existing stream-started handler to check permission)

    // WebRTC signaling
  socket.on("rtc-offer",  ({ to, sdp })       => io.to(to).emit("rtc-offer",  { from: socket.id, sdp }));
  socket.on("rtc-answer", ({ to, sdp })       => io.to(to).emit("rtc-answer", { from: socket.id, sdp }));
  socket.on("rtc-ice",    ({ to, candidate }) => io.to(to).emit("rtc-ice",    { from: socket.id, candidate }));
  socket.on("rtc-request-stream", () => {
    if (currentRoomId) socket.to(currentRoomId).emit("rtc-request-stream", { from: socket.id });
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id} user=${user.username}`);
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room) return;

    socket.to(currentRoomId).emit("user-stop-typing", { socketId: socket.id });
    room.userCount = Math.max(0, room.userCount - 1);

    // Remove from members if this socket was the active one for this user
    const member = room.members.get(user.id);
    if (member && member.socketId === socket.id) {
      room.members.delete(user.id);
    }

    const userCount = room.userCount;

    if (room.hostSocketId === socket.id) {
      // Clear active host socket so creator can reclaim on reconnect
      room.hostSocketId = null;

      if (room.userCount > 0) {
        // Grace period: 12s window for the creator to reconnect and reclaim host.
        // If they do, join-room clears this timer and restores host silently.
        room._hostGraceTimer = setTimeout(() => {
          const r = getRoom(currentRoomId);
          if (!r || r.hostSocketId) return; // already reclaimed or destroyed

          if (room.type === "screenshare") {
            const activeSockets = io.sockets.adapter.rooms.get(currentRoomId);
            // Prefer the creator if they are still in the room
          const allSockets = activeSockets ? [...activeSockets] : [];
          const nextHostId = allSockets.find(sid => {
            const sock = io.sockets.sockets.get(sid);
            return sock && sock.data?.user?.id === room.creatorId;
          }) || allSockets[0] || null;
            if (nextHostId) {
              const nextSocket = io.sockets.sockets.get(nextHostId);
              const nextUser   = nextSocket?.data?.user;
              r.hostSocketId = nextHostId;
              r.hostUserId   = nextUser?.id || r.hostUserId;
              if (nextUser) { const m = r.members.get(nextUser.id); if (m) m.isHost = true; }
              io.to(nextHostId).emit("host-promoted", { message: "Você é o novo host da sala." });
              socket.to(currentRoomId).emit("host-changed", { newHostId: nextHostId, newHostName: nextUser?.username || null, userCount: r.userCount });
            } else {
              io.to(currentRoomId).emit("host-left");
              deleteRoom(currentRoomId);
            }
          } else {
            io.to(currentRoomId).emit("host-left");
            deleteRoom(currentRoomId);
          }
        }, 12000);
      } else {
        io.to(currentRoomId).emit("host-left");
        deleteRoom(currentRoomId);
      }
    } else {
      socket.to(currentRoomId).emit("user-left", {
        socketId:  socket.id,
        discordId: user.id,
        name:      user.username,
        userCount,
      });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${PUBLIC_URL}`);
});

import "./bot/index.js";





