# Mirklurk World Viewer

A small browser-based viewer for **Mirklurk 0.8.1.5**, published at **https://map.mirklurk.danteb.com**. Open a character's save folder and
it shows:

- the 5×5 world with every zone under its in-game name (`UI.ini [LocTitles]`) and coordinate (`A,1`–`E,5`), each explored zone drawn with
  the map the game itself made for it (`Maps/x_y.png`);
- where **Fort Solid, Ranger Bhato, the Library, Scaal, Gurb-Gurb and Ihar** are — or, where the game has not placed them yet, where its own
  placement rules can still put them, with probabilities;
- per zone, from the saved objects: entrances (caves, ruin cellars, quest buildings) and whether you have been inside, NPCs, unsearched
  loot, your stashes and camp items, rifts, large boulders and ruin rubble. Creatures, small rocks, trees, brambles, rift vines, sharp
  ground and a water overlay can be switched on. Click an explored entrance to see the inside.

Save processing happens in the browser tab. Files stay local unless you explicitly upload a temporary shared copy. Realistic mode loads
bundled art from the same site, never a third party. There is no world seed to type in — the game does not have a reusable one (see below).

## Using it

Save and quit to the menu, then pick `…\steamapps\common\Mirklurk Every Step Matters\Saves\<character>` with **Open save folder**, drop that
folder on the page, or open a `.zip` of it. Picking the whole `Saves` folder offers a character list. `Player.save` alone also works; zone
maps and objects then stay empty.

Map controls: wheel, two-finger pinch, or `+`/`−` to zoom; drag to pan; `⟲` to reset. Pinching also pans around the fingers' midpoint. Tap a
marker to inspect it, or hover for its name and tile; click a list entry to find it on the map. Touch gestures inside the map control the
map, while outside it normal page scrolling and browser zoom remain available. Controls and panels adapt to narrow phone screens.

### Temporary sharing (opt-in)

Open a local save, expand **Shared saves / open on another device**, and click **Upload selected save for 7 days**. Only the selected
character is uploaded, even when several characters were imported. Copy the generated private link to your phone and open it there, or paste
it into the shared-save browser. The browser remembers links opened on that device, not a public list of everyone's saves. Private links
contain unguessable read tokens in their URL fragment; treat them as secrets. Anyone given one can see the save, including inventory data.

For live sharing, first start **Live saves**, upload the selected character, then check **Publish saved changes to this link**. The desktop
tab sends only accepted, settled snapshots, at most once every 30 seconds when they change. Keep that tab open with directory permission.
The receiving device polls every 30 seconds while visible; unchanged versions are not downloaded. This follows saves, not live movement, and
browser background throttling or suspension can delay updates. Switching source or character stops automatic publishing; stopping live saves
also stops publishing. Viewing preserves map/inspection state unless **Follow saved location** moves to another area.

The uploading browser keeps a separate owner key for replacing/deleting its upload; read links never grant write access. **Delete upload**
immediately removes the server copy. **Forget link** only removes the device's saved shortcut (and owner key, if present). Clearing browser
storage loses these keys. Neither deletion nor expiry can revoke a copy already downloaded by someone else. To reuse a remembered link after
reloading the desktop tab, open the local save (or restart Live saves) and choose **Replace with selected save** beside that link. This
retains its original expiry and lets you re-enable publishing without creating another upload.

Server defaults are deliberately bounded:

| Limit           | Default                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| Active saves    | Three per client IP; IPv6 addresses in one /64 share a quota                                               |
| New shares      | Six per IP in a rolling 24 hours, including subsequently deleted shares                                    |
| Retention       | Seven days from creation; updates never extend expiry                                                      |
| Save package    | One character, 64 MiB including manifest, at most 4,096 files; uncompressed to avoid ZIP expansion attacks |
| Updates         | At most once per 30 seconds per share; only one upload body processed at a time globally                   |
| API requests    | 60/minute per IP, plus nginx request/connection limits                                                     |
| Storage         | 128 active saves, 1 GiB total payload; 2,048 records including deletion quota records                      |
| Upload duration | 60 seconds                                                                                                 |

