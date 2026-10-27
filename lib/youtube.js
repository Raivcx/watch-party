// Helper to extract a YouTube video ID from many URL formats.
export function extractYouTubeId(url) {
  if (!url) return null;
  // Already an ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;

  try {
    const u = new URL(url);
    // youtu.be/<id>
    if (u.hostname === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    // youtube.com/watch?v=<id>
    if (u.searchParams.get("v")) {
      return u.searchParams.get("v");
    }
    // youtube.com/shorts/<id> or /embed/<id>
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] === "shorts" || parts[0] === "embed") {
      return parts[1] || null;
    }
  } catch {
    // not a URL — fall through
  }
  return null;
}
