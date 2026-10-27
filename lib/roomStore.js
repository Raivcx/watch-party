// In-memory room store — used exclusively for screenshare rooms.
// Watch2Gether rooms are external; the W2G URL is returned directly to Discord.
// Render's free tier sleeps after inactivity, so rooms only live as long as
// the process. That's acceptable for a transient screenshare session.
import { randomUUID } from "crypto";

// Map<roomId, room>
const rooms = new Map();

export function createRoom({ type, media, hostUserId }) {
  const id = randomUUID();
  const room = {
    id,
    type,       // 'screenshare'
    media,      // {} for screenshare
    hostUserId: hostUserId || null,
    createdAt: Date.now(),
    userCount: 0,
  };
  rooms.set(id, room);
  return room;
}

export function getRoom(id) {
  return rooms.get(id);
}

export function deleteRoom(id) {
  rooms.delete(id);
}

// Clean up rooms older than 6 hours with nobody connected.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function pruneStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > MAX_AGE_MS && room.userCount === 0) {
      rooms.delete(id);
    }
  }
}

setInterval(pruneStaleRooms, 30 * 60 * 1000); // every 30 minutes