Requests for expired copies fail immediately; a minute-based sweep removes their files (or startup cleanup after downtime). Deletion keeps
only quota metadata until the original expiry, not save bytes. Salted IP hashes are stored instead of raw IP addresses, and creation quotas
survive service restarts. The in-memory short-term request limiter resets on restart. Shared networks/NATs share the same IP quota. These
are abuse guardrails, not protection against a distributed attack; keep reverse-proxy bandwidth and resource limits in place. The package
manifest is capped at 1 MiB, and `Player.save` at 4 MiB before JSON parsing, to bound validation memory use.

### Live saves (opt-in)

Click **Live saves...** in desktop Chrome or Edge on HTTPS (or localhost), then grant **read-only** access to a character folder or the
whole `Saves` folder. The site polls every 1.5 seconds, discovers added/deleted files, and refreshes after writes have settled. Nothing is
uploaded, written to the game, or installed. **Stop live saves** stops polling and retains the last displayed snapshot. Opening a folder,
ZIP, or dropped save manually also stops monitoring. Access is requested again when restarting live mode; it is not stored across reloads.
Browsers without the directory picker retain manual import.

**This follows saved locations, not live movement.** The game saves before area transitions, on new-area generation, after normal sleep, at
some story checkpoints, and when saving to the menu. Because a transition save is written while you still stand at the border or door, live
mode (and watching a shared link) **estimates** where you went: a save within the travel strip at a zone edge, or within 3 tiles of an
entrance, way out or stairs, moves you to the spot the game puts you on the other side (see _Where you are_ below). Estimates are labelled
(est.), and hovering the person shows the basis and the true saved position. Manual imports, and stopping live saves, always show the saved
position only. **Follow saved location** selects the player's (estimated) zone/interior on refresh; turn it off to keep inspecting another
area. Zoom, inspection selection and expanded sections are retained on same-area refreshes. The snapshot label shows `Player.save`'s
timestamp when available; ZIP imports do not currently expose one.

The game writes a save over 19 game steps: player first, containers last. Live mode waits for at least 1.5 seconds of unchanged metadata,
checks that the current area's container file is at least as recent as the player file, validates newly read data, then rechecks the
directory before publishing immutable file contents. Interrupted writes or lost permissions leave the previous snapshot visible with an
error/retry notice. This is a best-effort coherent disk snapshot, not a game-provided atomic transaction. When monitoring several characters
together, an incomplete character save delays the folder snapshot; choose a single character folder to isolate it.

### Inventory, containers and wiki

Expand **Saved equipment & inventory** to see equipped items and nested bag contents, stack quantities, saved durability values (not
percentages), and wetness. Click a container/corpse/drop marker or list entry to inspect its saved contents. Reopened chests, empty
containers, wood drops and separate `LOOT-x_y.save` ground-loot records are included.

Ground-loot files remain separate, labeled entries even when a container occupies the same tile; the two records may describe different
contents or save times. If one container inventory is malformed during manual import, its marker remains with unavailable contents and a
warning, without hiding other containers. Live mode instead rejects malformed updates, including invalid saved tree geometry, and keeps the
last accepted snapshot.

- **Not rolled when saved:** unopened treasure chests and placed remains; the game rolls their contents on first opening.
- **Empty when saved:** a recorded inventory with no items.
- **Unavailable:** the save does not contain the inventory data, or the record cannot be read.

Creature corpse loot is rolled at death but is only visible here after saving. Some ground-loot records are written independently when a
loot window closes, so their age can differ from the player snapshot. Unsaved changes, future rolls, and later item decay cannot be
inferred. The viewer never rolls loot itself.

Item names and entity **Wiki** links open verified pages on `mirklurk.wiki` in a separate tab. Unrolled loot links to its source guide;
entities without a dedicated known page use a relevant guide instead of a guessed article URL. The bundled public-title catalog is verified
at development time, not by sending save data to the wiki; pages can change after verification.

