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
FROM python:3.13-slim
WORKDIR /app

ARG SCRAPER_BACKEND=auto
ENV SCRAPER_BACKEND=${SCRAPER_BACKEND}

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Playwright system dependencies
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

# Modify dev requirements dynamically based on SCRAPER_BACKEND before installing
RUN if [ "$SCRAPER_BACKEND" = "patchright" ]; then \
        sed -i 's/playwright>=1.40.0//g' pyproject.toml && \
        uv lock; \
    elif [ "$SCRAPER_BACKEND" = "playwright" ]; then \
        sed -i 's/"patchright",//g' pyproject.toml && \
        sed -i 's/"patchright"//g' pyproject.toml && \
        uv lock; \
    fi

RUN uv sync --frozen --no-dev

# Copy application source
COPY backend/ ./

# Copy compiled frontend assets from stage 1
COPY --from=frontend-builder /backend/app/static ./app/static

# Install correct Chromium browser based on backend arg
RUN if [ "$SCRAPER_BACKEND" = "playwright" ]; then \
        uv run playwright install chromium --with-deps; \
    elif [ "$SCRAPER_BACKEND" = "patchright" ]; then \
        uv run patchright install chromium --with-deps || true; \
    else \
        uv run playwright install chromium --with-deps && \
        uv run patchright install chromium --with-deps || true; \
    fi

EXPOSE 8000
CMD if [ "$SCRAPER_HEADLESS" = "false" ]; then xvfb-run -a -s "-screen 0 1920x1080x24" uv run fastapi run app/main.py --host 0.0.0.0 --port 8000; else uv run fastapi run app/main.py --host 0.0.0.0 --port 8000; fi
