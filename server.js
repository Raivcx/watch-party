// Main server: Express (static + REST) + Socket.IO (chat, YT sync, iframe sync, WebRTC)
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRoom, getRoom, deleteRoom, getRoomCount } from "./lib/roomStore.js";
import { getEmbedSources } from "./lib/streams.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app        = express();
const httpServer = createServer(app);
const io         = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
});

const PORT       = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Bloqueia abertura de popups e navegação indesejada pelos iframes dos players.
app.use((req, res, next) => {
  // Impede que a página seja carregada em iframes de outros sites (clickjacking)
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Bloqueia detecção de MIME type incorreto
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Referrer mínimo — não vaza URL para os players externos
  res.setHeader("Referrer-Policy", "strict-origin");
  // CSP: a página da sala não pode abrir popups nem ser embedada externamente.
  // Os iframes dos players são cross-origin e têm CSP próprio —
  // este header protege apenas o nosso documento raiz.
  if (req.path.startsWith("/room/") || req.path === "/") {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
        "frame-src *",                 // permite iframes dos players
        "connect-src 'self' wss: ws:", // socket.io
        "img-src 'self' data: https:", // thumbnails
        "style-src 'self' 'unsafe-inline'",
      ].join("; ")
    );
  }
  next();
});

// Health check — Render + UptimeRobot keep-alive
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), rooms: getRoomCount() }));

// REST: room metadata
app.get("/api/room/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});

// REST: retorna fontes de embed VidSrc para uma sala de filme/série
app.get("/api/embed/:roomId", (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.type !== "movie" && room.type !== "serie") {
    return res.status(400).json({ error: "Not a movie/serie room" });
  }
  const sources = getEmbedSources({
    type:    room.type,
    tmdbId:  room.media.tmdbId,
    season:  room.media.season,
    episode: room.media.episode,
  });
  res.json({ sources, media: room.media });
});

// Proxy legendas — contorna CORS
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

// Catch-all: serve a página de sala
app.get("/room/:id", (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  let currentRoomId = null;
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    const room = getRoom(roomId);
    console.log(`[socket] join-room ${roomId} => found=${!!room}`);
    if (!room) {
      socket.emit("room-error", "Room does not exist or has expired.");
      return;
    }
    currentRoomId = roomId;
    socket.join(roomId);
    room.userCount++;
    socket.to(roomId).emit("user-joined", { socketId: socket.id });
    socket.emit("room-info", {
      type:       room.type,
      media:      room.media,
      yourId:     socket.id,
      hostUserId: room.hostSocketId || null,
      isHost:     room.hostSocketId === socket.id || !room.hostSocketId,
    });
    if (!room.hostSocketId) room.hostSocketId = socket.id;
    console.log(`[socket] room-info sent to ${socket.id}: type=${room.type}`);
  });

  // Chat
  socket.on("chat-message", ({ text }) => {
    if (!currentRoomId || !text) return;
    io.to(currentRoomId).emit("chat-message", {
      socketId: socket.id,
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });

  // YouTube sync
  socket.on("yt-action", ({ action, time }) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("yt-action", { action, time, from: socket.id });
  });

  // Iframe sync — host envia timestamp em segundos; viewers recarregam iframe
  // Só o host pode emitir; servidor valida antes de repassar
  socket.on("iframe-sync", ({ time, sourceIdx }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    const t = Math.max(0, Math.floor(Number(time) || 0));
    socket.to(currentRoomId).emit("iframe-sync", { time: t, sourceIdx: sourceIdx || 0 });
    console.log(`[socket] iframe-sync t=${t}s src=${sourceIdx} room=${currentRoomId}`);
  });

  // WebRTC signaling
  socket.on("rtc-offer",  ({ to, sdp })       => io.to(to).emit("rtc-offer",  { from: socket.id, sdp }));
  socket.on("rtc-answer", ({ to, sdp })       => io.to(to).emit("rtc-answer", { from: socket.id, sdp }));
  socket.on("rtc-ice",    ({ to, candidate }) => io.to(to).emit("rtc-ice",    { from: socket.id, candidate }));
  socket.on("rtc-request-stream", () => {
    if (currentRoomId) socket.to(currentRoomId).emit("rtc-request-stream", { from: socket.id });
  });

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.id}`);
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room) return;

    room.userCount = Math.max(0, room.userCount - 1);

    if (room.hostSocketId === socket.id) {
      if (room.type === "screenshare" && room.userCount > 0) {
        // Screenshare: transfere o host para outro viewer em vez de destruir a sala
        const sockets = io.sockets.adapter.rooms.get(currentRoomId);
        const nextHostId = sockets
          ? [...sockets].find((sid) => sid !== socket.id)
          : null;

        if (nextHostId) {
          room.hostSocketId = nextHostId;
          io.to(nextHostId).emit("host-promoted", { message: "Você é o novo host da sala." });
          socket.to(currentRoomId).emit("host-changed", { newHostId: nextHostId });
          console.log(`[room] host transferred to ${nextHostId} in ${currentRoomId}`);
        } else {
          // Sala ficou vazia mesmo assim
          io.to(currentRoomId).emit("host-left");
          deleteRoom(currentRoomId);
          console.log(`[room] ${currentRoomId} destroyed (no viewers left)`);
        }
      } else {
        // Outros tipos (movie, serie, youtube): host sai = sala encerra
        io.to(currentRoomId).emit("host-left");
        deleteRoom(currentRoomId);
        console.log(`[room] ${currentRoomId} destroyed (host left)`);
      }
    } else {
      socket.to(currentRoomId).emit("user-left", { socketId: socket.id });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${PUBLIC_URL}`);
});

// Inicia o bot Discord no mesmo processo
import "./bot/index.js";
