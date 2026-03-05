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

If you see `/chat` failing with `relation "public.rag_documents" does not exist` or `match_rag_documents` missing,
run:
- `local-pipeline/app/db/migrations/2026-02-24_create_rag_documents_and_rpc.sql`

If you want in-app feedback submissions stored in Supabase, also run:
- `local-pipeline/app/db/migrations/2026-03-05_create_feedback.sql`

## 2) Configure environment
1. Backend API env:
   - Create/fill `backend/.env` (tip: start from `backend/.env.example`)
   - Fill:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
       - Server-side only; bypasses RLS.
     - `OPENAI_API_KEY` (REQUIRED for chatbot)
     - (optional) `OPENAI_CHAT_MODEL` (default: gpt-4.1-mini)
    - (optional) `OPENAI_QUERY_PLANNER_MODEL` (defaults to `gpt-4.1-mini`)
       - When true, the backend will rewrite/route queries to improve retrieval.
       - The assistant answer still uses the user's original question.
     - (optional) `OPENAI_QUERY_PLANNER_MODEL` (default: gpt-4.1-mini)
     - (optional) `OPENAI_EMBEDDING_MODEL` (default: text-embedding-3-small)

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

  ## Deploy: Vercel (Frontend only)

  This repo contains a Vite SPA (in `frontend/`) plus a Docker-based API (in `backend/`).
  For Vercel, deploy **only** the frontend:

  1. In Vercel Project Settings → General → **Root Directory**, set it to `frontend`.
  2. Output directory should be `dist` (Vercel reads this from `frontend/vercel.json`).
  3. If you still hit Vercel build memory limits on the Free tier, either:
    - Enable **Enhanced Builds** (bigger build machine), or
    - Reduce bundle/build workload further (e.g., avoid importing large libs on initial route).

  ## Deploy: Vercel (Backend)

  Vercel can run the FastAPI app as a Python Serverless Function (see `backend/api/index.py`).

  1. In Vercel Project Settings → General → **Root Directory**, set it to `backend`.
  2. Add the backend env vars in Vercel (see `backend/.env.example`).
  3. If you previously saw a Vercel memory error during backend build: it was likely from installing `torch/sentence-transformers`. The default backend requirements are now Vercel-friendly.
  4. Embeddings on Vercel use OpenAI (no `torch`).

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
- `POST /chat` (or `POST /api/chat` when served behind the frontend nginx `/api` proxy)

## Pipeline (LOCAL ONLY)
- Runs as a batch job (CLI/cron style), not an HTTP API.
- Deploy on AWS as an ECS scheduled task (EventBridge Scheduler 4h/1d cadence).

## Chatbot (RAG)
- The local pipeline now writes semantic-search documents to `rag_documents`:
  - `ticker_summary` (per video + ticker)
  - `video_summary` (per video)
  - `highlight` (per video, chunked key takeaways)
- The backend `POST /chat` endpoint performs retrieval (top 5) + LLM generation and streams tokens (SSE).
- If retrieval returns nothing relevant, the chatbot replies with “I don’t have that information.”
