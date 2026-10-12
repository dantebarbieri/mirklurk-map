# Copilot instructions

MirkMap is a dependency-free Deno 2 TypeScript project (browser viewer and save editor in `src/`, upload service in `server/`, tools in
`tools/`, tests in `tests/`). Follow `CONTRIBUTING.md`.

- Run `deno task ci` (format check, lint, type-check, tests with coverage thresholds, build) before pushing; CI runs the same.
- Never add dependencies or external imports; tests use `tests/assert.ts`.
- Add or update `tests/<module>_test.ts` with every behaviour change; keep tests offline and deterministic.
- Do not lower the coverage thresholds in `deno.json`, add lint ignores, or weaken CI or the review gate to get a change through.
- Never commit saves, keys or tokens.

## When reviewing pull requests

Focus on correctness against the game's rules described in the README, regressions in save reading or writing (the editor must never corrupt
a save), privacy (saves stay local unless the user opts in to sync), the upload service's security and the container hardening in `deploy/`
and `Dockerfile`, and missing tests. Skip pure style nits: `deno fmt` and `deno lint` already enforce style.
