# Pipeline (ECS Job)

This folder is a **batch job** that is meant to run to completion (daily/cron), not a long-running web service.

## Local (Docker Compose)

- Ensure `local-pipeline/.env` exists and contains required secrets (Supabase + OpenAI + YouTube).
- Run once:

```bash
docker compose --profile pipeline run --rm local-pipeline
```

## Daily summary day boundary (ET)

Daily summaries are grouped by **America/New_York (ET)** day boundaries.
When the job runs at **midnight ET**, it generates the daily summary for the **previous ET day**.

## Vercel (Cron)

Vercel can run this pipeline via a Python Serverless Function + Vercel Cron.

1) In Vercel, create a **new project** and set the **Root Directory** to `local-pipeline/`.
2) Set environment variables in Vercel (Project → Settings → Environment Variables):
	- `OPENAI_API_KEY`
	- `YOUTUBE_API_KEY`
	- `SUPABASE_URL`
	- `SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_SERVICE_KEY`
	- `PIPELINE_ENABLE_EMBEDDINGS=0` (recommended for Vercel)
	- Optional: `PIPELINE_CRON_KEY` (shared secret for the cron endpoint)

The cron is configured in `local-pipeline/vercel.json` to call:
- `GET /api/daily_pipeline` at `0 0 * * *` in `America/New_York`.

Notes:
- If `PIPELINE_CRON_KEY` is set, the endpoint requires `x-pipeline-key: <value>` (or `?key=<value>`).
- Vercel Serverless Functions have runtime/time limits; heavy workloads may need ECS/Cloud Run.

## Optional embeddings

Embeddings/RAG writes are optional.

Set:
- `PIPELINE_ENABLE_EMBEDDINGS=1` (default)

## DB schema changes

If your Supabase schema was created before a change landed, apply any incremental SQL in:
- `local-pipeline/app/db/migrations/`

## Production (AWS ECS)

Deploy this as:

- **ECR image** built from `local-pipeline/Dockerfile`
- **ECS Task Definition** (Fargate) with an entrypoint/command like `python run_daily_pipeline.py`
- **EventBridge Scheduler** (cron) triggering `RunTask`

Notes:
- Use **Secrets Manager** / **SSM Parameter Store** to inject environment variables.
- Give the task its own **IAM Task Role** with least privilege.
- Do not package `.env` files into the container image.
