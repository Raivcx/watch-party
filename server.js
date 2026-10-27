// Main server: Express (static + REST) + Socket.IO (chat, WebRTC signaling)
import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getRoom, deleteRoom } from "./lib/roomStore.js";

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

// Health check — used by Render + UptimeRobot to keep the free tier alive
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));

// REST: room metadata (only screenshare rooms are created server-side now)
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

// Catch-all: serve the room page for screenshare rooms
app.get("/room/:id", (_req, res) => {
  res.sendFile(join(__dirname, "public", "room.html"));
});

// --- Socket.IO ---
io.on("connection", (socket) => {
  let currentRoomId = null;

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
      isHost: room.hostSocketId === socket.id || !room.hostSocketId,
    });
    // First joiner becomes the host socket
    if (!room.hostSocketId) room.hostSocketId = socket.id;
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

  // WebRTC signaling (screenshare)
  socket.on("rtc-offer", ({ to, sdp }) =>
    io.to(to).emit("rtc-offer", { from: socket.id, sdp }),
  );
  socket.on("rtc-answer", ({ to, sdp }) =>
    io.to(to).emit("rtc-answer", { from: socket.id, sdp }),
  );
  socket.on("rtc-ice", ({ to, candidate }) =>
    io.to(to).emit("rtc-ice", { from: socket.id, candidate }),
  );
  socket.on("rtc-request-stream", () => {
    if (currentRoomId)
      socket.to(currentRoomId).emit("rtc-request-stream", { from: socket.id });
  });

  socket.on("disconnect", () => {
    if (!currentRoomId) return;
    const room = getRoom(currentRoomId);
    if (!room) return;

    room.userCount = Math.max(0, room.userCount - 1);

    if (room.hostSocketId === socket.id) {
      // Host left — notify all viewers and destroy the room
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

// Start Discord bot in the same process
import "./bot/index.js";
