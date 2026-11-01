// In-memory session store with HMAC-signed cookies.
// No external dependencies — uses Node.js built-in crypto.
import { createHmac, randomBytes } from "crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  console.error("[sessions] WARNING: SESSION_SECRET is not set. Set it in .env or Render env vars.");
}

// Map<sessionId, { user: {id, username, avatar}, createdAt }>
const sessions = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(id) {
  if (!SECRET) return "nosecret";
  return createHmac("sha256", SECRET).update(id).digest("base64url");
}

function verify(id, sig) {
  if (!SECRET) return false;
  return sign(id) === sig;
}

/**
 * Creates a new session for the given user and returns the cookie value.
 * @param {{ id: string, username: string, avatar: string }} user
 * @returns {string} cookie value — "sessionId.hmac"
 */
export function createSession(user) {
  const id = randomBytes(32).toString("hex");
  sessions.set(id, { user, createdAt: Date.now() });
  return `${id}.${sign(id)}`;
}

/**
 * Validates a cookie value and returns the user if valid, or null.
 * @param {string|null} cookieValue
 * @returns {{ id: string, username: string, avatar: string } | null}
 */
export function getSession(cookieValue) {
  if (!cookieValue || !SECRET) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return null;
  const id  = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!verify(id, sig)) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(id);
    return null;
  }
  return session.user;
}

/**
 * Deletes the session associated with a cookie value.
 * @param {string|null} cookieValue
 */
export function deleteSession(cookieValue) {
  if (!cookieValue) return;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return;
  sessions.delete(cookieValue.slice(0, dot));
}

/**
 * Extracts the wp_session cookie value from an Express request.
 * @param {import("express").Request} req
 * @returns {string|null}
 */
export function parseCookie(req) {
  const raw = req.headers.cookie || "";
  const pair = raw.split(";").map(s => s.trim()).find(s => s.startsWith("wp_session="));
  return pair ? decodeURIComponent(pair.slice("wp_session=".length)) : null;
}

// Cleanup expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref?.();
