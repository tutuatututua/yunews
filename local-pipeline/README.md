# Pipeline (ECS Job)

This folder is a **batch job** that is meant to run to completion (daily/cron), not a long-running web service.

## Local (Docker Compose)

- Ensure `local-pipeline/.env` exists and contains required secrets (Supabase + OpenAI + YouTube).
- The daily summary aggregates stored videos published in the last 24 hours. This is filtered in the pipeline summary query, so it does not require widening the YouTube API discovery window.
- You can still override the summary window with `DAILY_SUMMARY_LOOKBACK_HOURS` if needed.
- Run once:

```bash
docker compose --profile pipeline run --rm local-pipeline
```

## DB schema changes

If your Supabase schema was created before a change landed, apply any incremental SQL in:
- `local-pipeline/app/db/migrations/`

### Backfill youtuber recommendations (old videos)

1) Apply the migration:

- `local-pipeline/app/db/migrations/2026-02-23_youtuber_recommendations.sql`

2) Run the backfill script:

```bash
python local-pipeline/backfill_youtuber_recommendations.py --dry-run --days 3650 --limit 20000
python local-pipeline/backfill_youtuber_recommendations.py --days 3650 --limit 20000
```

## Production (AWS ECS)

Deploy this as:

- **ECR image** built from `local-pipeline/Dockerfile`
- **ECS Task Definition** (Fargate) with an entrypoint/command like `python run_daily_pipeline.py`
- **EventBridge Scheduler** (cron) triggering `RunTask`

Notes:
- Use **Secrets Manager** / **SSM Parameter Store** to inject environment variables.
- Give the task its own **IAM Task Role** with least privilege.
- Do not package `.env` files into the container image.
