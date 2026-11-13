# Build từ THƯ MỤC GỐC của repo (hub dùng lại bảng hợp đồng task của extension):
#   docker build -f hub/Dockerfile -t auto-vjp-hub .
FROM node:22-alpine
WORKDIR /app
COPY hub/server.js ./server.js
COPY hub/public ./public
COPY modules/kernel/contract-data.js modules/kernel/contract.js ./contract/
ENV NODE_ENV=production HUB_DATA=/data HUB_PORT=8787
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
