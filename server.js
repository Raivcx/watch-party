import "dotenv/config";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRoom, getRoom, deleteRoom, getRoomCount } from "./lib/roomStore.js";
import { getEmbedSources } from "./lib/streams.js";

const root = dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { maxHttpBufferSize: 1e6 });
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:" + PORT).replace(/\/$/, "");
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || PUBLIC_URL + "/auth/discord/callback";
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
const states = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));
app.use(express.static(join(root, "public")));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

function signature(id) {
  return createHmac("sha256", SESSION_SECRET || "missing-secret").update(id).digest("base64url");
}
function equal(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
function cookies(header) {
  return Object.fromEntries(String(header || "").split(";").map((part) => {
    const i = part.indexOf("=");
    return i < 0 ? ["", ""] : [part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim())];
  }).filter((entry) => entry[0]));
}
function getSession(header) {
  if (!SESSION_SECRET) return null;
  const raw = cookies(header).wp_session;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 2 || !equal(parts[1], signature(parts[0]))) return null;
  const entry = sessions.get(parts[0]);
  if (!entry || entry.expiresAt < Date.now()) {
    sessions.delete(parts[0]);
    return null;
  }
  entry.expiresAt = Date.now() + SESSION_TTL;
  return entry;
}
function setCookie(res, id) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", "wp_session=" + encodeURIComponent(id + "." + signature(id)) +
    "; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + Math.floor(SESSION_TTL / 1000) + secure);
}
function configReady(res) {
  if (CLIENT_ID && CLIENT_SECRET && SESSION_SECRET) return true;
  res.status(503).send("Configure CLIENT_ID, DISCORD_CLIENT_SECRET and SESSION_SECRET to enable Discord login.");
  return false;
}
function safePath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), rooms: getRoomCount() }));
app.get("/auth/discord", (req, res) => {
  if (!configReady(res)) return;
  const state = randomBytes(24).toString("base64url");
  states.set(state, { expiresAt: Date.now() + 10 * 60 * 1000, returnTo: safePath(req.query.returnTo) });
  const query = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: "code", scope: "identify", state,
  });
  res.redirect("https://discord.com/oauth2/authorize?" + query.toString());
});
app.get("/auth/discord/callback", async (req, res) => {
  if (!configReady(res)) return;
  const pending = typeof req.query.state === "string" ? states.get(req.query.state) : null;
  if (typeof req.query.state === "string") states.delete(req.query.state);
  if (req.query.error || !req.query.code || !pending || pending.expiresAt < Date.now()) {
    return res.status(400).send("Discord login cancelled or expired. Return to the app and try again.");
  }
  try {
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code",
        code: String(req.query.code), redirect_uri: REDIRECT_URI,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenRes.ok) throw new Error("Discord token exchange failed");
    const token = await tokenRes.json();
    const profileRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: "Bearer " + token.access_token },
      signal: AbortSignal.timeout(10000),
    });
    if (!profileRes.ok) throw new Error("Discord profile lookup failed");
    const profile = await profileRes.json();
    if (!profile.id || !profile.username) throw new Error("Invalid Discord profile");
    const id = randomBytes(32).toString("base64url");
    sessions.set(id, {
      user: {
        id: String(profile.id),
        username: String(profile.global_name || profile.username).slice(0, 80),
        avatar: profile.avatar ? "https://cdn.discordapp.com/avatars/" + profile.id + "/" + profile.avatar + ".png?size=96" : null,
      },
      expiresAt: Date.now() + SESSION_TTL,
    });
    setCookie(res, id);
    res.redirect(pending.returnTo);
  } catch (err) {
    console.error("[auth] Discord OAuth error:", err.message);
    res.status(502).send("Could not complete Discord authentication. Please try again.");
  }
});
app.get("/auth/logout", (req, res) => {
  const raw = cookies(req.headers.cookie).wp_session;
  const id = raw && raw.split(".")[0];
  if (id) sessions.delete(id);
  res.setHeader("Set-Cookie", "wp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" +
    (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  res.redirect("/");
});
app.get("/api/me", (req, res) => {
  const session = getSession(req.headers.cookie);
  if (!session) return res.status(401).json({ authenticated: false });
  res.setHeader("Cache-Control", "no-store");
  res.json({ authenticated: true, user: session.user });
});
app.get("/api/room/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid room ID" });
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.setHeader("Cache-Control", "no-store");
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});
app.get("/api/embed/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid room ID" });
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (!["movie", "serie"].includes(room.type)) return res.status(400).json({ error: "Not a movie/serie room" });
  const sources = getEmbedSources({ type: room.type, tmdbId: room.media.tmdbId, season: room.media.season, episode: room.media.episode });
  res.setHeader("Cache-Control", "no-store");
  res.json({ sources, media: room.media });
});
// Disable the arbitrary URL proxy: it could be abused for server-side request forgery.
app.all("/api/sub-proxy", (_req, res) => res.status(410).json({ error: "Subtitle proxy disabled." }));
app.get("/room/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).send("Invalid room ID.");
  if (!getSession(req.headers.cookie)) {
    return res.redirect("/auth/discord?returnTo=" + encodeURIComponent(req.originalUrl));
  }
  res.sendFile(join(root, "public", "room.html"));
});

