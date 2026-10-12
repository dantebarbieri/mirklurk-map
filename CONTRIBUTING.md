# Contributing

MirkMap is a dependency-free Deno 2 project: TypeScript in the browser, a small Deno upload service and Deno build tools. The README covers
what the app does; this file covers how changes get in.

## Layout

| Path                    | Contents                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `src/`                  | The viewer (`main.ts`) and the save editor (`editor/`); pure logic modules sit beside the UI |
| `server/`               | The opt-in upload service (`uploads.ts`)                                                     |
| `tools/`                | Build, dev server, data generators and `smoke.sh` (Docker contract test)                     |
| `tests/`                | `*_test.ts`, one per module, plus `assert.ts`                                                |
| `assets/`, `icons/`     | Bundled art; generated, never hand-edited                                                    |
| `deploy/`, `Dockerfile` | The hardened nginx image and upload-service image                                            |
| `.github/workflows/`    | CI and the review gate                                                                       |

## Commands

```powershell
deno task fmt        # format everything (deno fmt, 140 columns)
deno task lint       # lint (recommended rules plus the extras in deno.json)
deno task check      # type-check every entry point and the tests
deno task test       # run the tests
deno task coverage   # run the tests with coverage and enforce the thresholds in deno.json
deno task ci         # everything CI's "test" job runs: fmt check, lint, check, coverage, build
```

Run `deno task ci` before pushing. `.editorconfig` matches `deno fmt`, so most editors format correctly as you type.

## Standards

- **Formatting** is whatever `deno fmt` produces; CI rejects anything else. Don't hand-format around it.
- **Linting** uses Deno's recommended rules plus those listed under `lint.rules.include` in `deno.json`. Fix the code rather than adding
  `// deno-lint-ignore`; when an ignore is genuinely right, name the rule and say why on the same line.
- **No dependencies.** Imports are relative; don't add URL, `jsr:` or `npm:` packages (`no-external-import` catches URL imports). Tests use
  `tests/assert.ts`.
- **Types:** `strict` is on. Prefer precise types to `any` and non-null assertions.

## Tests

- Name tests `tests/<module>_test.ts` after the module they cover, and keep them deterministic and offline: no network, no clock or random
  dependence without injecting it, and temporary files only under `Deno.makeTempDir()`.
- Logic belongs in pure, importable modules so it can be tested without a DOM; UI files stay thin.
- Every bug fix comes with a test that fails without it; every feature with tests of its rules and edge cases.
- `real_saves_test.ts` also checks real saves when `MIRKLURK_SAVES` (or `../Saves`) exists and skips itself otherwise; never commit saves.
- Coverage may not drop below the thresholds in `deno.json` (`coverage.thresholds`). Raise them when coverage improves; never lower them to
  get a change through.

## Pull requests

`main` is protected by a repository ruleset that applies to everyone, admins included:

- Changes land only through pull requests; force pushes and deleting `main` are blocked.
- Required checks: **`test`** (format, lint, type-check, tests with coverage thresholds, build), **`docker-smoke`** (the hardened image
  contract) and **`copilot-review`**.
- Copilot reviews every pull request automatically, including drafts, and again after each push. `copilot-review` stays pending while that
  review runs, so a pull request cannot merge mid-review. If Copilot was never requested, request it under **Reviewers**.
- Every review conversation must be resolved before merging. Address the comment, or reply with why not, then resolve it.

Auto-merge is enabled: once a pull request is ready, `gh pr merge --auto --merge` (or **Enable auto-merge**) merges it as soon as every
requirement passes. Keep pull requests focused, describe what changed and how it was tested, and update the README alongside behaviour
changes.
