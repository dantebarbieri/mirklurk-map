FROM denoland/deno:2.9.7 AS build
WORKDIR /app
COPY deno.json index.html style.css ./
COPY src ./src
COPY tools/build.ts ./tools/build.ts
RUN deno run --allow-read --allow-write --allow-run --allow-env tools/build.ts

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
