# Contexto de build: raiz do repositório
FROM node:24-slim AS base
RUN npm install -g pnpm@12.8.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @doomscroll/worker
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
RUN pnpm --filter @doomscroll/worker build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @doomscroll/worker

# whisper.cpp compilado a partir de uma versão fixa; só o binário whisper-cli vai para a imagem final.
# O modelo (ggml-<WHISPER_MODEL>.bin) é baixado na primeira transcrição, para um volume.
FROM node:24-slim AS whisper
ARG WHISPER_CPP_VERSION=v1.9.5
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake curl ca-certificates \
 && apt-get clean
WORKDIR /src
RUN curl -fsSL "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${WHISPER_CPP_VERSION}.tar.gz" | tar xz --strip-components=1
# GGML_NATIVE=OFF para a imagem rodar em qualquer máquina (inclusive a do CI); AVX2 cobre CPUs x86 desde ~2013.
RUN cpu=""; [ "$TARGETARCH" = "amd64" ] && cpu="-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"; \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF $cpu \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
 && cmake --build build -j "$(nproc)" --config Release --target whisper-cli \
 && cp build/bin/whisper-cli /usr/local/bin/whisper-cli

FROM node:24-slim
# ffmpeg vem do apt; yt-dlp é o binário oficial, fácil de atualizar:
#   docker compose build --build-arg YT_DLP_VERSION=<versão> worker
ARG YT_DLP_VERSION=latest
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl libgomp1 \
 && apt-get clean \
 && asset=yt-dlp_linux; [ "$TARGETARCH" = "arm64" ] && asset=yt-dlp_linux_aarch64; \
    if [ "$YT_DLP_VERSION" = "latest" ]; then base=https://github.com/yt-dlp/yt-dlp/releases/latest/download; \
    else base=https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION; fi; \
    curl -fsSL -o /usr/local/bin/yt-dlp "$base/$asset" \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version
COPY --from=whisper /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli
# Pontos de montagem dos volumes, já com dono node (senão o volume nasce como root).
RUN mkdir -p /data/media /data/whisper && chown -R node:node /data
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/apps/worker/node_modules apps/worker/node_modules
COPY --from=build /app/apps/worker/dist apps/worker/dist
COPY apps/worker/package.json apps/worker/
WORKDIR /app/apps/worker
USER node
CMD ["node", "dist/index.js"]
