---
name: deploy-homeserver
description: >-
  Release process for this Mirklurk map: put merged main live at map.mirklurk.danteb.com on the user's homeserver. Use when the user says
  "deploy it on the server", "deploy to the homeserver", "ship it", "push it live" or "release it", or asks to merge and deploy.
---

# Deploy to the homeserver

**Goal:** the live site runs a new commit of this repo's `main`; only the two map containers changed, with minimal downtime, and the
previous images are kept for rollback. The homeserver (`dantebarbieri/homeserver`) builds both Docker targets from a commit pinned in its
Compose file, so a deploy means moving that pin and rebuilding just those two services.

**Details live elsewhere; read them rather than relying on memory:**

- This repo's README, "Deploying": the release model and the container contract.
- `docker/docs/MIRKLURK-MAP.md` in `dantebarbieri/homeserver`: the runbook (current pin, guarded release, verification, sharing check,
  rollback). It is authoritative for server commands.

## Steps

1. **Release from main.** If the work isn't on `main` yet, open a PR, wait for CI and merge it (merge commit). Wait until the push CI run
   for the merge commit is green (`test` and `docker-smoke`). Diff the deployed pin against the new commit to judge risk: frontend-only is
   routine, while changes to `server/`, `Dockerfile`, `deploy/`, `.dockerignore`, `compose.yaml`, `src/sharing*.ts`, `assets/` or
   `tools/smoke.sh` can affect the API, data volume, CSP or caching and deserve a closer look. Note a few strings unique to the new build
   (`deno task build`, `dist/`) so the live bundle can be identified.
2. **Delegate the server work** to a child session in the user's `homeserver` app project (`list_projects`, then `create_session` with
   `notify_on_idle`). That session reaches the server with `ssh server`. Its kickoff quotes the user's request and gives the full target
   SHA, what changed and its risk, the bundle markers, and the guardrails below. Earlier "Deploy mirklurk-map" sessions (in session history)
   are good templates.
3. **The child deploys per the runbook:** bump the pins in a homeserver PR and merge it once checks pass; preflight (clean server tree, no
   deploy hold, updater or other rollout running); fast-forward `/srv/homeserver`; record a baseline of all containers; then, under the
   shared compose lock, build and bring up only the two map services, uploads first, then web.
4. **The child verifies:** both containers are healthy with the new revision label and unchanged hardening; the site and `/healthz` work
   over IPv4 and IPv6 and serve the new bundle; the API is unchanged when the release didn't touch it; no other container changed against
   the baseline; the previous images are retained; and the runbook's synthetic sharing check passes. Prefer the GitHub-hosted "Verify
   deployed Mirklurk map sharing" workflow, and run it once: each run uses one of its client's ten new worlds per 24 hours.
5. **Close out.** When the child reports back, check the live site yourself (bundle hash and markers), then give the user a short report.

## Guardrails

- Touch only `mirklurk-map` and `mirklurk-map-uploads`. Never restart, recreate or bring up any other container.
- Pin only commits on `main` that will never be rewritten. The nightly updater (04:01) rebuilds whatever is pinned and stops at the first
  failure, so a bad pin also holds back other services' updates.
- Stop and ask the user if CI is red, a deploy hold or another rollout is active, the release needs a data migration or a config, secret or
  proxy change, or verification fails. If verification fails, first roll back to the kept images per the runbook.
- Never put keys, credentials or real saves in commands, logs, PRs or messages.
