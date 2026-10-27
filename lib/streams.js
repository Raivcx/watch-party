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
 *
 * Ordering priority:
 *  1. PT-BR dubbed  (título/provider contém "dub", "dublado", "portuguese", "pt-br", "ptbr")
 *  2. PT-BR subtitled (legendas PT-BR disponíveis)
 *  3. Melhor qualidade (1080p > 720p > etc.)
 *
 * Returns an array of { title, url, quality, subtitles, provider } objects.
 * url can be .m3u8 (HLS) or direct .mp4.
 * Throws on HTTP error.
 */
export async function getStreams({ type, tmdbId, season, episode }) {
  const mediaType = type === "movie" ? "movie" : "series";
  const endpoint = type === "movie"
    ? `/api/streams/${mediaType}/${tmdbId}`
    : `/api/streams/${mediaType}/${tmdbId}?season=${season}&episode=${episode}`;

  const { data } = await axios.get(BASE + endpoint, { timeout: 30000 });

  const streams = Array.isArray(data) ? data : data.streams || [];

  return streams
    .filter((s) => s.url)
    .sort((a, b) => {
      // Prioridade PT-BR: dubbed > legendado > resto
      const pa = ptbrPriority(a);
      const pb = ptbrPriority(b);
      if (pb !== pa) return pb - pa;
      // Desempata por qualidade
      return qualityScore(b.quality) - qualityScore(a.quality);
    });
}

/**
 * Retorna 2 para stream dublado PT-BR, 1 para legendado PT-BR, 0 para outros.
 */
function ptbrPriority(stream) {
  const haystack = [
    stream.title  || "",
    stream.name   || "",
    stream.provider || "",
    stream.lang   || "",
    // Subtitles: verifica se existe legenda PT-BR
    ...(stream.subtitles || []).map((s) => s.lang || ""),
  ].join(" ").toLowerCase();

  // Dublado PT-BR
  if (/\b(dub(lado)?|dubbed|portugu[eê]s|pt[-_]?br|ptbr)\b/.test(haystack)) {
    // Se tiver "leg" junto, não é dub — é só legendado
    if (/\b(leg(end)?|legenda(do)?|sub(titled?)?)\b/.test(haystack) && !/\bdub\b/.test(haystack)) {
      return 1;
    }
    return 2;
  }

  // Legendado PT-BR: legenda disponível no array de subtitles
  const hasPtbrSub = (stream.subtitles || []).some((s) =>
    /portugu|pt[-_]?br|ptbr|brazil/i.test(s.lang || "")
  );
  if (hasPtbrSub) return 1;

  return 0;
}

function qualityScore(q = "") {
  const n = parseInt(q);
  if (!isNaN(n)) return n;
  if (/4k/i.test(q))      return 2160;
  if (/1080/i.test(q))    return 1080;
  if (/720/i.test(q))     return 720;
  if (/auto|hd/i.test(q)) return 1080;
  return 0;
}

/**
 * Exporta ptbrPriority para uso no frontend (via /api/streams que já ordena).
 * Também exporta qualityScore para testes.
 */
export { ptbrPriority, qualityScore };
