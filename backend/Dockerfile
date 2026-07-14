# ── Stage 1: build frontend ──────────────────────────────────────────────────
FROM node:24-slim AS frontend-builder
WORKDIR /frontend
RUN npm install -g npm@latest
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Vite outDir is ../backend/app/static (relative to /frontend),
# so the output lands at /backend/app/static

# ── Stage 2: Python app ──────────────────────────────────────────────────────
FROM python:3.14-slim
WORKDIR /app

ARG SCRAPER_HEADLESS=false
ENV SCRAPER_HEADLESS=${SCRAPER_HEADLESS}

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Patchright system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    xvfb \
    xauth \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY backend/pyproject.toml backend/uv.lock* ./

RUN uv sync --frozen --no-dev

# Copy application source
COPY backend/ ./

# Copy compiled frontend assets from stage 1
COPY --from=frontend-builder /backend/app/static ./app/static

# Install Chromium browser
RUN uv run patchright install chromium --with-deps

EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD ["python3", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/api/health', timeout=5).status == 200 else 1)"]

# Trust X-Forwarded-For from these proxy IPs so login rate limiting sees real
# client addresses behind a reverse proxy. Set to your proxy's IP (or "*" if
# the container port is not reachable directly) via docker-compose/.env.
ENV FORWARDED_ALLOW_IPS=127.0.0.1

# Must stay a single worker process: APScheduler runs in-process, and multiple
# workers would each schedule (and run) every scrape job.
CMD if [ "$SCRAPER_HEADLESS" = "false" ]; then xvfb-run -a -s "-screen 0 1920x1080x24" uv run fastapi run app/main.py --host 0.0.0.0 --port 8000 --proxy-headers; else uv run fastapi run app/main.py --host 0.0.0.0 --port 8000 --proxy-headers; fi
