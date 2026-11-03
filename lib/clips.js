// Clips — save and list memorable moments via Supabase.
import { getSupabaseClient } from "./sessions.js";

/**
 * Save a clip to the database.
 * @param {{ roomId: string, guildId: string, userId: string, username: string, title: string }} opts
 */
export async function saveClip({ roomId, guildId, userId, username, title }) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase not configured.");
  const { error } = await client.from("clips").insert({
    room_id:  roomId,
    guild_id: guildId,
    user_id:  userId,
    username,
    title:    String(title).slice(0, 200),
  });
  if (error) throw new Error("Supabase insert error: " + error.message);
}

/**
 * List the latest clips for a guild, optionally filtered by user.
 * @param {{ guildId: string, userId?: string, limit?: number }} opts
 * @returns {Promise<Array<{ id, room_id, guild_id, user_id, username, title, created_at }>>}
 */
export async function listClips({ guildId, userId, limit = 10 }) {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Supabase not configured.");
  let query = client
    .from("clips")
    .select("id, room_id, guild_id, user_id, username, title, created_at")
    .eq("guild_id", guildId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw new Error("Supabase query error: " + error.message);
  return data || [];
}
