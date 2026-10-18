// Main server: Express (static + REST) + Socket.IO (chat, YT sync, WebRTC signaling)
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRoom, getRoom } from "./lib/roomStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6,
});

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// Health check (used by Render + UptimeRobot to keep the free tier awake)
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// REST: room metadata
app.get("/api/room/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({ id: room.id, type: room.type, media: room.media, createdAt: room.createdAt });
});

// Catch-all: serve the room page
app.get("/room/:id", (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// --- Socket.IO ---
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
      type: room.type,
      media: room.media,
      yourId: socket.id,
      hostUserId: room.hostSocketId || null, // set when host joins
      isHost: room.hostSocketId === socket.id || !room.hostSocketId,
    });
    // First joiner becomes the host socket
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
    if (!room || room.hostSocketId !== socket.id) return; // only host can sync
    socket.to(currentRoomId).emit("pomfy-sync", { action, time });
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
    if (currentRoomId) {
      const room = getRoom(currentRoomId);
      if (room) {
        room.userCount = Math.max(0, room.userCount - 1);
        if (room.hostSocketId === socket.id) {
          // Host left — notify all viewers and destroy the room
          io.to(currentRoomId).emit("host-left");
          deleteRoom(currentRoomId);
          console.log(`[room] ${currentRoomId} destroyed (host left)`);
        } else {
          socket.to(currentRoomId).emit("user-left", { socketId: socket.id });
        }
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT} — ${PUBLIC_URL}`);
});

// Start Discord bot in the same process
import "./bot/index.js";
