# Multi-stage: build client, run API + static client
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-slim
WORKDIR /app/server
ENV NODE_ENV=production
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/ ./
COPY --from=client-build /app/client/dist /app/client/dist
RUN mkdir -p /data
ENV VC_DB_PATH=/data/vibechat.db VC_UPLOADS_DIR=/data/uploads PORT=4811
VOLUME /data
EXPOSE 4811
CMD ["node", "src/index.js"]
