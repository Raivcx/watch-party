// TMDB search helpers — https://developer.themoviedb.org/reference/search
import axios from "axios";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p/w500";

function apiKey() {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error("TMDB_API_KEY is not set in the environment.");
  return key;
}

/**
 * Search TMDB for a movie or TV show by name.
 * Returns the first match with id, title, overview, poster, release year.
 */
export async function searchTitle(type, name) {
  const endpoint = type === "movie"
    ? "/search/movie"
    : "/search/tv";

  const { data } = await axios.get(TMDB_BASE + endpoint, {
    params: {
      api_key: apiKey(),
      query: name,
      language: "en-US",
      page: 1,
      include_adult: false,
    },
  });

  if (!data.results || data.results.length === 0) {
    return null;
  }

  const r = data.results[0];
  return {
    tmdbId: r.id,
    title: type === "movie" ? r.title : r.name,
    overview: r.overview || "",
    poster: r.poster_path ? TMDB_IMG + r.poster_path : null,
    year: (type === "movie" ? r.release_date : r.first_air_date || "").slice(0, 4),
  };
}

/**
 * Fetch season/episode count for a TV show so the bot can validate input.
 */
export async function getShowInfo(tmdbId) {
  const { data } = await axios.get(`${TMDB_BASE}/tv/${tmdbId}`, {
    params: { api_key: apiKey(), language: "en-US" },
  });
  return {
    name: data.name,
    seasons: data.seasons || [],
  };
}
