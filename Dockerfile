# syntax=docker/dockerfile:1
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/sdk/package.json packages/sdk/
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build \
 && rm -rf apps/web/node_modules node_modules \
 && bun install --frozen-lockfile --production --filter '@ammonode/server'

FROM oven/bun:1.4-slim
WORKDIR /app
ENV APP_ENV=production STORAGE_PATH=/app/storage APP_PORT=3000
COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages ./packages
COPY docker/entrypoint.sh /usr/local/bin/ammonode-entrypoint
RUN chmod +x /usr/local/bin/ammonode-entrypoint && mkdir -p /app/storage && chown -R bun:bun /app/storage
USER bun
EXPOSE 3000
VOLUME ["/app/storage"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD bun -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["ammonode-entrypoint"]
CMD ["bun", "apps/server/src/index.ts"]
