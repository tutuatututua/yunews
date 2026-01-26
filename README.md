# yuNews

## Prereqs
- Docker Desktop
- A Supabase project
- YouTube Data API v3 key (LOCAL PIPELINE ONLY)
- OpenAI API key (LOCAL PIPELINE ONLY)

## 1) Create database schema
1. Open Supabase SQL editor
2. Run: `local-pipeline/app/db/schema.sql`

If you already created the schema before 2026-01-23, also run:
- `local-pipeline/app/db/migrations/2026-01-23_add_sentiment_and_drop_video_summaries_tickers.sql`

## 2) Configure environment
1. Backend API env:
   - Create/fill `backend/.env` (tip: start from `backend/.env.example`)
   - Fill:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
       - Server-side only; bypasses RLS.

2. Frontend API base URL:
   - For Vite dev (`npm run dev`): create `frontend/.env` (tip: start from `frontend/.env.example`).
   - For Docker builds: create a root `.env` next to `docker-compose.yml` (tip: start from `.env.example`).
   - Set `VITE_BACKEND_BASE_URL` to the backend URL that the *browser* can reach.
     - Local dev: `http://localhost:8080`
     - EC2 (recommended): `/api` (serve frontend + API from the same host via reverse proxy)
     - EC2 (direct, not recommended): `http://<your-ec2-public-ip-or-dns>:8080`
   - If you change `VITE_BACKEND_BASE_URL`, rebuild the frontend image: `docker compose build frontend`

3. Local pipeline env (LOCAL ONLY):
   - Fill `local-pipeline/.env`
   - Fill:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `YOUTUBE_API_KEY`
     - `OPENAI_API_KEY`

## 3) Run cloud-safe API + frontend
```bash
docker compose up --build backend frontend
```
- Backend: http://localhost:8080
- Frontend: http://localhost:5173

## Deploy: EC2 (Docker Compose)

Two common approaches:

1) **Clone the repo on EC2** and run `docker compose up -d --build backend frontend`.
   - Pros: simplest.
   - Cons: builds on the server.

2) **Build images in CI/local, push to a registry (ECR), then pull on EC2**.
   - Pros: faster deploys; no build toolchain on EC2.
   - Cons: you need to edit `docker-compose.yml` to use `image:` instead of `build:`.

If you take approach (2), build the frontend with the correct API base URL baked in:
- `docker build -t yunews-frontend:latest -f frontend/Dockerfile frontend --build-arg VITE_BACKEND_BASE_URL=/api`

### Troubleshooting (Windows)
- **Docker build fails with** `invalid file request ...` (common when the repo is inside OneDrive):
  - Root cause: Docker **BuildKit** rejects OneDrive “reparse point” files.
  - Fix (recommended): move the repo outside OneDrive (e.g. `C:\dev\yunews`).
  - Fix (workaround): disable BuildKit for the build/run (legacy builder):
    - PowerShell (one-off):
      - `$env:DOCKER_BUILDKIT="0"; $env:COMPOSE_DOCKER_CLI_BUILD="1"; docker compose up --build backend frontend`
    - Or use: `./scripts/compose-legacy.ps1 up --build backend frontend`

## 4) Run local pipeline (LOCAL ONLY)
```bash
docker compose --profile pipeline run --rm --build local-pipeline
```
This runs the pipeline job once and exits.

## API Routes
- `GET /health`
- `GET /daily-summaries/latest`
- `GET /daily-summaries?limit=30`
- `GET /daily-summaries/{market_date}`
- `GET /videos?date=YYYY-MM-DD&days=7&limit=50`
- `GET /videos/infographic?date=YYYY-MM-DD&days=7&limit=200`
- `GET /videos/{video_id}`
- `GET /entities/top-movers?date=YYYY-MM-DD&days=7&limit=8`
- `GET /entities/{symbol}/chunks?days=7&limit=100`

## Pipeline (LOCAL ONLY)
- Runs as a batch job (CLI/cron style), not an HTTP API.
- Deploy on AWS as an ECS scheduled task (EventBridge Scheduler 4h/1d cadence).
