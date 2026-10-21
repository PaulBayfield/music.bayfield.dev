<div align="center">
  <img src="public/favicon.svg" alt="Music Logo" width="120" />

  # Music

  **Self-hosted Spotify listening history: top songs, artists and albums, habits, sessions and affinity. A rewrite of YourSpotify with the same API, a faster PostgreSQL backend, and the UI of my other apps.**

  [![Status](https://img.shields.io/badge/status-work%20in%20progress-orange)](#--disclaimer)
  [![License](https://img.shields.io/badge/license-AGPL%203.0-blue)](LICENSE)
  [![React](https://img.shields.io/badge/React-19-61DAFB)](https://react.dev)
  [![Node.js](https://img.shields.io/badge/Node.js-24-339933)](https://nodejs.org)
  [![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-4169E1)](https://www.postgresql.org)
  [![Web](https://img.shields.io/badge/web-music.bayfield.dev-brightgreen)](https://music.bayfield.dev)
</div>


## ⚠️ • Disclaimer

This is a personal project built for my own use, not a polished product: expect missing pieces, sharp edges, and breaking changes.


## 📋 • Table of Contents

- [📖 • Overview](#--overview)
- [🛠️ • Tech Stack](#️--tech-stack)
- [🚀 • Getting Started](#--getting-started)
- [🚚 • Migrating From YourSpotify](#--migrating-from-yourspotify)
- [🔌 • YourSpotify-Compatible API](#--yourspotify-compatible-api)
- [⌨️ • Keyboard Shortcuts](#️--keyboard-shortcuts)
- [📁 • Project Structure](#--project-structure)
- [🐳 • Docker Deployment](#--docker-deployment)
- [🙌 • Credits](#--credits)
- [📄 • License](#--license)


## 📖 • Overview

Music collects what you play on Spotify (every couple of minutes, from "recently played") and turns it into stats. It replaces my [YourSpotify](https://github.com/Yooooomi/your_spotify) instance: the same routes and answers, the same Spotify app and sign-in, with a UI built like my other apps ([Calendar](https://github.com/PaulBayfield/calendar.bayfield.dev), [Notes](https://github.com/PaulBayfield/notes.bayfield.dev), [DevTime](https://github.com/PaulBayfield/dev.bayfield.dev), [Apps](https://github.com/PaulBayfield/app.bayfield.dev)).

- **Dashboard:** listening time vs the previous period, plays, different songs, daily average, best day; a stacked chart of listening time per day, week or month by artist; top songs, artists and albums; habits (release years, features, variety, peak hour); a yearly activity calendar and a weekday × hour grid. Ranges live in the URL.
- **Tops:** songs, artists and albums of any range, ranked by plays or listening time, saved as Spotify playlists in a click.
- **Artist, album and song pages:** plays, time, rank, best month, first and last listen, plays per month, most played songs and albums, when you listen.
- **History** (also in the panel on the right), **longest listening sessions**, and **affinity**: what you and the other users all listen to.
- **Import** your Spotify data export (extended streaming history or account data) to see everything since you joined Spotify.
- **Public link** to share your stats read-only, **hidden artists**, **export** as CSV or JSON.
- **Sign in with Spotify** (as on YourSpotify), devices you can sign out, an admin page for users and registrations.
- **Themes:** System, Light, Dark, Rosé Pine, Rosé Pine Dawn. English or French. Update check in **Settings → About**.

### Compared to YourSpotify

- PostgreSQL instead of MongoDB: one indexed query per stat instead of long aggregation pipelines. Every route answers in milliseconds on years of history.
- Fewer Spotify calls: tracks from "recently played" are stored as they come (with their album); only new artists are fetched. Imports read tracks already known from the database.
- The web app and the API in one container, server-side sessions you can revoke, a strict Content-Security-Policy.


## 🛠️ • Tech Stack

| Layer | Technology |
|---|---|
| Frontend | [React 19](https://react.dev), TypeScript, [Vite](https://vite.dev), hand-drawn SVG charts |
| Server | Node.js ≥ 24 (runs TypeScript directly), [Hono](https://hono.dev) |
| Database | PostgreSQL via [postgres.js](https://github.com/porsager/postgres); [embedded-postgres](https://github.com/leinelissen/embedded-postgres) for local development |
| Auth | Spotify OAuth, server-side sessions |
| Containerization | Docker Compose, images on `ghcr.io` |


## 🚀 • Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 24 and npm
- A Spotify app from the [developer dashboard](https://developer.spotify.com/dashboard) (YourSpotify's works as is)
- *(Deployment)* Docker & Docker Compose, and a reverse proxy

### Installation

```sh
git clone https://github.com/PaulBayfield/music.bayfield.dev.git
cd music.bayfield.dev
npm install && npm --prefix server install
cp server/.env.example server/.env
```

In the Spotify app, add the redirect URI `${PUBLIC_URL}/api/oauth/spotify/callback` (for local runs: `http://127.0.0.1:1432/api/oauth/spotify/callback`; Spotify doesn't accept `localhost`).

### Environment Variables

[`server/.env.example`](server/.env.example) → `server/.env`:

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | **Yes** | Where Music is reachable |
| `DATABASE_URL` | **Yes** | PostgreSQL connection URL (Docker Compose sets it) |
| `SPOTIFY_PUBLIC` / `SPOTIFY_SECRET` | **Yes** | The Spotify app's client id and secret (YourSpotify's names) |
| `SPOTIFY_REDIRECT_URI` | No | Default `${PUBLIC_URL}/api/oauth/spotify/callback` |
| `POLL_INTERVAL_SECONDS` | No (default `120`) | How often recently played tracks are fetched |
| `TIMEZONE` | No (default `Europe/Paris`) | Time zone of users who haven't picked one |
| `COMPAT_HOSTS` | No | Hosts that answer the API at the root, like YourSpotify's API server (see below) |
| `PORT` | No (default `8791`) | Port to listen on |
| `DATABASE_POOL_MAX` | No (default `10`) | Database connections |
| `SESSION_IDLE_DAYS` | No (default `30`) | Idle days before a session expires |
| `IMPORT_DIR` | No | Where uploaded exports wait while they're imported |
| `PROMETHEUS_USERNAME` / `PROMETHEUS_PASSWORD` | No | Metrics at `/api/metrics` with basic auth |
| `CLIENT_IP_HEADER` | No | Header with the visitor IP from your proxy (e.g. `cf-connecting-ip`) |
| `DEV_LOGIN_USER` | No | Local development only: a "Development sign-in" button, without Spotify |
| `UPDATE_CHECK` | No (default `true`) | Look on GitHub for a newer release |

### Running Locally

```sh
npm --prefix server run db:dev   # a local PostgreSQL on port 5434 (leave it running)
npm --prefix server run seed     # optional: two years of made-up plays for DEV_LOGIN_USER
npm run server                   # the API on :8791
npm run dev                      # the web app on http://localhost:1432
```


## 🚚 • Migrating From YourSpotify

The importer reads YourSpotify's MongoDB directly:

```sh
# Locally:
npm --prefix server run migrate:yourspotify -- "mongodb://host:27017/your_spotify"
# In Docker (MongoDB must be reachable from the container):
docker compose exec music npm run migrate:yourspotify -- "mongodb://mongo:27017/your_spotify"
```

Options: `--users name1,name2` (only these users), `--dry-run` (read everything, write nothing).

What comes over: the catalog (tracks, albums, artists), users **with their YourSpotify ids** (so URLs and API calls naming them keep working), their settings, admin rights and **public share tokens** (old share links keep working), their **Spotify tokens** (collection goes on without anyone signing in again), every play (blacklisted artists stay hidden), and the instance's preferences. Use the same Spotify app (`SPOTIFY_PUBLIC` / `SPOTIFY_SECRET`) for the tokens to stay valid.

Everyone then signs in with Spotify and finds their account. Running it again only adds what's missing; someone who signed in before the import gets their history added to that account. Stop YourSpotify before the final run so it doesn't keep collecting on its side.


## 🔌 • YourSpotify-Compatible API

Every YourSpotify route is here, with the same parameters and answers, under `/api`: `/api/me`, `/api/spotify/top/songs?start=…&end=…&nb=…`, `/api/artist/:id/stats`, `/api/spotify/collaborative/top/artists?otherIds=…&mode=…`, `/api/import/full-privacy`… Public tokens work as before (`?token=…`).

To keep YourSpotify's API address (its `API_ENDPOINT`), point that host at this container and list it in `COMPAT_HOSTS`: there, the routes answer at the root (`/spotify/top/songs`, `/me`…), exactly as they did.

The app's own additions live under `/api/app` (summary, activity calendar, weekly rhythm, timelines, devices, export, admin).


## ⌨️ • Keyboard Shortcuts

The same keys as Calendar, Notes and DevTime.

| Key | Action |
|---|---|
| `Ctrl+K` or `/` | Search artists, songs, albums, pages, settings |
| `T` | Today |
| `J` / `→` · `K` / `←` | Next / previous period |
| `W` · `M` · `Y` · `A` | This week · month · year · all time |
| `7` · `3` · `1` | Last 7 days · 30 days · 12 months |
| `Ctrl+B` (or `\`) · `.` | Toggle sidebar · recently played |
| `Ctrl+,` | Settings |
| `Esc` | Close / cancel |


## 📁 • Project Structure

```
music.bayfield.dev/
├── src/                          # React app
│   ├── components/               # Dashboard, tops, item pages, history, settings, charts…
│   ├── lib/                      # API client, i18n, settings, router, ranges
│   └── App.tsx
├── server/
│   ├── src/
│   │   ├── index.ts              # Routes, security headers, static hosting
│   │   ├── routes.ts             # YourSpotify's API
│   │   ├── stats.ts              # Its statistics, in SQL
│   │   ├── entities.ts           # Artists, albums, tracks, search
│   │   ├── app.ts                # This app's additions (/api/app)
│   │   ├── importer.ts           # Spotify data exports
│   │   ├── auth.ts               # Sessions, public links
│   │   ├── spotify/              # OAuth sign-in, the API client, catalog, poller
│   │   ├── migrate-yourspotify.ts
│   │   └── db.ts                 # Schema migrations
│   └── scripts/                  # Dev database and demo data
├── Dockerfile
└── docker-compose.yml
```


## 🐳 • Docker Deployment

One container serves the web app and the API; PostgreSQL runs next to it.

```sh
cp .env.example .env                  # POSTGRES_PASSWORD
cp server/.env.example server/.env    # PUBLIC_URL, SPOTIFY_*…  (drop the local DATABASE_URL line)
docker compose up -d
```

Health check: `GET /api/health` → `{ "ok": true }` (it also checks the database).


## 🙌 • Credits

- [YourSpotify](https://github.com/Yooooomi/your_spotify) by Yooooomi: the API, the stats and the importers this reproduces.
- Icons from [Lucide](https://lucide.dev) (ISC).


## 📄 • License

[AGPL-3.0](LICENSE)
