// Gera URLs de embed para filmes e séries por TMDB ID.
// Providers testados e funcionais em iframe sem sandbox.
//
// PT-BR Legendado: vidsrc.io com ?sub_lang=pt-BR
// PT-BR Dublado:   vidsrc.cc (tem servidores com dub PT-BR)
// Fallback geral:  vidsrc.to, vidsrc.net, embedwave.cc

/**
 * @typedef {Object} EmbedSource
 * @property {string} url      - URL completa do embed
 * @property {string} provider - Nome amigável
 * @property {string} lang     - "dub" | "leg" | "auto"
 * @property {string} label    - Label exibido no botão
 */

/**
 * Retorna fontes de embed agrupadas por idioma.
 * Prioridade padrão: DUB PT-BR → LEG PT-BR → Auto/EN
 *
 * @param {{ type: "movie"|"serie", tmdbId: number|string, season?: number, episode?: number }} opts
 * @returns {EmbedSource[]}
 */
export function getEmbedSources({ type, tmdbId, season, episode }) {
  const s = season  || 1;
  const e = episode || 1;

  const isMovie = type === "movie";
  const movieSeg = `movie/${tmdbId}`;
  const tvSeg    = `tv/${tmdbId}/${s}/${e}`;
  const seg      = isMovie ? movieSeg : tvSeg;

  return [
    // ── PT-BR Dublado ────────────────────────────────────────────────────────
    // vidsrc.cc tem servidores com conteúdo dublado PT-BR
    {
      url:      `https://vidsrc.cc/v2/embed/${seg}`,
      provider: "VidSrc CC",
      lang:     "dub",
      label:    "🇧🇷 DUB",
    },
    {
      url:      `https://vidsrc.cc/v3/embed/${seg}?autoPlay=1`,
      provider: "VidSrc CC v3",
      lang:     "dub",
      label:    "🇧🇷 DUB 2",
    },

    // ── PT-BR Legendado ──────────────────────────────────────────────────────
    // vidsrc.io suporta ?sub_lang= para pré-selecionar legenda
    {
      url:      `https://vidsrc.io/embed/${seg}?sub_lang=pt-BR`,
      provider: "VidSrc.io",
      lang:     "leg",
      label:    "🇧🇷 LEG",
    },
    // superembed aceita ?lang= para legendas
    {
      url:      `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1${!isMovie ? `&s=${s}&e=${e}` : ""}`,
      provider: "MultiEmbed",
      lang:     "leg",
      label:    "🇧🇷 LEG 2",
    },

    // ── Auto / EN — fallback geral ───────────────────────────────────────────
    {
      url:      `https://vidsrc.to/embed/${seg}`,
      provider: "VidSrc.to",
      lang:     "auto",
      label:    "Auto",
    },
    {
      url:      `https://embedwave.cc/embed/${seg}`,
      provider: "EmbedWave",
      lang:     "auto",
      label:    "Auto 2",
    },
  ];
}
