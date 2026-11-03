// Session store using Supabase Auth.
// Auth flow is handled by Supabase (Discord OAuth provider).
// Server validates JWT tokens issued by Supabase Auth.
import { createHmac } from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // service_role or anon key
const SECRET       = process.env.SESSION_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn("[sessions] SUPABASE_URL/KEY not set — auth will not work.");
}

// Lazy Supabase client
let _sb = null;
async function sb() {
  if (_sb) return _sb;
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const { createClient } = await import("@supabase/supabase-js");
    _sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
    return _sb;
  } catch (err) {
    console.error("[sessions] Supabase init failed:", err.message);
    return null;
  }
}

// ── Custom session store (server-side, backed by Supabase) ───────────────────
// We store our own sessions in the `sessions` table so the cookie value
// is a simple HMAC-signed token — no JWT complexity on the client.

function sign(id) {
  if (!SECRET) return "nosecret";
  return createHmac("sha256", SECRET).update(id).digest("base64url");
}
function verify(id, sig) {
  if (!SECRET) return false;
  return sign(id) === sig;
}

import { randomBytes } from "crypto";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

// In-memory fallback
const mem = new Map();


/**
 * Public alias for the lazy Supabase client.
 * Returns the client or null if not configured.
 */
export async function getSupabaseClient() {
  return await sb();
}
export async function createSession(user) {
  const id        = randomBytes(32).toString("hex");
  const cookieVal = `${id}.${sign(id)}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL).toISOString();

  const client = await sb();
  if (client) {
    const { error } = await client.from("sessions").insert({
      id,
      user_id:    user.id,
      username:   user.username,
      avatar:     user.avatar,
      expires_at: expiresAt,
    });
    if (error) {
      console.error("[sessions] insert error:", error.message);
      mem.set(id, { user, createdAt: Date.now() });
    } else {
      console.log(`[sessions] created for ${user.username} in Supabase`);
    }
  } else {
    mem.set(id, { user, createdAt: Date.now() });
  }
  return cookieVal;
}

export async function getSession(cookieValue) {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return null;
  const id  = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  if (!verify(id, sig)) return null;

  const client = await sb();
  if (client) {
    const { data, error } = await client
      .from("sessions")
      .select("user_id, username, avatar, expires_at")
      .eq("id", id)
      .single();

    if (error || !data) return null;
    if (new Date(data.expires_at) < new Date()) {
      await client.from("sessions").delete().eq("id", id);
      return null;
    }
    return { id: data.user_id, username: data.username, avatar: data.avatar };
  }

  const s = mem.get(id);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { mem.delete(id); return null; }
  return s.user;
}

export async function deleteSession(cookieValue) {
  if (!cookieValue) return;
  const dot = cookieValue.lastIndexOf(".");
  if (dot === -1) return;
  const id = cookieValue.slice(0, dot);

  const client = await sb();
  if (client) {
    await client.from("sessions").delete().eq("id", id);
  } else {
    mem.delete(id);
  }
}

export function parseCookie(req) {
  const raw  = req.headers.cookie || "";
  const pair = raw.split(";").map(s => s.trim()).find(s => s.startsWith("wp_session="));
  return pair ? decodeURIComponent(pair.slice("wp_session=".length)) : null;
}

// Hourly cleanup
setInterval(async () => {
  const now = Date.now();
  for (const [id, s] of mem) if (now - s.createdAt > SESSION_TTL) mem.delete(id);
  const client = await sb();
  if (client) {
    await client.from("sessions").delete().lt("expires_at", new Date().toISOString());
  }
}, 60 * 60 * 1000).unref?.();
