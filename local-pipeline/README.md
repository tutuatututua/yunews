# Pipeline (ECS Job)

This folder is a **batch job** that is meant to run to completion (daily/cron), not a long-running web service.

## Local (Docker Compose)

- Ensure `local-pipeline/.env` exists and contains required secrets (Supabase + OpenAI + YouTube + HF token).
- Run once:

```bash
docker compose --profile pipeline run --rm local-pipeline
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
