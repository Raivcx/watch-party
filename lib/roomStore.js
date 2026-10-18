// In-memory room store.
// Render's free tier gives ~512 MB RAM and sleeps after inactivity,
// so rooms only live as long as the process. That's fine for a watch party.
import { randomUUID } from "crypto";

// Map<roomId, room>
const rooms = new Map();

export function createRoom({ type, media, hostUserId }) {
  const id = randomUUID();
  const room = {
    id,
    type, // 'movie' | 'serie' | 'youtube' | 'screenshare'
    media, // { url, title, poster, tmdbId, season, episode, ... }
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

// Simple cleanup of rooms older than 6 hours with nobody connected.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function pruneStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > MAX_AGE_MS && room.userCount === 0) {
      rooms.delete(id);
    }
  }
}

setInterval(pruneStaleRooms, 30 * 60 * 1000); // every 30 min
