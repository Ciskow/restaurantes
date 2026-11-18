# Bora Comer (restaurantes)

Restaurant guide with a map, ratings and notes (interface in Brazilian Portuguese). Editing and rating are protected by a PIN. Pasting a Google Maps link can fill in address, website and opening hours.

**Stack:** React 18 + Vite + Leaflet (in `web/`), Express 5 server (in `server/`) with a SQLite database in `data/`.

## Requirements

- Node.js 24+ (uses the built-in `node:sqlite`)
- Or Docker

## Configuration

Copy the example env file and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Description |
| --- | --- | --- |
| `EDIT_PIN` | yes | PIN needed to edit places and give ratings |
| `GOOGLE_PLACES_KEY` | no | Google Places API key; lets pasted Maps links fill address, site and hours |
| `PORT` | no | HTTP port (default `8480`) |
| `DATA_DIR` | no | Folder for the database, uploads and caches (default `./data`) |

## Run locally (development)

```bash
git clone https://github.com/Ciskow/restaurantes.git
cd restaurantes
npm install
cp .env.example .env    # then edit it (the server loads .env automatically)

# terminal 1: API server on :8480
npm start

# terminal 2: web dev server, proxies /api to :8480
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

To import the public guide spreadsheet into an empty database (safe to re-run):

```bash
npm run import
```

## Run in production without Docker

```bash
npm install
npm run build
npm start
```

Open http://localhost:8480.

## Run with Docker

```bash
docker build -t bora-comer .
docker run -d --name restaurantes -p 8480:8480 --env-file .env -v ./data:/data bora-comer
```

### docker-compose

```yaml
restaurantes:
  build: ./restaurantes
  container_name: restaurantes
  image: bora-comer:latest
  restart: always
  ports:
    - "8480:8480"
  env_file:
    - ./restaurantes/.env
  environment:
    - TZ=America/Sao_Paulo
  volumes:
    - ./restaurantes/data:/data
```