**Realistic mode** is off by default; enable it with the **Realistic** toggle. It reconstructs explored zones and interiors from saved
`.tmap` layers using the game's own tilesets, including animated-tile first frames, atlas borders, mirroring and rotation. Buildings, rocks,
placed objects and procedural trees use their saved sprites/geometry. NPCs, creatures and carcasses remain markers; this is a static
daylight-like view, not a simulation of the game's lighting, weather, animation or camera-dependent roof fading. Layer chips control
informational markers, grouped as **Locations** (Places, Caves, Ruins, Rifts; indoor "Way out" exits always show), **Entities** (You, NPCs,
Creatures), **Items**, **Terrain** (including Water) and **Nature**; each group's header checkbox (and the master **All**) toggles all its
layers and shows a partial state when only some are on, and **Reset to defaults** restores the initial selection. They do not affect the
scenery baked into the realistic map. Zooming out past the selected zone also shows other zones' markers for the enabled layers, loaded as
each zone first comes into view. Switch **Realistic** off to return to the original overview.

Zoom in uses nearest-neighbour sampling at native resolution and above. Zoom out uses a mip pyramid built with successive 2×2 area averages,
followed by filtered resampling, so small details do not flicker or disappear as they do with nearest-neighbour reduction. **World** fits
the whole 5×5 world into the map; click a neighbouring zone to inspect it. Only four full-resolution areas are retained, alongside small
world previews. Switching realistic mode off cancels pending terrain work and releases its caches; switching it back on rebuilds them.
Unexplored or missing terrain is labelled rather than invented: import the full character folder or ZIP for realistic terrain (`Player.save`
or map PNGs alone are insufficient).

### Trees: trunk liveliness and chopping cost

Switch on **Trees** to draw each real tree (Willow, Cypress, Trollgnarl, Elderwort Shrub) as a small silhouette of its species, coloured by
how alive its trunk is, from green (_Very Fresh_) through yellow (_Half Dead_) to red (_Dead_), using the game's own five freshness labels.
Willows have hanging crowns, cypresses have pointed, uneven boughs, Trollgnarls have bare twisted forks, and Elderwort Shrubs have three
flower clusters. Map markers and list icons share the same hand-drawn shapes. Freshness colours the foliage (or the bare Trollgnarl); the
pale stems on the other species are just a visual anchor, not a second health indicator. No wiki images are loaded for these icons.
**Trunks** hides all but the drier trees (Half Dead, Mostly Dead or Dead only), which are much cheaper to fell for logs. **Chop with**,
beside a clicked tree's harvest cost, picks the tool used for costs; it defaults to the best chopping tool your character carries (equipped
or in a bag), else bare hands, and a manual pick resets to that default once the carried tools change. Hovering a tree shows its freshness,
% alive and trunk harvest cost; clicking it shows the cost with the chosen tool and every other tool, the logs the felled trunk drops, and a
link to the wiki's _Tree health and chopping_ guide (linked ahead of that page's deployment, as its title is fixed). **Trees, deadest
first** lists the zone's trees (respecting the filter), and the choices are kept across zones and characters.

Costs are the action points the game's harvest menu shows, at save time; trees keep growing and drying after that. The game refuses a chop
that costs more than the player's maximum of 8 AP (`actionPointsMax` in `gml_Object_obj_player_Create_0`), and the inspector says so;
outside combat a cheaper chop still goes through with fewer AP left, and the shortfall comes off the next turn. Trunk life never recovers:
it only drops during the growth the game catches up on when you return to a zone (mostly on high ground and low inner branches) and near
live rifts, so many lowland trees stay fresh.

**Brambles**, **Rift Vines** and **Sharp ground** are separate layers. Brambles (brown) and Rift Vines (pink) give no firewood but hinder
walking: each plant gets a thorn marker and the ground tiles the game saved under it (`NatureData.tmap` 1 and 3) are shaded. Sharp ground
(`NatureData.tmap` 2, pale) has no plant: the game lays it as the ring of debris around Fort Solid's clearing
(`gml_Object_manager_area_Alarm_2`) and as sharp floor patches in caves (`dungeonlike_areas` in `gml_GlobalScript_scr_mapcreations`; cave
interiors are not shaded here). A step's AP cost is divided by the tile's footing, which brambles cut by 0.4, rift vines by 0.6 and sharp
ground by 1.0 (`tile_get_moment` in `gml_GlobalScript_scr_tiles_movement`), and each step there also costs wellbeing and gear durability.
**Boulders** and **Rubble** (ruin footprints and blocks you cannot enter) are separate from the enterable **Ruins** under Locations.

