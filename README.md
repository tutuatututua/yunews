# yuNews

## Prereqs
- Docker Desktop
- A Supabase project
- YouTube Data API v3 key (LOCAL PIPELINE ONLY)
- OpenAI API key (LOCAL PIPELINE ONLY)

## 1) Create database schema
1. Open Supabase SQL editor
2. Run: `local-pipeline/app/db/schema.sql`

## 2) Configure environment
1. Backend API env:
   - Create/fill `backend-api/.env` (tip: start from `backend-api/.env.example`)
   - Fill:
     - `SUPABASE_URL`
     - `SUPABASE_ANON_KEY` (recommended)
       - Use the **anon public JWT key** from Supabase (it typically starts with `eyJ...`).
       - A `sb_publishable_...` key will usually fail for the backend API with "Invalid API key".

2. Local pipeline env (LOCAL ONLY):
   - Fill `local-pipeline/.env`
   - Fill:
     - `SUPABASE_URL`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `YOUTUBE_API_KEY`
     - `OPENAI_API_KEY`

## 3) Run cloud-safe API + frontend
```bash
docker compose up --build backend-api frontend
```
- Backend: http://localhost:8080
- Frontend: http://localhost:5173

### Troubleshooting (Windows)
- **Docker build fails with** `invalid file request ...` (common when the repo is inside OneDrive):
  - Move the project folder outside OneDrive (recommended), or mark the folder as **Always keep on this device**.
  - Then re-run `docker compose up --build backend-api frontend`.

## 4) Run local pipeline (LOCAL ONLY)
```bash
docker compose --profile local up --build local-pipeline
```
- Pipeline API: http://localhost:8001

### Trigger an ingest run
```bash
curl -X POST http://localhost:8001/pipeline/run
```

## API Routes
- `GET /health`
- `GET /daily-summaries/latest`
- `GET /daily-summaries?limit=30`
- `GET /videos?date=YYYY-MM-DD&limit=50`
- `GET /videos/{video_id}`

## Pipeline Routes (LOCAL ONLY)
- `GET /health`
- `POST /pipeline/run`
- `POST /pipeline/run?date=YYYY-MM-DD`
