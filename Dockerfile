FROM node:24-alpine AS source
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY test/ ./test/

FROM source AS test
RUN npm test && touch /app/.catalog-test-passed

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=test /app/.catalog-test-passed /app/.catalog-test-passed
COPY --from=source --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=source --chown=node:node /app/node_modules/ ./node_modules/
COPY --from=source --chown=node:node /app/src/ ./src/
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=4 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
CMD ["node", "src/server.mjs"]
