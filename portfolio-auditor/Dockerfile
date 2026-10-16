# The RPS portfolio review engine (rps_api.py), with the headless browser it needs.
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
# Chromium plus the system libraries it needs, at whatever version pip installed.
RUN pip install --no-cache-dir -r requirements.txt  && python -m playwright install --with-deps chromium  && rm -rf /var/lib/apt/lists/*

COPY analyzer.py scraper.py rps_review.py rps_api.py ./

# Reports, screenshots, daily counts and 1:1 bookings live here. Mount a
# persistent volume at /data so they survive restarts and redeploys.
ENV CACHE_DB_PATH=/data/audit_cache.sqlite3 \
    SHOTS_DIR=/data/shots \
    REQUIRE_TOKEN=1 \
    PYTHONUNBUFFERED=1
RUN mkdir -p /data/shots

# Hosts set $PORT; 8765 locally.
CMD ["sh", "-c", "uvicorn rps_api:app --host 0.0.0.0 --port ${PORT:-8765}"]
