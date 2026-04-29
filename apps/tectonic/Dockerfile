# syntax=docker/dockerfile:1.6
FROM debian:bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive
ENV TECTONIC_CACHE_DIR=/app/cache

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fontconfig \
        fonts-nanum \
        fonts-nanum-coding \
        fonts-noto-cjk \
        libfontconfig1 \
        libgraphite2-3 \
        libharfbuzz0b \
        libicu72 \
        python3 \
        python3-venv \
        python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Tectonic (statically linked binary).
RUN curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic@0.15.0/tectonic-0.15.0-x86_64-unknown-linux-musl.tar.gz" \
    | tar -xz -C /usr/local/bin tectonic

# Refresh font cache so xelatex finds NanumGothic / Noto CJK at runtime.
RUN fc-cache -f -v

WORKDIR /app
COPY requirements.txt .
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

COPY server.py /app/server.py

# Non-root for shell-escape mitigation.
RUN useradd -m -s /usr/sbin/nologin tectonic && \
    mkdir -p /app/cache && chown -R tectonic:tectonic /app
USER tectonic

EXPOSE 8888
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fs http://localhost:8888/healthz || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8888", "--workers", "2"]
