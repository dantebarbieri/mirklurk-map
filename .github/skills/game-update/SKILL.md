---
name: game-update
description: >-
  Updates MirkMap for a new Mirklurk game version: decide what the patch changes that MirkMap reads, shows, predicts or edits, add the
  version and its rules, regenerate the game data and art, update the README and tests, then merge and deploy. Use when the game updated,
  a new patch, release or Steam beta is out, or a coordinator hands over a patch report for MirkMap.
---

# Update MirkMap for a game version

**Goal:** a save from the new version gets its rules and **Latest** names it, older versions keep theirs, and the generated data, art,
README and tests match the new build, merged to `main` through one PR and live. Every version needs at least that, even one that changes
nothing MirkMap models (it then shares an earlier version's rules).

**The patch analysis is shared with the wiki, so it lives elsewhere; read it rather than redoing it:**

- The personal coordinator skill `mirklurk-game-update` (`~/.copilot/skills/mirklurk-game-update/SKILL.md`, Part 1, and its
  `analyze-patch.ps1`) backs up `data.win` as `data.<version>.win`, decompiles the new and previous builds, diffs them, fetches the Steam
  notes and ends in `patch-<version>-report.md`. Work from that report. If nobody handed you one, run Part 1 yourself, and tell the user
  that the wiki (`dantebarbieri/mirklurk-wiki`, its own `game-update` skill) needs a session too.
- This repo's [README](../../../README.md): "Game versions", "How the guesses work" and "Development" (the generator commands), and
  [CONTRIBUTING.md](../../../CONTRIBUTING.md) for tests, checks and merging.

Without the coordinator skill, do the minimum by hand, keeping everything in this session's files folder (`<files>`):

```powershell
$game = 'D:\SteamLibrary\steamapps\common\Mirklurk Every Step Matters'
$cli = 'C:\Program Files (x86)\UTMT_CLI\UndertaleModCli.exe'
# First copy data.win to data.<version>.win if that backup is missing (never overwrite one) and compare their SHA256s.
& $cli dump "$game\data.<version>.win" -o "<files>\dump-<version>" -c UMT_DUMP_ALL -s
& $cli dump "$game\data.<previous>.win" -o "<files>\dump-<previous>" -c UMT_DUMP_ALL -s
git diff --no-index "<files>\dump-<previous>" "<files>\dump-<version>" > "<files>\code-and-strings.diff"
```

Reuse an earlier session's `dump-<previous>` (under `~/.copilot/session-state/*/files/`) instead of the second dump when there is one. Then
write `<files>\patch-<version>-report.md`: for every change in the diff, the code entry and function, the IDs it touches with their names,
the exact before → after values, what the player sees, and the Steam patch note that covers it, if any.

**Precedents** (`gh pr view <n> --json files`, `git show`): #43–#45, the 0.8.9.9 beta (new items, beings, art and rules; `src/version.ts`
and the version switch); #48, 0.9.0.0 (nothing to model: shared rules, Latest, Beta hidden); #49, the wiki refresh after it; #51, 0.9.0.1
and 0.9.0.2 (rules that differ by version); #52, 0.9.1.0 (new items, one of them a chopping tool).

## Steps

1. **Start.** Read the report and the latest version PR. Check `get_sessions_status` for another seed-map session on the same files or a
   deploy in flight, and work around it.
