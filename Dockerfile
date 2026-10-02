FROM denoland/deno:2.9.7 AS build
WORKDIR /app
COPY deno.json index.html style.css ./
COPY src ./src
COPY assets/game ./assets/game
COPY tools/build.ts ./tools/build.ts
RUN deno run --allow-read --allow-write --allow-run --allow-env tools/build.ts

FROM denoland/deno:2.9.7 AS uploads
USER root
WORKDIR /app
COPY deno.json ./
COPY src ./src
COPY server ./server
RUN mkdir /data && chown deno:deno /data
USER deno
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD deno eval "const r = await fetch('http://127.0.0.1:8081/healthz'); Deno.exit(r.ok ? 0 : 1)"
CMD ["run", "--no-prompt", "--allow-net=0.0.0.0:8081", "--allow-read=/app,/data", "--allow-write=/data", "--allow-env=UPLOAD_DIR,TRUST_UPLOAD_PROXY", "server/uploads.ts"]

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
