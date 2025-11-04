import express from 'express';
import { addonBuilder } from 'stremio-addon-sdk';
import { MovieDb } from 'moviedb-promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
// ⚡ Universele CORS middleware
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // ✅ Belangrijk
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
const TMDB = new MovieDb(process.env.TMDB_API_KEY);

// ---------- MANIFEST ----------
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

// ---------- CACHE ----------
const trailerCache = new Map(); // key: type:id, value: meta
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 uur

// ---------- META HANDLER ----------
builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const cacheKey = `${type}:${id}`;
    if (trailerCache.has(cacheKey)) {
      console.log(`⚡ Cache hit for ${id}`);
      return { meta: trailerCache.get(cacheKey) };
    }

    let tmdbId;

    // ----- IMDb-ID naar TMDb-ID -----
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
      // Numeriek ID gebruiken
      tmdbId = id.replace(/[^0-9]/g, '');
    }

    // ----- Trailer ophalen -----
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

    // ----- Cache opslaan -----
    trailerCache.set(cacheKey, meta);
    setTimeout(() => trailerCache.delete(cacheKey), CACHE_TTL_MS);

    console.log(`🎥 Trailer cached for ${id} (tmdb:${tmdbId})`);

    return { meta };

  } catch (err) {
    console.error('Trailer error:', err.message);
    return { meta: null };
  }
});

const addonInterface = builder.getInterface();

// ---------- EXPRESS ROUTES ----------
// Manifest route
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(addonInterface.manifest);
});

// Meta route
app.get('/meta/:type/:id.json', async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const resp = await addonInterface.get('meta', req.params.type, req.params.id);
    res.json(resp);
  } catch (err) {
    res.status(500).json({ err: err.message });
  }
});

// ---------- SERVER START ----------
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`✅ TMDB Trailer Addon running at port ${PORT}`);
  console.log(`🔗 Manifest: http://localhost:${PORT}/manifest.json (use your Render URL in production)`);
});
