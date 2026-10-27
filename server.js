// Main server: Express (static + REST) + Socket.IO (chat, YT sync, WebRTC signaling)
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRoom, getRoom, deleteRoom } from "./lib/roomStore.js";
import { getStreams } from "./lib/streams.js";

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

// Health check — Render + UptimeRobot keep-alive
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Diagnóstico: testa se a TMDB-Embed-API está respondendo
// Acesse /api/embed-health no browser para ver o status
app.get("/api/embed-health", async (_req, res) => {
  const base = process.env.EMBED_API_URL;
  if (!base) {
    return res.json({ ok: false, error: "EMBED_API_URL not set in environment variables" });
  }
  try {
    const start = Date.now();
    // Testa com o filme "Fight Club" (tmdbId 550) como canário
    const response = await fetch(`${base}/api/streams/movie/550`, { signal: AbortSignal.timeout(30000) });
    const ms = Date.now() - start;
    if (!response.ok) {
      return res.json({ ok: false, status: response.status, ms, base });
    }
    const data = await response.json();
    const count = Array.isArray(data) ? data.length : (data.streams?.length ?? 0);
    res.json({ ok: true, ms, streamsFound: count, base });
  } catch (err) {
    res.json({ ok: false, error: err.message, base });
  }
});

// REST: room metadata
app.get("/api/room/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});

// Proxy HLS/MP4 — contorna CORS dos servidores de stream
// O browser chama /api/proxy?url=<encoded> e o servidor busca server-side
app.get("/api/proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url param");

  let targetUrl;
  try {
    targetUrl = new URL(target);
    if (!["http:", "https:"].includes(targetUrl.protocol)) throw new Error("bad protocol");
  } catch {
    return res.status(400).send("Invalid url");
  }

  try {
    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": targetUrl.origin + "/",
        "Origin": targetUrl.origin,
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send(`Upstream error: ${upstream.status}`);
    }

    const ct = upstream.headers.get("content-type") || "application/octet-stream";
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");

    // Para .m3u8: reescreve as URLs dos segmentos para passar pelo proxy também
    if (ct.includes("mpegurl") || target.includes(".m3u8")) {
      const text = await upstream.text();
      const base = target.substring(0, target.lastIndexOf("/") + 1);
      const rewritten = text.replace(/^(?!#)(.+\.ts|.+\.m3u8|.+\.key)([^\S\r\n]*$)/gm, (match, seg) => {
        const segUrl = seg.startsWith("http") ? seg : base + seg;
        return `/api/proxy?url=${encodeURIComponent(segUrl)}`;
      });
      return res.send(rewritten);
    }

    // Para MP4/segmentos: pipe direto
    const buf = await upstream.arrayBuffer();
    return res.send(Buffer.from(buf));
  } catch (err) {
    console.error("[proxy] error:", err.message);
    res.status(502).send("Proxy error: " + err.message);
  }
});

// Proxy legendas — mesmo problema de CORS
app.get("/api/sub-proxy", async (req, res) => {
  const target = req.query.url;
  if (!target) return res.status(400).send("Missing url");
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(10000) });
    const ct = upstream.headers.get("content-type") || "text/vtt";
    res.setHeader("Content-Type", ct);
    res.setHeader("Access-Control-Allow-Origin", "*");
    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    res.status(502).send("Sub proxy error: " + err.message);
  }
});

// REST: busca streams na TMDB-Embed-API para uma sala (chamado pelo frontend)
app.get("/api/streams/:roomId", async (req, res) => {
  const room = getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: "Room not found" });
  if (room.type !== "movie" && room.type !== "serie") {
    return res.status(400).json({ error: "Not a movie/serie room" });
  }

  // Cache para evitar refetch a cada join
  if (room.streams) return res.json(room.streams);

  try {
    const streams = await getStreams({
      type:    room.type,
      tmdbId:  room.media.tmdbId,
      season:  room.media.season,
      episode: room.media.episode,
    });
    room.streams = streams;
    res.json(streams);
  } catch (err) {
    console.error("[streams] fetch error:", err.message);
    res.status(502).json({ error: "Stream fetch failed", detail: err.message });
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

  // Pomfy manual sync (host → viewers)
  socket.on("pomfy-sync", ({ action, time }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    socket.to(currentRoomId).emit("pomfy-sync", { action, time });
  });

  // Video sync — HLS/MP4 player (host → viewers)
  socket.on("video-sync", ({ action, time }) => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room || room.hostSocketId !== socket.id) return;
    socket.to(currentRoomId).emit("video-sync", { action, time });
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
      io.to(currentRoomId).emit("host-left");
      deleteRoom(currentRoomId);
      console.log(`[room] ${currentRoomId} destroyed (host left)`);
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
