// Fetches stream sources from a self-hosted TMDB-Embed-API instance.
// IMPORTANTE: No painel admin da TMDB-Embed-API, ative ENABLE_PROXY=true.
// Quando ativo, a API resolve, descriptografa e reescreve as URLs dos streams
// para os seus próprios endpoints (/m3u8-proxy, /ts-proxy, /sub-proxy),
// entregando links prontos para o player sem necessidade de proxy adicional.
//
// Deploy: https://github.com/Inside4ndroid/TMDB-Embed-API
// Env: EMBED_API_URL=https://seu-servico.onrender.com
import axios from "axios";

const BASE = process.env.EMBED_API_URL || "";

if (!BASE) {
  console.warn("[streams] EMBED_API_URL not set — stream lookup will fail.");
}

/**
 * Fetch streams for a movie or series episode.
 *
 * Ordering priority:
 *  1. PT-BR dubbed  (título/provider contém "dub", "dublado", "português", "pt-br")
 *  2. PT-BR subtitled (legendas PT-BR disponíveis no array subtitles)
 *  3. Maior qualidade (1080p > 720p > etc.)
 *  4. Maior disponibilidade: providers com múltiplos servidores têm bônus
 *
 * Returns an array of { title, url, quality, subtitles, provider } objects.
 * Com ENABLE_PROXY=true na TMDB-Embed-API, as URLs já são proxiadas
 * e prontas para uso direto no <video> ou HLS.js.
 */
export async function getStreams({ type, tmdbId, season, episode }) {
  const mediaType = type === "movie" ? "movie" : "series";
  const endpoint  = type === "movie"
    ? `/api/streams/${mediaType}/${tmdbId}`
    : `/api/streams/${mediaType}/${tmdbId}?season=${season}&episode=${episode}`;

  const { data } = await axios.get(BASE + endpoint, { timeout: 30000 });

  const raw = Array.isArray(data) ? data : data.streams || [];

  const streams = raw
    .filter((s) => s.url && isPlayableUrl(s.url, s))
    .sort((a, b) => {
      // 1. PT-BR dub/leg
      const ptDiff = ptbrPriority(b) - ptbrPriority(a);
      if (ptDiff !== 0) return ptDiff;
      // 2. Qualidade
      const qDiff = qualityScore(b.quality) - qualityScore(a.quality);
      if (qDiff !== 0) return qDiff;
      // 3. Providers mais confiáveis têm bônus de disponibilidade
      return providerScore(b) - providerScore(a);
    });

  console.log(`[streams] ${streams.length} streams encontrados para tmdbId=${tmdbId}`);
  if (streams.length > 0) {
    console.log(`[streams] melhor: ${streams[0].title || streams[0].provider} | ${streams[0].quality} | ${streams[0].url?.slice(0, 80)}`);
  }

  return streams;
}

/**
 * Filtra URLs que são realmente reproduzíveis em streaming.
 * - Aceita: URLs proxiadas pela TMDB-Embed-API (/m3u8-proxy, /ts-proxy)
 * - Aceita: streams HLS .m3u8
 * - Aceita: MP4 diretos pequenos (sem indicação de tamanho no título)
 * - Rejeita: páginas embed de players externos
 * - Rejeita: arquivos de download gigantes (sHub, Blu-ray REMUX, etc.)
 */
function isPlayableUrl(url, stream = {}) {
  if (!url) return false;

  // URLs proxiadas pela TMDB-Embed-API — sempre válidas
  if (url.includes("/m3u8-proxy") || url.includes("/ts-proxy")) return true;

  // HLS streams — sempre válidos
  if (url.includes(".m3u8")) return true;

  // Rejeita arquivos gigantes indicados no título (REMUX, BluRay, sHub, etc.)
  const title = (stream.title || stream.name || "").toLowerCase();
  if (/remux|blu.?ray|bdremux|shub|s-hub|4k~|5\.\d+ gb|[34]\.\d+ gb/i.test(title)) return false;

  // Rejeita páginas embed de players externos
  const embedDomains = [
    "vidlink.pro", "player.videasy.net", "4khdhub.com",
    "streamflix.space", "vixsrc.to", "dahmermovies.com",
    "castle.club", "hdghartv.com", "netmirror.app",
    "onetouchtv.com", "zxcstreams.com",
  ];
  try {
    const hostname = new URL(url).hostname;
    if (embedDomains.some((d) => hostname.includes(d))) return false;
  } catch {
    return false;
  }

  // MP4 direto — aceita
  if (url.includes(".mp4")) return true;

  // URL sem extensão reconhecida — aceita por padrão
  return true;
}

/**
 * Bônus de disponibilidade por provider.
 * Providers com infraestrutura mais estável recebem score maior.
 */
function providerScore(stream) {
  const p = (stream.provider || stream.name || "").toLowerCase();
  if (/streamflix|dahmermovies/.test(p))  return 30; // MP4 direto, mais estável
  if (/4khdhub/.test(p))                  return 25;
  if (/videasy/.test(p))                  return 20;
  if (/vidlink/.test(p))                  return 15;
  if (/vixsrc/.test(p))                   return 10;
  if (/showbox|febbox/.test(p))           return 5;
  return 0;
}

/**
 * Retorna 2 para stream dublado PT-BR, 1 para legendado PT-BR, 0 para outros.
 */
function ptbrPriority(stream) {
  const haystack = [
    stream.title    || "",
    stream.name     || "",
    stream.provider || "",
    stream.lang     || "",
    ...(stream.subtitles || []).map((s) => s.lang || ""),
  ].join(" ").toLowerCase();

  if (/\b(dub(lado)?|dubbed|portugu[eê]s|pt[-_]?br|ptbr)\b/.test(haystack)) {
    if (/\b(leg(end)?|legenda(do)?|sub(titled?)?)\b/.test(haystack) && !/\bdub\b/.test(haystack)) {
      return 1;
    }
    return 2;
  }

  const hasPtbrSub = (stream.subtitles || []).some((s) =>
    /portugu|pt[-_]?br|ptbr|brazil/i.test(s.lang || "")
  );
  return hasPtbrSub ? 1 : 0;
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

export { ptbrPriority, qualityScore };