**Rifts** are drawn with a dashed circle showing how far they reach: 24 × a base radius of 8 (192 px, 12 tiles) for the large rift or 2.5
(60 px) for the small one, measured from the sprite centre. Within it a rift withers tree parts, spreads rift grass and poisons you; a rift
that hits you in your sleep takes up to half a health point, less further out. Dead rifts do nothing (`gml_Object_obj_rift_Alarm_0`).

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

**Tree liveliness and harvest cost** (`src/chop.ts`). Each saved tree part has a life value from 1 to 0 that drops as it grows (`tree_grow`
in `gml_GlobalScript_scr_nature`); below `global.NATDEAD` = 0.33 (`gml_Room_rm_int_Create`) it loses its leaves and stops growing. The trunk
is the root part. The harvest menu (`gml_Object_UI_Draw_64`) shows freshness `round(4 − 4 × life)` (Very Fresh … Dead) and charges
`24 × size ÷ (round(max(0.1, 1 − life) × 10) × 0.5)` AP, so a dead trunk costs a tenth of a living one. Trunks are then multiplied by
`1.33 + size` (Elderwort uses `8 × size` for its stem and `4 × size` for branches instead). The cost is capped at 32, multiplied by 1.2 for
Cypress and 2 for Trollgnarl, divided by the tool's `chopMod` (`gml_Object_databank_Alarm_1`; e.g. Iron Hand Axe 3, Steel Felling Axe 4.2,
bare hands 1), and rounded to 0.2 AP (at least 0.2). A felled trunk drops `ceil(size × trunk sprite height ÷ 16) + 1` logs, or branches when
its size is under 0.2 (`gml_Object_obj_tree_Step_0`). The wood is wet by `life − 0.5`, so dead wood is dry.

**Where you are** (`src/estimate.ts`). You are drawn as a head-and-shoulders pictogram filled with your character's hair colour (`hairBlend`
in `Player.save`), outlined dark or light by its perceived lightness, on the world grid and on the zone or interior map. The game offers
border travel at x ≤ 16, x ≥ 2544, y ≤ 48 or y ≥ 2512 (`gml_Object_UI_Draw_64`) and saves when you click it; you arrive at x = 8 / 2552 at
the same y, or at the same x with y = 56 / 2552 (`sendX`/`sendY` there plus `manager_area` Alarm_2's +16). Using an entrance (targetAction 4
in `gml_Object_obj_player_Step_0`) saves too, then `obj_screenfader` Step_0 places you at its `transPoint` 3–4 inside; a way out returns you
to the entrance's interaction point, 16 below. Saves the game makes on arriving (a new zone, or first entering a quest room, `manager_area`
Alarm_3) are recognised and not read as another departure.

## What the zone map shows

