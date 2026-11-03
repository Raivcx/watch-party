// Helper to extract YouTube video/playlist IDs and fetch playlist contents.
// Requires YOUTUBE_API_KEY env var for fetchPlaylistItems.

if (!process.env.YOUTUBE_API_KEY) {
  console.warn("[youtube] YOUTUBE_API_KEY not set — playlist fetch will not work.");
}

/**
 * Extract a YouTube video ID from many URL formats.
 * Returns the 11-char video ID or null.
 */
export function extractYouTubeId(url) {
  if (!url) return null;
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.searchParams.get("v"))   return u.searchParams.get("v");
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "shorts" || parts[0] === "embed") return parts[1] || null;
  } catch { /* not a URL */ }
  return null;
}

/**
 * Extract a YouTube playlist ID (PLxxx / RDxxx / OLxxx) from a URL.
 * Returns the playlist ID string or null.
 */
export function extractPlaylistId(url) {
  if (!url) return null;
  // Raw playlist ID
  if (/^(PL|RD|OL|LL|FL|UU)[a-zA-Z0-9_-]+$/.test(url)) return url;
  try {
    const u = new URL(url);
    return u.searchParams.get("list") || null;
  } catch { /* not a URL */ }
  return null;
}

/**
 * Fetch all items from a YouTube playlist via Data API v3.
 * Returns array of { videoId, title } — max 200 items.
 * Throws if YOUTUBE_API_KEY is missing or request fails.
 */
export async function fetchPlaylistItems(playlistId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("YOUTUBE_API_KEY is not set.");

  const items = [];
  let pageToken = "";
  const MAX = 200;

  do {
    const params = new URLSearchParams({
      part:       "snippet",
      playlistId,
      maxResults: "50",
      key,
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`YouTube API error ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    for (const item of data.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title   = item.snippet?.title || "Sem título";
      if (videoId && title !== "Private video" && title !== "Deleted video") {
        items.push({ videoId, title });
      }
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken && items.length < MAX);

  return items;
}

/**
 * Fetch the title of a single YouTube video.
 * Returns the title string, or the videoId as fallback.
 */
export async function fetchVideoTitle(videoId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return videoId;
  try {
    const params = new URLSearchParams({ part: "snippet", id: videoId, key });
    const res  = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return videoId;
    const data = await res.json();
    return data.items?.[0]?.snippet?.title || videoId;
  } catch {
    return videoId;
  }
}