// Main server: Express (static + REST) + Socket.IO (chat, YT sync, WebRTC signaling)
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createRoom, getRoom, deleteRoom } from "./lib/roomStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e6, // 1 MB — protects against oversized signaling payloads
});

const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// --- REST: room metadata (optional, frontend uses it) ---
app.get("/api/room/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    id: room.id,
    type: room.type,
    media: room.media,
    createdAt: room.createdAt,
  });
});

// Health check (used by Render + UptimeRobot to keep the free tier awake)
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// Catch-all: serve the room page (client-side routing by UUID in the path)
app.get("/room/:id", (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// --- Socket.IO: chat, YouTube sync, WebRTC signaling ---
io.on("connection", (socket) => {
  let currentRoomId = null;

  // Join a room
  socket.on("join-room", (roomId) => {
    const room = getRoom(roomId);
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
    });
  });

  // --- Chat ---
  socket.on("chat-message", ({ text }) => {
    if (!currentRoomId || !text) return;
    io.to(currentRoomId).emit("chat-message", {
      socketId: socket.id,
      text: String(text).slice(0, 500),
      ts: Date.now(),
    });
  });

  // --- YouTube sync ---
  socket.on("yt-action", ({ action, time, state }) => {
    if (!currentRoomId) return;
    // Broadcast sync to everyone except the sender
    socket.to(currentRoomId).emit("yt-action", {
      action, // play | pause | seek
      time,
      state,
      from: socket.id,
    });
  });

  // --- WebRTC signaling (screen sharing) ---
  socket.on("rtc-offer", ({ to, sdp }) => {
    io.to(to).emit("rtc-offer", { from: socket.id, sdp });
  });

  socket.on("rtc-answer", ({ to, sdp }) => {
    io.to(to).emit("rtc-answer", { from: socket.id, sdp });
  });

  socket.on("rtc-ice", ({ to, candidate }) => {
    io.to(to).emit("rtc-ice", { from: socket.id, candidate });
  });

  // New viewer asks host to start sharing
  socket.on("rtc-request-stream", () => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit("rtc-request-stream", { from: socket.id });
  });

  // --- Disconnect ---
  socket.on("disconnect", () => {
    if (currentRoomId) {
      const room = getRoom(currentRoomId);
      if (room) {
        room.userCount = Math.max(0, room.userCount - 1);
        if (room.userCount === 0) {
          // Keep the room for a while so the host can rejoin; pruneStaleRooms cleans up.
        }
      }
      socket.to(currentRoomId).emit("user-left", { socketId: socket.id });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Public URL: ${PUBLIC_URL}`);
  console.log(`Health check: ${PUBLIC_URL}/health`);
});

// Start the Discord bot in the same process (Render free tier = 1 web service)
import "./bot/index.js";
