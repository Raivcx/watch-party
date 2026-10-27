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

// Validação básica de UUID v4
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin");
  if (req.path.startsWith("/room/") || req.path === "/") {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com",
        "frame-src *",
        "connect-src 'self' wss: ws:",
        "img-src 'self' data: https:",
        "style-src 'self' 'unsafe-inline'",
      ].join("; ")
    );
  }
  next();
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now(), rooms: getRoomCount() }));

// REST: room metadata
app.get("/api/room/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "Invalid room ID" });
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});

// REST: embed sources
app.get("/api/embed/:roomId", (req, res) => {
  if (!UUID_RE.test(req.params.roomId)) return res.status(400).json({ error: "Invalid room ID" });
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

// Proxy legendas
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

// Rate limit por socket: máximo 10 msgs em 10 segundos
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_MS  = 10_000;

io.on("connection", (socket) => {
  let currentRoomId  = null;
  let userName       = "anon";
  let msgTimestamps  = [];
  console.log(`[socket] connected: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    // Valida formato UUID
    if (!UUID_RE.test(String(roomId || ""))) {
      socket.emit("room-error", "Invalid room ID format.");
      return;
    }
    const room = getRoom(roomId);
    console.log(`[socket] join-room ${roomId} => found=${!!room}`);
    if (!room) {
      socket.emit("room-error", "Room does not exist or has expired.");
      return;
    }

    currentRoomId = roomId;
    socket.join(roomId);
    room.userCount++;

    // Fix race condition: define host ANTES de emitir room-info
    const isHost = !room.hostSocketId;
    if (isHost) room.hostSocketId = socket.id;

    const userCount = room.userCount;

    socket.to(roomId).emit("user-joined", {
      socketId: socket.id,
      name: userName,
      userCount,
    });

    socket.emit("room-info", {
      type:       room.type,
      media:      room.media,
      yourId:     socket.id,
      hostUserId: room.hostSocketId,
      isHost,
      userCount,
    });

    // Se há estado de sync salvo (host já sincronizou antes), envia direto para o viewer
    // O tempo é ajustado com o tempo decorrido desde o último sync
    if (!isHost && room.syncState) {
      const elapsed = Math.floor((Date.now() - room.syncState.savedAt) / 1000);
      const adjustedTime = room.syncState.time + elapsed;
      socket.emit("iframe-sync", {
        time: adjustedTime,
        sourceIdx: room.syncState.sourceIdx,
        autoSync: true,
      });
      console.log(`[socket] auto-sync viewer ${socket.id}: t=${adjustedTime}s src=${room.syncState.sourceIdx}`);
    }

    // Notifica o host que um novo viewer entrou (para ele poder sincronizar manualmente se quiser)
    if (!isHost && room.hostSocketId) {
      io.to(room.hostSocketId).emit("viewer-joined-notify", {
        socketId: socket.id,
        name: userName,
      });
    }

    console.log(`[socket] room-info sent to ${socket.id}: type=${room.type} host=${isHost}`);
  });

  // Chat
  socket.on("chat-message", ({ text, name }) => {
    if (!currentRoomId || !text) return;

    // Rate limit server-side
    const now = Date.now();
    msgTimestamps = msgTimestamps.filter((t) => now - t < RATE_LIMIT_MS);
    if (msgTimestamps.length >= RATE_LIMIT_MAX) return; // silently drop
    msgTimestamps.push(now);

    // Atualiza o nome do usuário se foi passado
    if (name && typeof name === "string") {
      userName = String(name).slice(0, 20);
    }

    io.to(currentRoomId).emit("chat-message", {
      socketId: socket.id,
      name: userName,
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });

  // Indicador de digitando — só repassa para outros na sala
  socket.on("typing-start", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("user-typing", { socketId: socket.id, name: userName });
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

  // Iframe sync — só o host pode emitir; persiste o estado para viewers futuros
  socket.on("iframe-sync", ({ time, sourceIdx }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    const t = Math.max(0, Math.floor(Number(time) || 0));
    // Salva o estado para viewers que ainda vão entrar na sala
    room.syncState = { time: t, sourceIdx: sourceIdx || 0, savedAt: Date.now() };
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

    // Para de digitar ao desconectar
    socket.to(currentRoomId).emit("user-stop-typing", { socketId: socket.id });

    room.userCount = Math.max(0, room.userCount - 1);

    if (room.hostSocketId === socket.id) {
      if (room.type === "screenshare" && room.userCount > 0) {
        const sockets = io.sockets.adapter.rooms.get(currentRoomId);
        const nextHostId = sockets
          ? [...sockets].find((sid) => sid !== socket.id)
          : null;

        if (nextHostId) {
          room.hostSocketId = nextHostId;
          const userCount = room.userCount;
          io.to(nextHostId).emit("host-promoted", { message: "Você é o novo host da sala." });
          socket.to(currentRoomId).emit("host-changed", { newHostId: nextHostId, newHostName: null, userCount });
          console.log(`[room] host transferred to ${nextHostId} in ${currentRoomId}`);
        } else {
          io.to(currentRoomId).emit("host-left");
          deleteRoom(currentRoomId);
          console.log(`[room] ${currentRoomId} destroyed (no viewers left)`);
        }
      } else {
        io.to(currentRoomId).emit("host-left");
        deleteRoom(currentRoomId);
        console.log(`[room] ${currentRoomId} destroyed (host left)`);
      }
    } else {
      socket.to(currentRoomId).emit("user-left", {
        socketId: socket.id,
        name: userName,
        userCount: room.userCount,
      });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${PUBLIC_URL}`);
});

// Inicia o bot Discord no mesmo processo
import "./bot/index.js";
