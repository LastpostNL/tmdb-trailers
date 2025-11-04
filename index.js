import express from 'express';
import { addonBuilder } from 'stremio-addon-sdk';
import { MovieDb } from 'moviedb-promise'; // ✅ named import
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const TMDB = new MovieDb(process.env.TMDB_API_KEY); // ✅ constructor gebruiken

const manifest = {
  id: "org.stremio.tmdb.trailers",
  version: "1.0.0",
  name: "TMDB Trailers",
  description: "Adds official TMDB trailers to Stremio titles",
  types: ["movie", "series"],
  resources: ["meta"],
  idPrefixes: ["tt", "tmdb", "movie", "series"],
  catalogs: []
};

const builder = new addonBuilder(manifest);

// 🚀 Caching map
const trailerCache = new Map();

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    // 🔑 Cache key — IMDb of TMDB id
    const cacheKey = `${type}:${id}`;
    if (trailerCache.has(cacheKey)) {
      // ✅ Cache hit
      const cached = trailerCache.get(cacheKey);
      console.log(`⚡ Cache hit for ${id}`);
      return { meta: cached };
    }

    let tmdbId;

    // 🎯 1. IMDb → TMDB lookup
    if (id.startsWith('tt')) {
      const imdbId = id.trim();
      const found = await TMDB.find({ id: imdbId, external_source: 'imdb_id' });

      const movieMatch = found.movie_results?.[0];
      const showMatch = found.tv_results?.[0];
      const episodeMatch = found.tv_episode_results?.[0];

      if (movieMatch) {
        tmdbId = movieMatch.id;
        type = 'movie';
      } else if (showMatch) {
        tmdbId = showMatch.id;
        type = 'series';
      } else if (episodeMatch) {
        tmdbId = episodeMatch.show_id || episodeMatch.id;
        type = 'series';
      } else {
        throw new Error(`No TMDB match found for IMDb ID: ${imdbId}`);
      }
    } else {
      tmdbId = id.replace(/[^0-9]/g, '');
    }

    // 🎬 2. Trailer ophalen
    const videos = type === 'series'
      ? await TMDB.tvVideos({ id: tmdbId })
      : await TMDB.movieVideos({ id: tmdbId });

    const trailerObj = videos.results?.find(
      (v) => v.type === 'Trailer' && v.site === 'YouTube'
    );

    const trailer = trailerObj
      ? `https://www.youtube.com/watch?v=${trailerObj.key}`
      : null;

    const meta = {
      id,
      type,
      name: `Trailer for ${id}`,
      trailer
    };

    // 🧠 3. In cache opslaan (met TTL van 6 uur)
    trailerCache.set(cacheKey, meta);
    setTimeout(() => trailerCache.delete(cacheKey), 6 * 60 * 60 * 1000);

    console.log(`🎥 Trailer cached for ${id} (tmdb:${tmdbId})`);

    return { meta };
  } catch (err) {
    console.error('Trailer error:', err.message);
    return { meta: null };
  }
});

const addonInterface = builder.getInterface();

// ✅ Nieuwe manier voor Express integratie:
app.get('/:resource/:type/:id.json', (req, res) => {
  addonInterface
    .get(req.params.resource, req.params.type, req.params.id)
    .then(resp => res.json(resp))
    .catch(err => res.status(500).json({ err: err.message }));
});

app.get('/manifest.json', (req, res) => {
  res.json(addonInterface.manifest);
});

const PORT = 7000;
app.listen(PORT, () => {
  console.log(`✅ TMDB Trailer Addon running at http://localhost:${PORT}/manifest.json`);
});