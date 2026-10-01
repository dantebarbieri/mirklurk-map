# Mirklurk World Viewer

A small static site for **Mirklurk 0.8.1.5**, published at **https://map.mirklurk.danteb.com**. Open a character's save folder and it shows:

- the 5×5 world with every zone under its in-game name (`UI.ini [LocTitles]`) and coordinate (`A,1`–`E,5`), each explored zone drawn with
  the map the game itself made for it (`Maps/x_y.png`);
- where **Fort Solid, Ranger Bhato, the Library, Scaal, Gurb-Gurb and Ihar** are — or, where the game has not placed them yet, where its own
  placement rules can still put them, with probabilities;
- per zone, from the saved objects: entrances (caves, ruin cellars, quest buildings) and whether you have been inside, NPCs, unsearched
  loot, your stashes and camp items, rifts, large boulders and ruins. Creatures, small rocks, trees and a water overlay can be switched on.
  Click an explored entrance to see the inside.

Save processing happens in the browser tab: files are never uploaded. Realistic mode loads bundled art from the same site, never a third
party. There is no world seed to type in — the game does not have a reusable one (see below).

## Using it

Save and quit to the menu, then pick `…\steamapps\common\Mirklurk Every Step Matters\Saves\<character>` with **Open save folder**, drop that
folder on the page, or open a `.zip` of it. Picking the whole `Saves` folder offers a character list. `Player.save` alone also works; zone
maps and objects then stay empty.

Map controls: wheel or `+`/`−` to zoom, drag to pan, `⟲` to reset. Hover a marker for its name and tile; click a list entry to find it on
the map.

**Realistic mode** is off by default; enable it with the **Realistic** toggle. It reconstructs explored zones and interiors from saved
`.tmap` layers using the game's own tilesets, including animated-tile first frames, atlas borders, mirroring and rotation. Buildings, rocks,
placed objects and procedural trees use their saved sprites/geometry. NPCs, creatures and carcasses remain markers; this is a static
daylight-like view, not a simulation of the game's lighting, weather, animation or camera-dependent roof fading. Layer chips control
informational markers, not the scenery baked into the realistic map. Switch **Realistic** off to return to the original overview.

Zoom in uses nearest-neighbour sampling at native resolution and above. Zoom out uses a mip pyramid built with successive 2×2 area averages,
followed by filtered resampling, so small details do not flicker or disappear as they do with nearest-neighbour reduction. **World** fits
the whole 5×5 world into the map; click a neighbouring zone to inspect it. Only four full-resolution areas are retained, alongside small
world previews. Unexplored or missing terrain is labelled rather than invented: import the full character folder or ZIP for realistic
terrain (`Player.save` or map PNGs alone are insufficient).

## How the guesses work

All rules below were read from the decompiled game (UndertaleModCli, `data.win` of 0.8.1.5); the entry names are given so they can be
re-checked after an update.

**The world layout is fixed at new game** (`gml_Object_obj_menu_Alarm_8`) and saved in `Player.save`: the grid, and the zones of Bhato
(`rangerCamp`), the Library (`libraryArea`) and Scaal (`riftQuestArea`, the fort mirrored through the centre). The random stream is only
`randomize()`d at startup; `manager_area` draws a `seed` but nothing uses it (the `scr_seeds` helpers have no callers). So no seed can
reproduce a world — the save is the only source.

**Buildings are placed when a zone is first generated** (`gml_Object_manager_area_Alarm_2`). Until you enter the zone, the viewer shades
every spot the rule allows (door tile of the building):

| Landmark        | Rule (x and y alike)                         | Spots                     |
| --------------- | -------------------------------------------- | ------------------------- |
| Bhato's hideout | `gridpos(1280 + irandom_range(-16,16) × 16)` | 1,089, equally likely     |
| Library         | `gridpos(1280 + irandom_range(-16,16) × 32)` | 1,089, equally likely     |
| Scaal's lair    | `gridpos(1280 + irandom_range(-16,16) × 10)` | 441, some twice as likely |

**Gurb-Gurb and Ihar are created later** (`gml_Object_manager_area_Alarm_6`, run 20 steps after entering any zone, new or revisited,
including when a save is loaded):

- _Gurb-Gurb's hut_ appears the first time you enter a **Drowned Fen** (a Savage Mirk only if the world has no Drowned Fen, which normal
  generation never produces). It re-rolls a spot until the hut's outline touches a rock, ruin or creature (or a tree near the camera —
  others are deactivated then), so on a generated zone the viewer shades the spots that pass that test.
