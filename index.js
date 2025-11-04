import express from 'express';
import { addonBuilder } from 'stremio-addon-sdk';
import { MovieDb } from 'moviedb-promise';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const TMDB = new MovieDb(process.env.TMDB_API_KEY);

// 🌐 CORS headers toevoegen
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*"); // Sta alle origins toe
  res.header("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  next();
});

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

// 🚀 Cache voor trailers
const trailerCache = new Map();

builder.defineMetaHandler(async ({ type, id }) => {
  try {
    const cacheKey = `${type}:${id}`;
    if (trailerCache.has(cacheKey)) {
      console.log(`⚡ Cache hit for ${id}`);
      return { meta: trailerCache.get(cacheKey) };
    }

    let tmdbId;

    // 🎯 IMDb → TMDb lookup
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
        throw new Error(`No TMDb match found for IMDb ID: ${imdbId}`);
      }
    } else {
      tmdbId = id.replace(/[^0-9]/g, '');
    }

    // 🎬 Trailer ophalen
    const videos = type === 'series'
      ? await TMDB.tvVideos({ id: tmdbId })
      : await TMDB.movieVideos({ id: tmdbId });

    const trailerObj = videos.results?.find(v => v.type === 'Trailer' && v.site === 'YouTube');

    const trailerStreams = trailerObj ? [{
      title: `Official Trailer`,
      ytId: trailerObj.key,
      lang: "en"
    }] : [];

    const meta = {
      id,
      type,
      name: type === 'movie' ? `Movie ${id}` : `Series ${id}`,
      trailerStreams
    };

    // 🧠 Cache opslaan met TTL van 6 uur
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

// Express endpoints
app.get('/:resource/:type/:id.json', (req, res) => {
  addonInterface
    .get(req.params.resource, req.params.type, req.params.id)
    .then(resp => res.json(resp))
    .catch(err => res.status(500).json({ err: err.message }));
});

app.get('/manifest.json', (req, res) => {
  res.json(addonInterface.manifest);
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`✅ TMDB Trailer Addon running at http://localhost:${PORT}/manifest.json`);
});
