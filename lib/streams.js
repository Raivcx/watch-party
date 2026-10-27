// Gera URLs de embed para filmes e séries por TMDB ID.
// Providers testados com suporte real a PT-BR.
//
// moviesnexus.fun — ?sv=multi-audio (áudio PT-BR) | ?sub=pt (legenda PT-BR)
// vidcore.org     — legendas extraídas direto da fonte, sem ads
// vidsrc.cc       — multi-server com conteúdo PT-BR
// vidsrc.to       — fallback geral

/**
 * @typedef {Object} EmbedSource
 * @property {string} url      - URL completa do embed
 * @property {string} provider - Nome amigável
 * @property {string} lang     - "dub" | "leg" | "auto"
 * @property {string} label    - Label exibido no botão
 */

/**
 * Retorna fontes de embed agrupadas por idioma.
 *
 * @param {{ type: "movie"|"serie", tmdbId: number|string, season?: number, episode?: number }} opts
 * @returns {EmbedSource[]}
 */
export function getEmbedSources({ type, tmdbId, season, episode }) {
  const s = season  || 1;
  const e = episode || 1;
  const isMovie = type === "movie";

  // Paths por provider
  const mnMovie = `https://www.moviesnexus.fun/movie/${tmdbId}`;
  const mnTV    = `https://www.moviesnexus.fun/tv/${tmdbId}/${s}/${e}`;
  const mn      = isMovie ? mnMovie : mnTV;

  const vcMovie = `https://vidcore.org/embed/movie/${tmdbId}`;
  const vcTV    = `https://vidcore.org/embed/tv/${tmdbId}/${s}/${e}`;
  const vc      = isMovie ? vcMovie : vcTV;

  const vsccMovie = `https://vidsrc.cc/v2/embed/movie/${tmdbId}`;
  const vsccTV    = `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${s}/${e}`;
  const vscc      = isMovie ? vsccMovie : vsccTV;

  const vstoMovie = `https://vidsrc.to/embed/movie/${tmdbId}`;
  const vstoTV    = `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`;
  const vsto      = isMovie ? vstoMovie : vstoTV;

  return [
    // ── PT-BR Dublado ─────────────────────────────────────────────────────────
    // moviesnexus ?sv=multi-audio entrega áudio PT-BR quando disponível
    {
      url:      `${mn}?sv=multi-audio&autoPlay=1&sub=pt`,
      provider: "MoviesNexus",
      lang:     "dub",
      label:    "🇧🇷 DUB",
    },
    // Servidor alternativo multi-audio-2
    {
      url:      `${mn}?sv=multi-audio-2&autoPlay=1&sub=pt`,
      provider: "MoviesNexus #2",
      lang:     "dub",
      label:    "🇧🇷 DUB 2",
    },

    // ── PT-BR Legendado ───────────────────────────────────────────────────────
    // VidCore — ad-free, legendas automáticas PT-BR quando disponível
    {
      url:      `${vc}?autoPlay=1`,
      provider: "VidCore",
      lang:     "leg",
      label:    "🇧🇷 LEG",
    },
    // moviesnexus servidor padrão com legenda PT-BR forçada
    {
      url:      `${mn}?sv=alpha&autoPlay=1&sub=pt`,
      provider: "MoviesNexus LEG",
      lang:     "leg",
      label:    "🇧🇷 LEG 2",
    },

    // ── Auto / EN — fallback geral ────────────────────────────────────────────
    {
      url:      vsto,
      provider: "VidSrc.to",
      lang:     "auto",
      label:    "Auto",
    },
    {
      url:      vscc,
      provider: "VidSrc.cc",
      lang:     "auto",
      label:    "Auto 2",
    },
  ];
}
