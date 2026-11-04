# syntax=docker/dockerfile:1

# ---- Build the web app (React + TypeScript) ----
FROM node:26-bookworm-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Build the eco binary (the web app is embedded in it) ----
FROM golang:1.27-bookworm AS build
WORKDIR /src
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
COPY --from=web /web/dist ./web/dist
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/eco ./cmd/eco

# ---- Runtime: eco + the tools it shells out to ----
FROM debian:bookworm-slim
ARG TARGETARCH
ARG YTDLP_VERSION=latest
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg unzip \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp: the standalone binary, so no Python is needed. Rebuild the image to update it.
# deno: the JavaScript runtime yt-dlp needs to solve YouTube's challenges.
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) ytdlp=yt-dlp_linux;         deno=x86_64-unknown-linux-gnu ;; \
      arm64) ytdlp=yt-dlp_linux_aarch64; deno=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    if [ "${YTDLP_VERSION}" = latest ]; then base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    else base=https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}; fi; \
    curl -fsSL "$base/$ytdlp" -o /usr/local/bin/yt-dlp; chmod 755 /usr/local/bin/yt-dlp; \
    curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${deno}.zip" -o /tmp/deno.zip; \
    unzip -q /tmp/deno.zip -d /usr/local/bin; rm /tmp/deno.zip; chmod 755 /usr/local/bin/deno

COPY --from=build /out/eco /usr/local/bin/eco

# The container runs as an arbitrary UID (PUID:PGID in docker-compose.yml): give tools a writable home
ENV HOME=/tmp XDG_CACHE_HOME=/tmp/.cache DENO_DIR=/tmp/.deno \
    ECO_LISTEN=0.0.0.0:8000 DATA_DIR=/data ECO_ROOT=/data
WORKDIR /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD curl -fsS http://127.0.0.1:8000/healthz || exit 1
ENTRYPOINT ["eco"]
CMD ["serve"]
