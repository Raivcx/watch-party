// Gera URLs de embed usando VidSrc.to por TMDB ID.
// Sem dependência de serviços externos — só precisa do TMDB ID.
// O player do VidSrc já tem qualidade, legendas e múltiplos servidores.
//
// Docs: https://vidsrc.to/

const PROVIDERS = [
  "https://vidsrc.to",
  "https://vidsrc.me",
  "https://vidsrc.net",
];

/**
 * Retorna array de URLs de embed para um filme ou episódio.
 * Múltiplos providers como fallback caso algum esteja fora.
 *
 * @param {{ type: "movie"|"serie", tmdbId: number|string, season?: number, episode?: number }} opts
 * @returns {Array<{url: string, provider: string, quality: string}>}
 */
export function getEmbedSources({ type, tmdbId, season, episode }) {
  return PROVIDERS.map((base) => {
    let url;
    if (type === "movie") {
      url = `${base}/embed/movie/${tmdbId}`;
    } else {
      url = `${base}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
    }
    return {
      url,
      provider: new URL(base).hostname,
      quality: "Auto",
    };
  });
}