2. **Triage every change.** Decide whether MirkMap reads, shows, predicts or edits it, and keep the verdict and its evidence for the PR and
   the README. UI text, menus, sounds and dev-only code (`global.DEVmode`, `QUICKMODE`) rarely matter. When a change matters only if a save
   holds some state, scan the real saves read-only for it (#52 found no worn coins). Where things land:
   - save format and load-time migrations (`scr_saveload`, `manager_area_Step_0`): `src/save.ts` and the editor (`src/editor/`);
   - the item database (`databank_Alarm_1`): sizes, stacks, durability, fuel and containers are generated (`src/itemdata.ts`); prices
     (`WARE_DATA` in `src/merchants.ts`), `chopMod` (`CHOP_TOOLS` in `src/chop.ts`) and armor (`ARMOR_POINTS` in `src/armor.ts`) are ported
     by hand;
   - beings (`databank_Alarm_3`): `BEINGS` in `src/bestiary.ts`; trader stock (`menu_add` in `scr_menu_related`): `STOCK` in
     `src/merchants.ts`; both by hand;
   - world generation (`obj_menu_Alarm_8`, `manager_area_Alarm_2`): `src/predict.ts`, `src/rules.ts`; harvests (`loot_amountchances`):
     `src/gather.ts`;
   - names and the journal (`Languages\English\*.ini`): generated `src/gamedata.ts`; tiles and environment sprites: `assets/game/` and
     `src/artdata.json`.
3. **Add the version** in `src/version.ts`: append it to `VERSIONS`, and point `CHANNELS.latest` at it (or `beta` while it is an opt-in
   Steam beta; drop `beta` once it is released, as #48 did). When nothing MirkMap models changed, map it in `SAME_RULES` to the version
   whose rules it shares, which must not be mapped itself. Add new item and being index ranges to `ADDED` (`hasItem`, `hasBeing`): the
   editor's pickers and its save check (`src/editor/compat.ts`) already follow them, but any other list of items or beings must too, as
   `toolsIn` in `src/chop.ts` does for the new Flint Dagger (#52). Update the header comment.
4. **Version the rules that changed.** Port the new value and keep the old one behind `atLeast(rules, "<version>")` in a function that takes
   `rules: GameVersion`, as `priceOf`, `armorOf` and `durabilityMax` do (#51), then pass the rules in use through its callers (`ctx.rules`,
   `st.rules`, `editorRules()`). What the build that wrote the save did follows the save's own version, not the switch (`src/estimate.ts`).
   Renames are not versioned: every version shows the newest names. For save-format changes, the editor writes what that version's game
   writes (`src/editor/raft.ts`) and keeps every key it does not own.
5. **Regenerate the generated files** with the README's Development commands, run against `data.<version>.win` and the new dump:
   - `src/itemdata.ts`: `tools/itemdata.ts` on `<files>\dump-<version>\CodeEntries`;
   - `src/gamedata.ts`: `tools/dump_meta.csx` with `MIRKLURK_META_OUT` set to a temporary folder, then `tools/gamedata.ts`. It reads the
     installed game's `Languages\English\*.ini`, which the game rewrites on launch, so first check that they match the new build (the
     coordinator's `Languages-<version>` snapshot) or launch the game once;
   - art: run `tools/dump_art.csx` with `MIRKLURK_ART_OUT` set to a temporary folder and compare its `assets/game/` and `src/artdata.json`
     with the repo's. If they differ, remove `$env:MIRKLURK_ART_OUT` (it overrides the working directory), run it again from the repo root
     and delete the files it no longer references, as #43 did. Either way, set the version in `tools/dump_art.csx` and `src/artdata.json`.
     New item icons are not map art; their pictures come from the wiki (step 9).

   Every line the generators change must match a change in the report; anything else means the wrong build or stale language files.
6. **Bump the version stamps** once the entries behind them are re-checked: the "ported from Mirklurk <version>" header comments
   (`git grep -n "Mirklurk <previous>" -- src tools`, about a dozen files; `src/merchants.ts` also names the rules it follows) and the
   comments in `src/version.ts` that name Latest's version.
7. **README.** In "Game versions": the opening paragraph (what Steam runs, its release date, whose rules MirkMap has), "Which rules apply"
   if who gets a switch changed, and one "What <version> changed" bullet: what MirkMap now shows or edits differently, what changed that it
   does not show, and whether saves name the new `VERSION` with the same keys. Also update the intro at the top, the opening of "How the
   guesses work" (which `data.win` the rules were read from and diffed against), and every rule section a change touches, with entry names.
8. **Tests** (CONTRIBUTING's rules): `tests/version_test.ts` (`VERSIONS`, Latest, `sameRules`, detection, the switch's options, `hasItem`
   and `hasBeing` for new ranges), and a by-version test in the module test of every rule that changed. `tests/inventory_test.ts` lets items
   from `FIRST_NEW_ITEM` on and beings in `NEW_BEINGS` lack a wiki page; add new beings there until `deno task wiki` finds theirs. Run
   `deno task ci`, then `deno task test` with `$env:MIRKLURK_SAVES` set to the game's `Saves` folder (it only reads them), and check by hand
   on `deno task dev` (`/?dev=<Character>`, `/edit/?dev=<Character>`) that a save whose version's rules differ from Latest's shows the
   switch and one with Latest's rules does not (`src/versionview.ts`).
9. **Wiki links and pictures.** MirkMap links an item or being only to a verified wiki page with its title (usually the in-game name; see
   `itemTitle` and `beingTitle` in `src/wiki.ts`), and `deno task wiki` bundles `File:<Title>_icon_(cropped).png` or `_icon.png` for items
   and `_sprite` or `_portrait` for beings. Tell the wiki session (or the coordinator) the titles that new or renamed content needs, and ask
   to hear when they are live. Then run `deno task wiki` and check the diff of `src/wikidata.json`, `src/wikiart.json` and `assets/wiki/`.
   If the version PR has merged by then, refresh in a small follow-up PR (#49); deploy it only if it changes what users see.
10. **Pull request.** Fill `.github/pull_request_template.md`: what changed for players and in which files, the verdict on what was not
    modeled, and each test command with its result (real saves included, with the versions they hold). Open it ready for review, get `test`,
    `docker-smoke` and `copilot-review` green, address and resolve every review thread, and merge with a merge commit as CONTRIBUTING
    describes.
11. **Deploy** with this repo's `deploy-homeserver` skill (`.github/skills/deploy-homeserver/SKILL.md`). The wiki deploys to the same
    server, so don't overlap its rollout, and the server's deploy guard may need the user's sudo password. Then report to the coordinator,
    or the user: the PR, the homeserver PR, the live bundle, and what changed in MirkMap and what didn't.

## Guardrails

- The game folder is read-only, apart from the coordinator's backup. Run the UndertaleModCli scripts on `data.<version>.win`, which Steam
  will not replace mid-work.
- Never commit decompiled code, dumps, language files, saves or game binaries; the repo gets only what the tools generate. Cite entry names,
  not code, and confirm every rule and README claim in the decompiled code. A patch note with no matching code is not modeled.
- The editor must never corrupt a save: keep fields it does not own, and add nothing the save's version lacks.
- Don't lower the coverage thresholds, add lint ignores, or weaken CI or the review gate to get the update through.
