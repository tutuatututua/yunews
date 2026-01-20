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

2. Frontend API base URL (build-time, for Docker/Vite):
   - Create a root `.env` next to `docker-compose.yml` (tip: start from `.env.example`).
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
docker compose up --build backend-api frontend
```
- Backend: http://localhost:8080
- Frontend: http://localhost:5173

## Deploy: EC2 (docker-compose + ECR images)

If your EC2 instance does **not** have the repo source code (no `frontend/` folder), `docker build ... frontend` will fail with `path "frontend" not found`. In that setup, build images locally (or in CI), push to ECR, then **pull and run** on EC2.

1) Build + push the frontend image (local machine / CI)
- Bake the API URL into the Vite build via a build-arg:
  - `docker build -t yunews-frontend:latest -f frontend/Dockerfile frontend --build-arg VITE_BACKEND_BASE_URL=https://api.yourdomain.com`
- Tag + push to ECR (example):
  - `docker tag yunews-frontend:latest <account-id>.dkr.ecr.<region>.amazonaws.com/yunews-frontend:latest`
  - `docker push <account-id>.dkr.ecr.<region>.amazonaws.com/yunews-frontend:latest`

2) On EC2, run using the ECR images
- Copy [deploy/ec2/docker-compose.yml](deploy/ec2/docker-compose.yml) to your EC2 box (or use it in-place if you cloned the repo).
- Create a `.env` next to the compose file (tip: start from [deploy/ec2/.env.example](deploy/ec2/.env.example)) and set `ECR_REGISTRY`, plus image tags and Supabase config.
- Log in to ECR, pull, then start:
  - `docker compose -f deploy/ec2/docker-compose.yml pull`
  - `docker compose -f deploy/ec2/docker-compose.yml up -d`

### Troubleshooting (Windows)
- **Docker build fails with** `invalid file request ...` (common when the repo is inside OneDrive):
  - Move the project folder outside OneDrive (recommended), or mark the folder as **Always keep on this device**.
  - Then re-run `docker compose up --build backend-api frontend`.

## 4) Run local pipeline (LOCAL ONLY)
```bash
docker compose --profile pipeline run --rm --build local-pipeline
```
This runs the pipeline job once and exits.

## API Routes
- `GET /health`
- `GET /daily-summaries/latest`
- `GET /daily-summaries?limit=30`
- `GET /videos?date=YYYY-MM-DD&limit=50`
- `GET /videos/{video_id}`

## Pipeline (LOCAL ONLY)
- Runs as a batch job (CLI/cron style), not an HTTP API.
- Deploy on AWS as an ECS scheduled task (EventBridge Scheduler 4h/1d cadence).
