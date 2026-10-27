// Gera URLs de embed para filmes e séries por TMDB ID.
// Todos os providers são configurados para máxima qualidade disponível.
//
// moviesnexus.fun — ?sv=alpha (servidor principal HD),  ?sv=multi-audio (PT-BR áudio)
// vidcore.org     — ad-free, HLS adaptativo até 4K
// vidsrc.cc       — multi-server com fallover automático
// vidsrc.to       — fallback geral

/**
 * @typedef {Object} EmbedSource
 * @property {string} url      - URL completa do embed
 * @property {string} provider - Nome amigável
 * @property {string} lang     - "dub" | "leg" | "auto"
 * @property {string} label    - Label exibido no botão
 */

export function getEmbedSources({ type, tmdbId, season, episode }) {
  const s = season  || 1;
  const e = episode || 1;
  const isMovie = type === "movie";

  // ── Base paths ──────────────────────────────────────────────────────────────
  const mn   = isMovie
    ? `https://www.moviesnexus.fun/movie/${tmdbId}`
    : `https://www.moviesnexus.fun/tv/${tmdbId}/${s}/${e}`;

  const vc   = isMovie
    ? `https://vidcore.org/embed/movie/${tmdbId}`
    : `https://vidcore.org/embed/tv/${tmdbId}/${s}/${e}`;

  const vscc = isMovie
    ? `https://vidsrc.cc/v2/embed/movie/${tmdbId}`
    : `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${s}/${e}`;

  const vsto = isMovie
    ? `https://vidsrc.to/embed/movie/${tmdbId}`
    : `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`;

  // Parâmetros comuns de qualidade máxima
  // autoPlay=1 inicia automaticamente
  // sv=alpha  → servidor principal HD do MoviesNexus (melhor qualidade)
  const HQ = "autoPlay=1";

  return [
    // ── PT-BR Dublado ─────────────────────────────────────────────────────────
    {
      url:      `${mn}?sv=multi-audio&${HQ}&sub=pt`,
      provider: "MoviesNexus",
      lang:     "dub",
      label:    "🇧🇷 DUB",
    },
    {
      url:      `${mn}?sv=multi-audio-2&${HQ}&sub=pt`,
      provider: "MoviesNexus #2",
      lang:     "dub",
      label:    "🇧🇷 DUB 2",
    },

    // ── PT-BR Legendado ───────────────────────────────────────────────────────
    {
      url:      `${vc}?${HQ}`,
      provider: "VidCore",
      lang:     "leg",
      label:    "🇧🇷 LEG",
    },
    {
      url:      `${mn}?sv=alpha&${HQ}&sub=pt`,
      provider: "MoviesNexus LEG",
      lang:     "leg",
      label:    "🇧🇷 LEG 2",
    },

    // ── Auto / EN — fallback ──────────────────────────────────────────────────
    {
      url:      `${vsto}?autoPlay=1`,
      provider: "VidSrc.to",
      lang:     "auto",
      label:    "Auto",
    },
    {
      url:      `${vscc}?autoPlay=1`,
      provider: "VidSrc.cc",
      lang:     "auto",
      label:    "Auto 2",
    },
  ];
}