io.use((socket, next) => {
  const session = getSession(socket.handshake.headers.cookie);
  if (!session) return next(new Error("AUTH_REQUIRED"));
  socket.data.user = session.user;
  next();
});
function inRoom(roomId, socketId) {
  return Boolean(io.sockets.adapter.rooms.get(roomId)?.has(socketId));
}
function validPeer(room, roomId, from, to) {
  return typeof to === "string" && to !== from && inRoom(roomId, from) && inRoom(roomId, to) &&
    room.hostSocketId && (from === room.hostSocketId || to === room.hostSocketId);
}

io.on("connection", (socket) => {
  const user = socket.data.user;
  let roomId = null;
  let timestamps = [];
  socket.on("join-room", (id) => {
    if (roomId) return;
    if (!UUID_RE.test(String(id || ""))) return socket.emit("room-error", "Invalid room ID format.");
    const room = getRoom(id);
    if (!room) return socket.emit("room-error", "Room does not exist or has expired.");
    roomId = id;
    socket.join(id);
    room.userCount++;
    const isOwner = room.hostUserId === user.id;
    if (isOwner && !room.hostSocketId) room.hostSocketId = socket.id;
    socket.to(id).emit("user-joined", { socketId: socket.id, name: user.username, userCount: room.userCount });
    socket.emit("room-info", {
      type: room.type, media: room.media, yourId: socket.id,
      user: user, isHost: Boolean(isOwner && room.hostSocketId === socket.id),
      hostConnected: Boolean(room.hostSocketId), userCount: room.userCount,
    });
    if (!isOwner && room.syncState) {
      const elapsed = Math.floor((Date.now() - room.syncState.savedAt) / 1000);
      socket.emit("iframe-sync", {
        time: room.syncState.time + elapsed, sourceIdx: room.syncState.sourceIdx, autoSync: true,
      });
    }
    if (!isOwner && room.hostSocketId) {
      io.to(room.hostSocketId).emit("viewer-joined-notify", { socketId: socket.id, name: user.username });
    }
  });
  socket.on("chat-message", ({ text } = {}) => {
    if (!roomId || typeof text !== "string") return;
    const now = Date.now();
    timestamps = timestamps.filter((t) => now - t < 10000);
    if (timestamps.length >= 10) return;
    timestamps.push(now);
    const clean = text.trim().slice(0, 500);
    if (clean) io.to(roomId).emit("chat-message", { socketId: socket.id, name: user.username, text: clean, ts: now });
  });
  socket.on("typing-start", () => { if (roomId) socket.to(roomId).emit("user-typing", { socketId: socket.id, name: user.username }); });
  socket.on("typing-stop", () => { if (roomId) socket.to(roomId).emit("user-stop-typing", { socketId: socket.id }); });
  socket.on("yt-action", ({ action, time } = {}) => {
    if (!roomId || !["play", "pause", "seek"].includes(action)) return;
    const t = Number(time);
    if (Number.isFinite(t) && t >= 0 && t <= 86400) socket.to(roomId).emit("yt-action", { action, time: t, from: socket.id });
  });
  socket.on("iframe-sync", ({ time, sourceIdx } = {}) => {
    if (!roomId) return;
    const room = getRoom(roomId);
    const t = Number(time), index = Number(sourceIdx);
    if (!room || room.hostSocketId !== socket.id || !Number.isFinite(t) || t < 0 || t > 86400 ||
        !Number.isInteger(index) || index < 0 || index > 20) return;
    room.syncState = { time: Math.floor(t), sourceIdx: index, savedAt: Date.now() };
    socket.to(roomId).emit("iframe-sync", { time: room.syncState.time, sourceIdx: index });
  });
  socket.on("stream-started", () => {
    const room = roomId && getRoom(roomId);
    if (room && room.type === "screenshare" && room.hostSocketId === socket.id) socket.to(roomId).emit("stream-started");
  });
  socket.on("rtc-request-stream", () => {
    const room = roomId && getRoom(roomId);
    if (room?.type === "screenshare" && room.hostSocketId && room.hostSocketId !== socket.id) {
      io.to(room.hostSocketId).emit("rtc-request-stream", { from: socket.id });
    }
  });
  socket.on("rtc-offer", ({ to, sdp } = {}) => {
    const room = roomId && getRoom(roomId);
    if (room?.type === "screenshare" && room.hostSocketId === socket.id &&
        sdp && typeof sdp === "object" && validPeer(room, roomId, socket.id, to)) {
      io.to(to).emit("rtc-offer", { from: socket.id, sdp });
    }
  });
  socket.on("rtc-answer", ({ to, sdp } = {}) => {
    const room = roomId && getRoom(roomId);
    if (room?.type === "screenshare" && room.hostSocketId === to &&
        sdp && typeof sdp === "object" && validPeer(room, roomId, socket.id, to)) {
      io.to(to).emit("rtc-answer", { from: socket.id, sdp });
    }
  });
  socket.on("rtc-ice", ({ to, candidate } = {}) => {
    const room = roomId && getRoom(roomId);
    if (room?.type === "screenshare" && candidate && typeof candidate === "object" &&
        validPeer(room, roomId, socket.id, to)) {
      io.to(to).emit("rtc-ice", { from: socket.id, candidate });
    }
  });
  socket.on("disconnect", () => {
    if (!roomId) return;
    const room = getRoom(roomId);
    if (!room) return;
    socket.to(roomId).emit("user-stop-typing", { socketId: socket.id });
    room.userCount = Math.max(0, room.userCount - 1);
    if (room.hostSocketId === socket.id) {
      if (room.type === "screenshare" && room.userCount > 0) {
        const members = io.sockets.adapter.rooms.get(roomId);
        const nextId = members ? [...members].find((id) => id !== socket.id) : null;
        if (nextId) {
          room.hostSocketId = nextId;
          const next = io.sockets.sockets.get(nextId);
          if (next?.data.user?.id) room.hostUserId = next.data.user.id;
          io.to(nextId).emit("host-promoted", { message: "Você é o novo host da sala." });
          socket.to(roomId).emit("host-changed", { newHostId: nextId, newHostName: next?.data.user?.username || null, userCount: room.userCount });
        } else {
          io.to(roomId).emit("host-left");
          deleteRoom(roomId);
        }
      } else {
        io.to(roomId).emit("host-left");
        deleteRoom(roomId);
      }
    } else {
      socket.to(roomId).emit("user-left", { socketId: socket.id, name: user.username, userCount: room.userCount });
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of states) if (value.expiresAt < now) states.delete(key);
  for (const [key, value] of sessions) if (value.expiresAt < now) sessions.delete(key);
}, 15 * 60 * 1000).unref();

httpServer.listen(PORT, () => {
  console.log("Server running on port " + PORT + " — " + PUBLIC_URL);
  if (!CLIENT_ID || !CLIENT_SECRET || !SESSION_SECRET) {
    console.warn("[auth] Set CLIENT_ID, DISCORD_CLIENT_SECRET and SESSION_SECRET to enable Discord login.");
  }
});
import "./bot/index.js";
