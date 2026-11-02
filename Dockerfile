# MC Hosting Panel en Docker. Guía: docs/LINUX.md → "Con Docker".
#
#   docker compose up -d          # o: docker build -t mc-hosting-panel . && docker run ...
#
# El panel descarga solo el Java que necesita cada servidor (Eclipse Temurin) y el agente de
# playit.gg dentro del volumen /data, así que la imagen no trae Java.

# --- 1. Compilar la interfaz --------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.js ./
COPY client ./client
RUN npm run build

# --- 2. Imagen final ------------------------------------------------------------------------
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    MCP_DATA_DIR=/data \
    PORT=8080 \
    MCP_UPDATE_MODE=docker \
    MCP_SUPERVISED=1
WORKDIR /app

# tar descomprime el Java que baja el panel; procps da `ps` para medir CPU/RAM de los servidores.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar procps ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY docs ./docs
COPY scripts/restablecer-contrasena.mjs ./scripts/
COPY --from=build /app/dist ./dist

# Todo lo del usuario (servidores, mundos, respaldos, Java) vive en /data.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

# 8080 panel · 25565/tcp Java · 19132/udp Bedrock (cada servidor nuevo usa un puerto distinto: ver compose.yaml)
EXPOSE 8080 25565/tcp 19132/udp

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Al parar el contenedor el panel apaga los servidores con "stop" y guarda los mundos (ver stop_grace_period).
STOPSIGNAL SIGTERM
CMD ["node", "server/index.js"]
