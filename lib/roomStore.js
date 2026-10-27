// In-memory room store.
// Render free tier: ~512 MB RAM, sleeps after inactivity.
// Rooms live only as long as the process — fine for a watch party session.
import { randomUUID } from "crypto";

// Map<roomId, room>
const rooms = new Map();

// Prevent unbounded memory growth on the free tier
const MAX_ROOMS     = 50;
const MAX_AGE_MS    = 4 * 60 * 60 * 1000; // 4 hours
const EMPTY_AGE_MS  = 30 * 60 * 1000;     // 30 min if nobody connected

export function createRoom({ type, media, hostUserId }) {
  // Evict stale rooms before creating a new one
  pruneStaleRooms();

  if (rooms.size >= MAX_ROOMS) {
    // Evict oldest empty room to make space
    const oldest = [...rooms.values()]
      .filter((r) => r.userCount === 0)
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) rooms.delete(oldest.id);
    else throw new Error("Room limit reached. Try again in a moment.");
  }

  const id = randomUUID();
  const room = {
    id,
    type,       // 'movie' | 'serie' | 'youtube' | 'screenshare'
    media,      // { tmdbId, title, poster, season, episode, videoId, ... }
    hostUserId: hostUserId || null,
    createdAt:  Date.now(),
    userCount:  0,
  };
  rooms.set(id, room);
  console.log(`[room] created ${id} type=${type} total=${rooms.size}`);
  return room;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function deleteRoom(id) {
  rooms.delete(id);
}

export function getRoomCount() {
  return rooms.size;
}

export function pruneStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    const age = now - room.createdAt;
    // Remove if: older than max age, OR empty and older than 30 min
    if (age > MAX_AGE_MS || (room.userCount === 0 && age > EMPTY_AGE_MS)) {
      rooms.delete(id);
    }
  }
}

// Run cleanup every 15 minutes
setInterval(pruneStaleRooms, 15 * 60 * 1000);
