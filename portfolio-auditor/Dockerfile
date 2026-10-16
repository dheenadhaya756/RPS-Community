# The RPS portfolio review engine (rps_api.py), with the headless browser it needs.
# Built for a free Hugging Face Docker Space (it also runs anywhere Docker does).
FROM python:3.11-slim

# Browsers go somewhere every user can read: Spaces run the app as user 1000, not root.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
# Chromium plus the system libraries it needs, at whatever version pip installed.
RUN pip install --no-cache-dir -r requirements.txt \
 && python -m playwright install --with-deps chromium \
 && chmod -R a+rx /ms-playwright \
 && rm -rf /var/lib/apt/lists/*

COPY analyzer.py scraper.py rps_review.py rps_api.py ./

# Reports, screenshots and today's counts. On a free Space this disk resets
# when the Space restarts; the daily limit is also kept on each account, and
# 1:1 bookings are stored in Supabase, so neither is lost.
ENV CACHE_DB_PATH=/data/audit_cache.sqlite3 \
    SHOTS_DIR=/data/shots \
    REQUIRE_TOKEN=1
RUN mkdir -p /data/shots && chmod -R 777 /data

# Hugging Face routes to 7860; other hosts set $PORT.
EXPOSE 7860
CMD ["sh", "-c", "uvicorn rps_api:app --host 0.0.0.0 --port ${PORT:-7860}"]
