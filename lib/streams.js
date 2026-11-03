// Gera URLs de embed para filmes e séries por TMDB ID.
//
// Providers por tier de confiabilidade (Nov 2026):
//
//  TIER 1 — Alta disponibilidade, infra própria
//   vidsrc.to       — oficial, uptime consistente, PT sub via ?sub=pt
//   vidsrc.cc v3    — multi-server, HLS adaptativo 1080p, PT sub
//   vidsrc.sh       — mesmo serviço do vidsrc.me, redirecionado; multi-server PT sub
//
//  TIER 2 — Bom mas menos estável
//   vidcore.org     — developer-focused, TMDB nativo, HLS 4K
//   autoembed.me    — crawla múltiplas fontes; bom para títulos obscuros
//   vidsrc.net      — mirror comunitário vidsrc, confiável
//
//  TIER 3 — Instável (Cloudflare Worker free — estoura 100k req/dia)
//   moviesnexus.fun — mantido como DUB PT-BR de último recurso
//
// Nota: DUB PT-BR não tem provider 100% confiável. Os players de Tier 1/2
// servem legenda PT automática; DUB real depende da disponibilidade do
// servidor upstream do moviesnexus.

/**
 * @typedef {Object} EmbedSource
 * @property {string} url      - URL completa do embed
 * @property {string} provider - Nome amigável
 * @property {string} lang     - "dub" | "leg" | "auto"
 * @property {string} label    - Label exibido no botão
 * @property {number} priority - Menor = tentado primeiro pelo watchdog
 */

export function getEmbedSources({ type, tmdbId, season, episode }) {
  const s = season  || 1;
  const e = episode || 1;
  const isMovie = type === "movie";

  // ── Base paths ──────────────────────────────────────────────────────────────

  // TIER 1
  const vsto = isMovie
    ? `https://vidsrc.to/embed/movie/${tmdbId}`
    : `https://vidsrc.to/embed/tv/${tmdbId}/${s}/${e}`;

  const vscc3 = isMovie
    ? `https://vidsrc.cc/v3/embed/movie/${tmdbId}`
    : `https://vidsrc.cc/v3/embed/tv/${tmdbId}/${s}/${e}`;

  const vssh = isMovie
    ? `https://vidsrc.sh/embed/movie/${tmdbId}`
    : `https://vidsrc.sh/embed/tv/${tmdbId}/${s}/${e}`;

  // TIER 2
  const vc = isMovie
    ? `https://vidcore.org/embed/movie/${tmdbId}`
    : `https://vidcore.org/embed/tv/${tmdbId}/${s}/${e}`;

  const ae = isMovie
    ? `https://autoembed.me/movie/tmdb/${tmdbId}`
    : `https://autoembed.me/tv/tmdb/${tmdbId}-${s}-${e}`;

  const vsnet = isMovie
    ? `https://vidsrc.net/embed/movie/${tmdbId}`
    : `https://vidsrc.net/embed/tv/?tmdb=${tmdbId}&season=${s}&episode=${e}`;

  // TIER 3 — DUB PT-BR (instável)
  const mn = isMovie
    ? `https://www.moviesnexus.fun/movie/${tmdbId}`
    : `https://www.moviesnexus.fun/tv/${tmdbId}/${s}/${e}`;

  return [
    // ── PT-BR Dublado ─────────────────────────────────────────────────────────
    // MovieNexus é o único com DUB real; mantemos 2 servidores como fallback
    {
      url:      `${mn}?sv=multi-audio&autoPlay=1&sub=pt`,
      provider: "MoviesNexus",
      lang:     "dub",
      label:    "🇧🇷 DUB",
      priority: 1,
    },
    {
      url:      `${mn}?sv=multi-audio-2&autoPlay=1&sub=pt`,
      provider: "MoviesNexus #2",
      lang:     "dub",
      label:    "🇧🇷 DUB 2",
      priority: 2,
    },

    // ── PT-BR Legendado ───────────────────────────────────────────────────────
    // vidsrc.to e vidsrc.sh têm PT sub nativo e são os mais confiáveis
    {
      url:      `${vsto}?sub=pt`,
      provider: "VidSrc",
      lang:     "leg",
      label:    "🇧🇷 LEG",
      priority: 1,
    },
    {
      url:      `${vssh}?sub=pt`,
      provider: "VidSrc.sh",
      lang:     "leg",
      label:    "🇧🇷 LEG 2",
      priority: 2,
    },
    {
      url:      `${vc}`,
      provider: "VidCore",
      lang:     "leg",
      label:    "🇧🇷 LEG 3",
      priority: 3,
    },

    // ── Auto / EN — fallback mais robusto ─────────────────────────────────────
    {
      url:      `${vscc3}`,
      provider: "VidSrc.cc",
      lang:     "auto",
      label:    "Auto",
      priority: 1,
    },
    {
      url:      `${vsnet}`,
      provider: "VidSrc.net",
      lang:     "auto",
      label:    "Auto 2",
      priority: 2,
    },
    {
      url:      `${ae}`,
      provider: "AutoEmbed",
      lang:     "auto",
      label:    "Auto 3",
      priority: 3,
    },
  ];
}
