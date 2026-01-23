import multiprocessing
import os

# Gunicorn config for FastAPI via UvicornWorker.
# Used when backend container sets USE_GUNICORN=1.

bind = f"0.0.0.0:{os.getenv('PORT', '8080')}"
worker_class = "uvicorn.workers.UvicornWorker"

# Sensible defaults; can be overridden via env vars.
workers = int(os.getenv("WEB_CONCURRENCY", str(max(2, multiprocessing.cpu_count()))))
threads = int(os.getenv("GUNICORN_THREADS", "1"))

# Timeouts: keep modest; adjust for long-polling endpoints.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "60"))
graceful_timeout = int(os.getenv("GUNICORN_GRACEFUL_TIMEOUT", "30"))
keepalive = int(os.getenv("GUNICORN_KEEPALIVE", "5"))

# Logging to stdout/stderr (container-friendly).
loglevel = os.getenv("LOG_LEVEL", "info").lower()
accesslog = "-"
errorlog = "-"