- _Ihar's shipwreck_ is tried each time you enter a **Broken Fen** until it succeeds: up to 1,280 random spots with land at the spot, water
  just west of it, sand above it and land 8 tiles east. For a Broken Fen you have seen, the viewer runs that exact test on the saved tiles,
  giving the valid spots and the per-visit chance `1 − (1 − p)^1280`. For unseen ones it assumes 99% (the one generated Broken Fen sampled
  had 138 valid spots: 99.998%).

The zone percentages assume you head for a random candidate zone each time (one that failed can be picked again): each zone's share is its
per-visit chance divided by the sum of all of them (equal shares for Gurb-Gurb). If you are standing in a candidate zone, loading the save
tries there first.

## What the zone map shows

The base is the game's own map (land, water, slopes, big boulders; drawn when the zone was generated, so later changes such as the hut are
overlays). Markers come from the zone folder: `Solids.save` (buildings, entrances with their `transPoint`, boulders and ruins with real
sprite bounds), `Beings.save`, `Containers.save`, `Stations.save`, `Interactables.save` (rifts), `Trees.save` (loaded only when switched on)
and `Water1.tmap` / `Ygrid.save` for the water overlay. Interiors (`[ x,y,ex,ey ]` folders, `RW1`–`RW3` for Scaal's depths) are linked to
the entrance whose door is at `ex,ey` and drawn from their `Data`/`Lower`/`OnLower`/`Water1` layers.

## Development

Needs only [Deno](https://deno.com) 2.x; there are no dependencies.

```powershell
deno task dev      # http://127.0.0.1:8123 — also serves ../Saves read-only, so /?dev=<Character>&zone=C2 loads one
deno task test     # unit tests, plus checks against real saves in ../Saves (or $env:MIRKLURK_SAVES) when present
deno task check    # type-check
deno task build    # dist/: index.html + hashed app.*.js and style.*.css
```

`src/gamedata.ts` holds the game's names and sprite bounds. After a game update, regenerate it:

```powershell
$env:MIRKLURK_META_OUT = "$env:TEMP\mirklurk-meta"
& "C:\Program Files (x86)\UTMT_CLI\UndertaleModCli.exe" load "..\data.win" -s tools\dump_meta.csx
deno run -R -W --allow-run tools/gamedata.ts ".." "$env:TEMP\mirklurk-meta"
```

Then re-check the rules above in the decompiled entries (`UndertaleModCli dump ..\data.win -c UMT_DUMP_ALL`).

To regenerate the permitted map art, run from this repository's root:

```powershell
& "C:\Program Files (x86)\UTMT_CLI\UndertaleModCli.exe" load "D:\SteamLibrary\steamapps\common\Mirklurk Every Step Matters\data.win" -s tools\dump_art.csx
```

This reads the game without modifying it and writes only selected environment sprite strips, visual tilesets and layer metadata to
`assets/game/` and `src/artdata.json`. Images have content-hashed filenames; the build includes them in `dist/assets/game/`. No game
executables, decompiled code, full texture pages, audio or save files are shipped. Remove obsolete hashed PNGs after re-exporting a new game
version. Set `MIRKLURK_SAVES` to the installed game's `Saves` directory when using `deno task dev` from a worktree.

## Deploying

`dist/` is the whole site; serve it as static files. The Docker image builds it with Deno and serves it with unprivileged nginx on port 8080
over IPv4 and IPv6 (`deploy/nginx.conf`: strict Content-Security-Policy, immutable caching for hashed assets, `/healthz`). It runs with a
read-only root filesystem, only `/tmp` writable and no capabilities. HSTS and TLS are left to the reverse proxy.

The homeserver (`dantebarbieri/homeserver`, service `mirklurk-map`) builds this repository from a pinned commit on `main`, so a release is:
push to `main`, wait for CI (`.github/workflows/ci.yml`: tests, then `tools/smoke.sh`, which builds the image and checks that contract),
then bump the pinned commit in the homeserver. Keep pinned commits on `main`, never rewrite them, and keep CI green: the server's nightly
update builds every service and stops at the first failure.

For a local check where Docker is available: `docker compose up --build -d` (http://127.0.0.1:8098) or `bash tools/smoke.sh`. The build
context is an allowlist (`.dockerignore`), so game files and saves cannot end up in the image.

Unofficial fan tool. Mirklurk and the game art are by Edym Pixels. Selected game art is used on this site with the developer's permission;
it remains the developer's copyrighted material and is not relicensed as part of the viewer's source code.
