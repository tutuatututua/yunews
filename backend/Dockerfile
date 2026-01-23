FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY gunicorn_conf.py /app/gunicorn_conf.py
COPY app /app/app

EXPOSE 8080

# Many platforms (Cloud Run, Render, etc.) inject the desired listening port via $PORT.
CMD ["sh", "-c", "if [ \"${USE_GUNICORN:-0}\" = \"1\" ]; then gunicorn -c gunicorn_conf.py app.main:app; else uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}; fi"]
