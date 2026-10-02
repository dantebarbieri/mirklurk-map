#!/usr/bin/env bash
# Builds the image and checks the contract the homeserver relies on: read-only root filesystem with only
# /tmp writable, no capabilities, non-root, /healthz, security and cache headers, IPv4 and IPv6. Never deploys.
set -euo pipefail

img=mirklurk-map:smoke
name=mirklurk-map-smoke
net=mirklurk-map-smoke
base=http://127.0.0.1:18080

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker rm -f "$name-uploads" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT
fail() {
  echo "FAIL: $*" >&2
  docker logs "$name" >&2 || true
  exit 1
}

docker build --pull -t "$img" .
docker network create --ipv6 --subnet fd6d:6170:7000::/64 "$net" >/dev/null
docker build --target uploads -t "$img-uploads" .
docker run -d --name "$name-uploads" --network "$net" --network-alias uploads \
  --read-only --tmpfs /tmp:size=16m --tmpfs /data:uid=1000,gid=1000,mode=700,size=128m \
  --cap-drop ALL --security-opt no-new-privileges -e TRUST_UPLOAD_PROXY=true "$img-uploads" >/dev/null
docker run -d --name "$name" --network "$net" -p 127.0.0.1:18080:8080 \
  --read-only --tmpfs /tmp:size=16m --cap-drop ALL --security-opt no-new-privileges \
  --health-interval 2s --health-start-period 1s "$img" >/dev/null

status=starting
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$name")
  [ "$status" = healthy ] && break
  [ "$status" = unhealthy ] && break
  sleep 2
done
[ "$status" = healthy ] || fail "container is $status"

[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$name")" = true ] || fail "root filesystem is writable"
[ "$(docker exec "$name" id -u)" != 0 ] || fail "nginx runs as root"

curl -fsS "$base/healthz" | grep -qx ok || fail "/healthz"
for _ in $(seq 1 30); do
  if curl -fsS "$base/api/shares" >/dev/null; then break; fi
  sleep 1
done
curl -fsS "$base/api/shares" | grep -q '"maxActivePerIP":3' || fail "private upload service unavailable"
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/octet-stream' --data-binary invalid "$base/api/shares")" = 400 ] \
  || fail "invalid uploads must be rejected"

headers=$(curl -fsSI "$base/")
grep -qi "^content-security-policy: default-src 'none'" <<<"$headers" || fail "CSP missing on /"
grep -qi '^cache-control: no-cache' <<<"$headers" || fail "index.html should revalidate"
if grep -qi '^strict-transport-security' <<<"$headers"; then fail "HSTS belongs to the reverse proxy"; fi

html=$(curl -fsS "$base/")
js=$(grep -o 'app\.[0-9a-f]*\.js' <<<"$html" | head -n1)
css=$(grep -o 'style\.[0-9a-f]*\.css' <<<"$html" | head -n1)
[ -n "$js" ] && [ -n "$css" ] || fail "index.html does not reference hashed assets"
asset=$(curl -fsSI "$base/$js")
grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$asset" || fail "$js is not immutable"
grep -Eqi '^content-type: (application|text)/javascript' <<<"$asset" || fail "$js has the wrong type"
curl -fsSI "$base/$css" | grep -qi '^content-type: text/css' || fail "$css has the wrong type"
game_art=$(grep -o 'assets/game/[a-z0-9_]*\.[0-9a-f]*\.png' src/artdata.json | sort -u)
[ -n "$game_art" ] || fail "art manifest contains no images"
packaged_art=$(docker exec "$name" find /usr/share/nginx/html/assets/game -type f | sed 's@^/usr/share/nginx/html/@@' | sort)
[ "$game_art" = "$packaged_art" ] || fail "packaged art does not match the manifest"
while IFS= read -r art; do
  asset=$(curl -fsSI "$base/$art")
  grep -qi '^content-type: image/png' <<<"$asset" || fail "$art has the wrong type"
  grep -qi '^cache-control: public, max-age=31536000, immutable' <<<"$asset" || fail "$art is not immutable"
done <<<"$game_art"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/missing.js")" = 404 ] || fail "missing files must 404"

ip6=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.GlobalIPv6Address}}{{end}}' "$name")
[ -n "$ip6" ] || fail "no IPv6 address on the test network"
curl -fsS -g "http://[$ip6]:8080/healthz" | grep -qx ok || fail "not reachable over IPv6"

echo "smoke test passed: $js, $css"
