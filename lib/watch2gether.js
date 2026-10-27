// Watch2Gether API service layer.
// Docs: https://w2g.tv/api/docs
// Used only for /watch (movie|serie) rooms — replaces the TMDB-Embed-API dependency.
// YouTube and screenshare rooms are unaffected and use the internal server as before.

const W2G_API_BASE = "https://api.w2g.tv";

/**
 * Create a new Watch2Gether room with the given video URL queued up.
 * Returns the full room URL, e.g. https://w2g.tv/rooms/<streamkey>
 *
 * @param {string} videoUrl  Any URL supported by W2G (YouTube, Vimeo, direct MP4, etc.)
 * @returns {Promise<string>} The Watch2Gether room URL
 * @throws  {Error}          On network failure or non-2xx response
 */
export async function createW2GRoom(videoUrl) {
  const body = {
    w2g_api_key: process.env.W2G_API_KEY || "",
    share: videoUrl,
    bg_color: "#00ff00",
    bg_opacity: "50",
  };

  let response;
  try {
    response = await fetch(`${W2G_API_BASE}/rooms/create.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000), // 10-second timeout
    });
  } catch (err) {
    throw new Error(`W2G API unreachable: ${err.message}`);
  }

  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(`W2G API returned HTTP ${response.status}: ${detail}`);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("W2G API returned non-JSON response.");
  }

  if (!data.streamkey) {
    throw new Error(`W2G API response missing streamkey: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return `https://w2g.tv/rooms/${data.streamkey}`;
}
