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

function getUser(req) {
  return getSession(parseCookie(req));
}

function requireAuth(req, res, next) {
  if (getUser(req)) return next();
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

app.get("/auth/login", (req, res) => {
  if (!DISCORD_CLIENT_SECRET) {
    return res.status(503).send("Discord OAuth2 not configured. Set DISCORD_CLIENT_SECRET and SESSION_SECRET in environment variables.");
  }

  const returnTo = req.query.return || "/";
  const state = Buffer.from(JSON.stringify({
    return: returnTo,
    nonce:  randomBytes(16).toString("hex"),
  })).toString("base64url");

  const stateCookie = setCookieHeader("wp_oauth_state", state, { maxAge: 300, path: "/auth" });
  console.log(`[auth] login → setting state cookie, returnTo=${returnTo}`);
  res.setHeader("Set-Cookie", stateCookie);

  const params = new URLSearchParams({
    client_id:     DISCORD_CLIENT_ID,
    redirect_uri:  DISCORD_REDIRECT_URI,
    response_type: "code",
    scope:         "identify",
    state,
    prompt:        "none", // skip consent screen if already authorized
  });
  res.redirect(`${DISCORD_AUTH_URL}?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code) return res.redirect("/?error=no_code");

  // Validate state against cookie
  const rawCookies = (req.headers.cookie || "").split(";").reduce((acc, c) => {
    const [k, ...v] = c.trim().split("=");
    acc[k] = v.join("=");
    return acc;
  }, {});

  const cookieState = rawCookies.wp_oauth_state
    ? decodeURIComponent(rawCookies.wp_oauth_state)
    : null;

  console.log(`[auth] callback → code=${!!code} state_present=${!!state} cookie_present=${!!cookieState} match=${state === cookieState}`);
  console.log(`[auth] callback → cookies received: ${Object.keys(rawCookies).join(", ") || "(none)"}`);

  if (!state || state !== cookieState) {
    console.error(`[auth] invalid_state — state=${state?.slice(0,20)}... cookie=${cookieState?.slice(0,20)}...`);
    return res.redirect("/?error=invalid_state");
  }

  let returnTo = "/";
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    const candidate = decodeURIComponent(parsed.return || "/");
    if (candidate.startsWith("/")) returnTo = candidate;
  } catch { /* keep "/" */ }

  try {
    // Exchange code for access token
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

    // Fetch Discord user profile
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

    const sessionCookie = createSession(user);
    res.setHeader("Set-Cookie", [
      setCookieHeader("wp_session",     sessionCookie, { maxAge: 7 * 24 * 3600 }),
      setCookieHeader("wp_oauth_state", "",            { maxAge: 0, path: "/auth" }),
    ]);
    res.redirect(returnTo);
  } catch (err) {
    console.error("[auth] callback error:", err);
    res.redirect("/?error=auth_failed");
  }
});

app.get("/auth/me", (req, res) => {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: "Not authenticated" });
  res.json(user);
});

app.get("/auth/logout", (req, res) => {
  deleteSession(parseCookie(req));
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
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";
  const pair = cookieHeader.split(";").map(s => s.trim()).find(s => s.startsWith("wp_session="));
  const cookieValue = pair ? decodeURIComponent(pair.slice("wp_session=".length)) : null;
  const user = getSession(cookieValue);
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

    // Host: creator by Discord ID, or first joiner if no creator set
    const isHost = (room.hostUserId && room.hostUserId === user.id) ||
                   (!room.hostUserId && !room.hostSocketId);

    if (isHost || !room.hostSocketId) {
      room.hostSocketId = socket.id;
      if (!room.hostUserId) room.hostUserId = user.id;
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
    socket.to(currentRoomId).emit("stream-started");
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
      if (room.type === "screenshare" && room.userCount > 0) {
        const sockets   = io.sockets.adapter.rooms.get(currentRoomId);
        const nextHostId = sockets ? [...sockets].find(sid => sid !== socket.id) : null;

        if (nextHostId) {
          const nextSocket = io.sockets.sockets.get(nextHostId);
          const nextUser   = nextSocket?.data?.user;
          room.hostSocketId = nextHostId;
          room.hostUserId   = nextUser?.id || room.hostUserId;

          // Update member isHost flag
          if (nextUser) {
            const m = room.members.get(nextUser.id);
            if (m) m.isHost = true;
          }

          io.to(nextHostId).emit("host-promoted", { message: "Você é o novo host da sala." });
          socket.to(currentRoomId).emit("host-changed", {
            newHostId:   nextHostId,
            newHostName: nextUser?.username || null,
            userCount,
          });
        } else {
          io.to(currentRoomId).emit("host-left");
          deleteRoom(currentRoomId);
        }
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

