// Gera URLs de embed para filmes e séries por TMDB ID.
// Suporta seleção de idioma: PT-BR dublado ou PT-BR legendado.
//
// Providers incluídos e seus parâmetros de idioma:
//   vidsrc.io   — ?sub_lang=pt-BR  (pré-seleciona legenda PT-BR)
//   autoembed   — ?lang=pt          (player com suporte a PT-BR)
//   superembed  — ?lang=pt-BR       (legenda PT-BR automática)
//   vidsrc.to   — sem parâmetro de idioma (fallback geral)

/**
 * @typedef {Object} EmbedSource
 * @property {string} url       - URL completa do embed
 * @property {string} provider  - Nome amigável do provider
 * @property {string} lang      - "dub" | "leg" | "auto"
 */

/**
 * Retorna array de fontes de embed ordenadas por preferência.
 * Prioridade: PT-BR dub > PT-BR leg > fallback geral
 *
 * @param {{ type: "movie"|"serie", tmdbId: number|string, season?: number, episode?: number }} opts
 * @returns {EmbedSource[]}
 */
export function getEmbedSources({ type, tmdbId, season, episode }) {
  const s = season  || 1;
  const e = episode || 1;

  // Monta path base por tipo
  const moviePath = `/embed/movie/${tmdbId}`;
  const tvPath    = `/embed/tv/${tmdbId}/${s}/${e}`;
  const path      = type === "movie" ? moviePath : tvPath;

  return [
    // ── PT-BR Dublado ────────────────────────────────────────────────────────
    {
      url:      `https://player.autoembed.app${path}?lang=pt&server=1`,
      provider: "AutoEmbed",
      lang:     "dub",
      label:    "🇧🇷 DUB",
    },
    {
      url:      `https://player.autoembed.app${path}?lang=pt&server=2`,
      provider: "AutoEmbed #2",
      lang:     "dub",
      label:    "🇧🇷 DUB 2",
    },

    // ── PT-BR Legendado ──────────────────────────────────────────────────────
    {
      url:      `https://vidsrc.io${path}?sub_lang=pt-BR`,
      provider: "VidSrc.io",
      lang:     "leg",
      label:    "🇧🇷 LEG",
    },
    {
      url:      `https://superembed.stream${path}?lang=pt-BR`,
      provider: "SuperEmbed",
      lang:     "leg",
      label:    "🇧🇷 LEG 2",
    },

    // ── Fallback geral ───────────────────────────────────────────────────────
    {
      url:      `https://vidsrc.to/embed/${type === "movie" ? "movie" : "tv"}/${tmdbId}${type !== "movie" ? `/${s}/${e}` : ""}`,
      provider: "VidSrc.to",
      lang:     "auto",
      label:    "Auto",
    },
    {
      url:      `https://vidsrc.me/embed/${type === "movie" ? "movie" : "tv"}?tmdb=${tmdbId}${type !== "movie" ? `&season=${s}&episode=${e}` : ""}`,
      provider: "VidSrc.me",
      lang:     "auto",
      label:    "Auto 2",
    },
  ];
}