The base is the game's own map (land, water, slopes, big boulders; drawn when the zone was generated, so later changes such as the hut are
overlays). Markers come from the zone folder: `Solids.save` (buildings, entrances with their `transPoint`, boulders and ruins with real
sprite bounds), `Beings.save`, `Containers.save`, `Stations.save`, `Interactables.save` (rifts), `Trees.save` (loaded only when trees,
brambles or rift vines are switched on), `NatureData.tmap` for thorny ground and `Water1.tmap` / `Ygrid.save` for the water overlay.
Interiors (`[ x,y,ex,ey ]` folders, `RW1`–`RW3` for Scaal's depths) are linked to the entrance whose door is at `ex,ey` and drawn from their
`Data`/`Lower`/`OnLower`/`Water1` layers.

## Development

Needs only [Deno](https://deno.com) 2.x; there are no dependencies.

```powershell
deno task dev      # http://127.0.0.1:8123 — also serves ../Saves read-only, so /?dev=<Character>&zone=C2 loads one
deno task test     # unit tests, plus checks against real saves in ../Saves (or $env:MIRKLURK_SAVES) when present
deno task check    # type-check
deno task build    # dist/: index.html + hashed app.*.js and style.*.css
deno task wiki     # refresh src/wikidata.json from the public wiki; no saves or game data are sent
```

To exercise sharing locally, set `$env:ENABLE_UPLOADS = "true"` before `deno task dev`. Uploads are stored in the ignored `.uploads/`
directory, never in `dist/`. The dev server otherwise leaves uploads disabled.

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
executables, decompiled code, full texture pages, audio or save files are shipped. Builds copy only images referenced by the manifest, so
obsolete hashes from earlier exports are not shipped. Set `MIRKLURK_SAVES` to the installed game's `Saves` directory when using
`deno task dev` from a worktree.

## Deploying

`dist/` remains a standalone static viewer without sharing. The default Docker image (`web` target) builds it with Deno and serves it with
unprivileged nginx on port 8080 over IPv4 and IPv6 (`deploy/nginx.conf`: strict Content-Security-Policy, immutable caching for hashed
assets, `/healthz`). It runs with a read-only root filesystem, only `/tmp` writable and no capabilities. HSTS and TLS are left to the
reverse proxy.

Sharing adds a second service built from the Dockerfile's **`uploads` target**, on private port **8081**, with a persistent volume at
**`/data`** owned by the image's `deno` user. `compose.yaml` is a complete local example. The web container forwards `/api/` to
`uploads:8081` using Docker DNS; without that service only sharing is unavailable. The upload container needs no outbound network access,
serves no public directory listing, and should never have a published host port. Use one upload-service instance per data volume; the
atomic-file store and quota lock are intentionally single-process, not a distributed database. Do not back up save payloads if the seven-day
retention promise must include backups.

**Homeserver wiring is required for sharing.** Keep the existing web service, add the upload-target service and volume on a private network,
and give that service the network alias `uploads`. `TRUST_UPLOAD_PROXY=true` accepts `X-Upload-IP` from the web container, which always
overwrites that header. Only enable it on a network where callers cannot bypass that web container.

When nginx is behind the homeserver's TLS reverse proxy, configure nginx's real-IP module to trust **only that proxy's exact address or
dedicated subnet**, for example in the nginx `server` block:

```nginx
set_real_ip_from 172.30.0.2; # Replace with the actual, trusted reverse proxy address.
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

The TLS proxy must overwrite or correctly append the actual client IP, not trust arbitrary client-supplied forwarding headers. Never use
`set_real_ip_from 0.0.0.0/0`. Without this configuration all visitors behind the proxy share its three-save quota (safe but restrictive).
Verify two distinct external client IPs are accounted separately before enabling public uploads. API access logs are disabled in the bundled
nginx; also redact `/api/shares/*` URLs in upstream proxy/error logs because they contain read capabilities. The default CSP now permits
same-origin API connections only. Keep a disk quota on the volume and the example CPU/memory limits.

The homeserver (`dantebarbieri/homeserver`, service `mirklurk-map`) builds this repository from a pinned commit on `main`, so a release is:
push to `main`, wait for CI (`.github/workflows/ci.yml`: tests, then `tools/smoke.sh`, which builds the image and checks that contract),
then bump the pinned commit in the homeserver. Keep pinned commits on `main`, never rewrite them, and keep CI green: the server's nightly
update builds every service and stops at the first failure.

For a local check where Docker is available: `docker compose up --build -d` (http://127.0.0.1:8098) or `bash tools/smoke.sh`. The build
context is an allowlist (`.dockerignore`), so game files and saves cannot end up in the image.

Unofficial fan tool. Mirklurk and the game art are by Edym Pixels. Selected game art is used on this site with the developer's permission;
it remains the developer's copyrighted material and is not relicensed as part of the viewer's source code.
