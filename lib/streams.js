// Fetches stream sources from a self-hosted TMDB-Embed-API instance.
// Deploy that API separately on Render: https://github.com/Inside4ndroid/TMDB-Embed-API
// Set EMBED_API_URL in your environment to that Render service's URL.
import axios from "axios";

const BASE = process.env.EMBED_API_URL || "";

if (!BASE) {
  console.warn("[streams] EMBED_API_URL not set — stream lookup will fail.");
}

/**
 * Fetch streams for a movie or series episode.
 * Returns an array of { title, url, quality, subtitles, provider } objects.
 * url can be .m3u8 (HLS) or direct .mp4.
 * Throws on HTTP error.
 */
export async function getStreams({ type, tmdbId, season, episode }) {
  // type: 'movie' | 'serie'
  const mediaType = type === "movie" ? "movie" : "series";
  let endpoint;
  if (type === "movie") {
    endpoint = `/api/streams/${mediaType}/${tmdbId}`;
  } else {
    endpoint = `/api/streams/${mediaType}/${tmdbId}?season=${season}&episode=${episode}`;
  }

  const { data } = await axios.get(BASE + endpoint, { timeout: 15000 });

  // API returns an array; sort by quality descending
  const streams = Array.isArray(data) ? data : data.streams || [];

  // Pick best quality first, filter out empty URLs
  return streams
    .filter((s) => s.url)
    .sort((a, b) => qualityScore(b.quality) - qualityScore(a.quality));
}

function qualityScore(q = "") {
  const n = parseInt(q);
  if (!isNaN(n)) return n;
  if (/4k/i.test(q)) return 2160;
  if (/1080/i.test(q)) return 1080;
  if (/720/i.test(q)) return 720;
  if (/auto|hd/i.test(q)) return 1080;
  return 0;
}
