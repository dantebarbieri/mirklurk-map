# Mirklurk World Viewer

A small browser-based viewer for **Mirklurk 0.8.1.5**, published at **https://map.mirklurk.danteb.com**. Open a character's save folder and
it shows:

- the 5×5 world with every zone under its in-game name (`UI.ini [LocTitles]`) and coordinate (`A,1`–`E,5`), each explored zone drawn with
  the map the game itself made for it (`Maps/x_y.png`);
- where **Fort Solid, Ranger Bhato, the Library, Scaal, Gurb-Gurb and Ihar** are — or, where the game has not placed them yet, where its own
  placement rules can still put them, with probabilities;
- per zone, from the saved objects: entrances (caves, ruin cellars, quest buildings) and whether you have been inside, NPCs, unsearched
  loot, dropped items (their own layer, as felling trees leaves many), storage (treasure chests, which stay after looting, your Hidden
  Hollows, the Camp stash and Clay's and Bhato's storage), camp items, rifts, large boulders and ruin rubble. Creatures, small rocks, trees,
  brambles, rift vines, sharp ground and a water overlay can be switched on. Click an explored entrance to see the inside, or a creature,
  NPC or your own marker to see hit points, attacks, a merchant's wares or your wellbeing and inventory.

Save processing happens in the browser tab. Files stay local unless you add a world to your library to sync or share it. Realistic mode and
the pictures in inspections load bundled art from the same site, never a third party. There is no world seed to type in — the game does not
have a reusable one (see below).

## Using it

Save and quit to the menu, then pick `…\steamapps\common\Mirklurk Every Step Matters\Saves\<character>` with **Open save folder**, drop that
folder on the page, or open a `.zip` of it. Picking the whole `Saves` folder offers a character list. `Player.save` alone also works; zone
maps and objects then stay empty.

Map controls: wheel, two-finger pinch, or `+`/`−` to zoom; drag to pan; `⟲` to reset; **World** to fit the whole 5×5 world. Pinching also
pans around the fingers' midpoint. Tap a marker to inspect it, or hover for its name and tile; click a list entry to find it on the map.
Touch gestures inside the map control the map, while outside it normal page scrolling and browser zoom remain available. Controls and panels
adapt to narrow phone screens.

The corner button above `+` shows the map full screen, the easiest way to use it on a phone. It stays full screen while you pan into other
zones, look inside entrances and come back, switch Realistic mode, or a live or shared save refreshes; the button, Escape or the browser's
Back return to the page. Full screen fills the whole window, landscape or portrait, showing more of the world along the longer side. The
zone's title, the way back from an interior and the shaded-area note float on the map, and tapping a marker opens its details in a card
beside it that follows it as you pan (×, Escape or a tap on empty map closes it). Browsers without a Fullscreen API for pages, such as
Safari on iPhone, get the same layout over the page.

Whenever the map is at least 600 pixels wide, and always in full screen, a translucent legend floats in its corner: each layer's map symbol,
tapped to show or hide it (a group's title switches the whole group), and Realistic mode. It mirrors the layer chips below the map, which
still offer everything, and collapses to its title; it starts collapsed on small screens.

The zone map continues into its neighbours, with their maps and the markers of the enabled layers (loaded as each zone first comes into
view). Pan into a neighbour and the selection follows: once it fills two thirds of the map along the way you are panning, the grid, the
title and the map's gold outline move to it, and its details open in place when you let go, keeping the view and any open inspection.
Peeking over a border, or hovering on one, never flips the selection back and forth. Zoomed out beyond about one and a half zones the map is
a survey and keeps the selection; zoom into a zone to select it, or click a neighbouring zone to jump to it.

### My worlds, sync and sharing (opt-in)

Expand **My worlds & sync**. Your browser keeps a private **library** of uploaded worlds: it is created and remembered automatically, and
its key is never shown. Open a save and click **Add _character_ to my worlds** to upload only the selected character. A world is identified
by its character name and zone layout, so adding a world that is already in your library **updates** it instead of adding a copy; the button
then reads **Update _character_ in my worlds**. While **Live saves** runs, **Keep it updated while Live saves runs** (on by default) sends
each settled change of a world that is already in your library, at most once every 30 seconds. Worlds you never added are never uploaded.

Each world has **Open**, **Share...** and **Delete**. **Open** follows it: the map refreshes every 30 seconds while the page is visible,
unchanged versions are not downloaded, and inspection state is kept unless **Follow saved location** moves to another area. A browser
reopens the world it followed last when nothing else is on screen, so a phone that syncs your library shows your latest world on its own.
**Delete** removes the world from every synced device and stops its share link; copies already downloaded cannot be revoked.

There are two kinds of link, each with its own key and QR code:

- **Sync another device...** is for your own devices. Scan the QR code with your phone, or open the link on another PC. After confirming
  (the prompt shows that library's name and worlds), that browser joins the same library: it sees, adds, updates and deletes the same
  worlds. If it already had a library with worlds (or a name), that library is kept under **Other libraries saved in this browser** to
  switch back to later. The link removes itself from the address bar. Anyone with it has full access to your library, and whoever made a
  sync link receives everything you add or update after joining it, so only use links you made on your own devices. Name the library (for
  example "Dante's PCs") to tell libraries apart.
- **Share...** on a world is for other people. It opens that one world read-only and follows its updates. A share key is derived one-way
  from the library key, so it can never be turned into a sync key; opening it does not change the viewer's own library. **Reset link** on
  the share card stops the old link working.

The server stores only hashes of library and share keys, never the keys themselves. Keys travel in `Authorization` headers, never in API
URLs, and links keep them in the URL fragment, which browsers do not send to the server. Clearing site data forgets the library on that
browser; sync it again from another device to get it back. Links from the earlier seven-day sharing system no longer work.

QR codes use the most compact encoding the link allows. A QR code can mix numeric (3.3 bits per digit), alphanumeric (5.5 bits per
character, capitals only) and byte (8 bits) segments, and the encoder picks the cheapest mix. Links therefore write keys as 78 digits (`#s=`
to sync, `#v=` to view), and QR codes spell the case-insensitive scheme and host in capitals (`HTTPS://MAP.MIRKLURK.DANTEB.COM/`). A sync or
share code is 33×33 modules instead of the 37×37 that the same link would need in byte mode, so each module prints larger and the code scans
more easily.

Limits:

| Limit           | Default                                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Worlds          | Five per library. Updating a world that is already in the library never counts; adding a sixth is refused                 |
| Retention       | A world is deleted 30 days after its last update                                                                          |
| Save package    | One character, 64 MiB including manifest, at most 4,096 files; uncompressed to avoid ZIP expansion attacks                |
| Updates         | At most once per 30 seconds per world; only one upload body processed at a time globally                                  |
| Per network     | Ten stored worlds, ten new worlds per rolling 24 hours (deleted ones count), ten named libraries; IPv6 /64s share a quota |
| API requests    | 60/minute per IP, plus nginx request/connection limits                                                                    |
| Storage         | 128 worlds and 1 GiB in total; 2,048 named libraries (clearing a name frees it)                                           |
| Upload duration | 60 seconds                                                                                                                |

Refusals are shown in the panel: a full library, a too-early update, an update of a world that was deleted on another device (it is not
quietly re-added), or an upload that claims to update a world but is a different world (the server recomputes the world from the uploaded
`Player.save` and changes nothing). Requests for expired worlds fail immediately; a minute-based sweep removes their files (or startup
cleanup after downtime). Salted IP hashes are stored instead of raw IP addresses, and daily quotas survive restarts. The in-memory
short-term request limiter resets on restart. Shared networks/NATs share the same quota. These are abuse guardrails, not protection against
a distributed attack; keep reverse-proxy bandwidth and resource limits in place. The package manifest is capped at 1 MiB, and `Player.save`
at 4 MiB before JSON parsing, to bound validation memory use.

### Live saves (opt-in)

Click **Live saves...** in desktop Chrome or Edge on HTTPS (or localhost), then grant **read-only** access to a character folder or the
whole `Saves` folder. The site polls every 1.5 seconds, discovers added/deleted files, and refreshes after writes have settled. Nothing is
uploaded, written to the game, or installed. **Stop live saves** stops polling and retains the last displayed snapshot. Opening a folder,
ZIP, or dropped save manually also stops monitoring. Access is requested again when restarting live mode; it is not stored across reloads.
Browsers without the directory picker retain manual import.

**This follows saved locations, not live movement.** The game saves before area transitions, on new-area generation, after normal sleep, at
some story checkpoints, and when saving to the menu. Because a transition save is written while you still stand at the border or door, live
mode (and following a world from your library or a share link) **estimates** where you went: a save within the travel strip at a zone edge,
or within 3 tiles of an entrance, way out or stairs, moves you to the spot the game puts you on the other side (see _Where you are_ below).
Estimates are labelled (est.), and hovering the person shows the basis and the true saved position. Manual imports, and stopping live saves,
always show the saved position only. **Follow saved location** selects the player's (estimated) zone/interior on refresh; turn it off to
keep inspecting another area. Zoom, inspection selection and expanded sections are retained on same-area refreshes. The snapshot label shows
`Player.save`'s timestamp when available; ZIP imports do not currently expose one.

The game writes a save over 19 game steps: player first, containers last. Live mode waits for at least 1.5 seconds of unchanged metadata,
checks that the current area's container file is at least as recent as the player file, validates newly read data, then rechecks the
directory before publishing immutable file contents. Interrupted writes or lost permissions leave the previous snapshot visible with an
error/retry notice. This is a best-effort coherent disk snapshot, not a game-provided atomic transaction. When monitoring several characters
together, an incomplete character save delays the folder snapshot; choose a single character folder to isolate it.

### Inventory, containers and wiki

Expand **Saved equipment & inventory** to see equipped items and nested bag contents, stack quantities, saved durability values (not
percentages), and wetness, under a roll-up of every coin you carry (see [the player](#creatures-merchants-and-you)). Click a
container/corpse/drop marker or list entry to inspect its saved contents. Reopened chests, empty containers, wood drops and separate
`LOOT-x_y.save` ground-loot records are included.

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

Item names, the titles of inspected markers and the zone's title (dotted like other links) open verified pages on `mirklurk.wiki` in a
separate tab; the lists under the map keep a **Wiki** link beside each name, since clicking the name finds it on the map. Unrolled loot
links to its source guide; entities without a dedicated known page use a relevant guide instead of a guessed article URL. The bundled
public-title catalog is verified at development time, not by sending save data to the wiki; pages can change after verification.

Inspecting a creature or NPC (or a carcass) shows the wiki's picture of it, NPCs as they look in the world, which matters because the map
only draws them as dots. Placed items such as Hidden Hollows and workstations, and Bhato's hideout, Gurb-Gurb's hut and Ihar's shipwreck,
show theirs too, and inventory rows show each item's icon. Treasure chests, remains and the Camp stash have no wiki picture yet. The
pictures are downloaded from the wiki at development time (`deno task wiki`) and bundled with the site; it never contacts the wiki itself.

**Realistic mode** is off by default; enable it with the **Realistic** toggle. It reconstructs explored zones and interiors from saved
`.tmap` layers using the game's own tilesets, including animated-tile first frames, atlas borders, mirroring and rotation. Buildings, rocks,
placed objects and procedural trees use their saved sprites/geometry. NPCs, creatures and carcasses remain markers; this is a static
daylight-like view, not a simulation of the game's lighting, weather, animation or camera-dependent roof fading. Layer chips control
informational markers, grouped as **Locations** (Places, Caves, Ruins, Rifts; indoor "Way out" exits always show), **Entities** (You, NPCs,
Creatures), **Items**, **Terrain** (including Water) and **Nature**; each group's header checkbox (and the master **All**) toggles all its
layers and shows a partial state when only some are on, and **Reset to defaults** restores the initial selection. They do not affect the
scenery baked into the realistic map. Switch **Realistic** off to return to the original overview.

Zoom in uses nearest-neighbour sampling at native resolution and above. Zoom out uses a mip pyramid built with successive 2×2 area averages,
followed by filtered resampling, so small details do not flicker or disappear as they do with nearest-neighbour reduction. Only four
full-resolution areas are retained, alongside small world previews. Switching realistic mode off cancels pending terrain work and releases
its caches; switching it back on rebuilds them. Unexplored or missing terrain is labelled rather than invented: import the full character
folder or ZIP for realistic terrain (`Player.save` or map PNGs alone are insufficient).

### Creatures, merchants and you

Click a living creature or NPC to see what the game's own examine card does, plus its saved hit points. **Hit points** draws the grid saved
in `Beings.save` square by square (armor layers, lost and burned points, poison stacks and bleeding with the way it spreads) and compares it
with a freshly spawned one ("Full health: 8 hit points, 4 armor; down 2 hit points and 2 armor"); a being saved without one shows that fresh
shape instead. **Attack** draws its attack pattern with each cell's damage ("2", or "1–2" for one to two) under a badge in the colour of its
damage class (Sharp, Blunt, Force, Piercing, Poison, Fire or Weak) with what that class does, then the total, its reach in tiles, its AP
cost and its intelligence for the save's difficulty. The Sceetler, Scaalmyr Geomancer, Scaal, Soldier, Magus Clay, Ranger Bhato and Wilda
also shoot, with another pattern, class and reach: a **Melee / Ranged** toggle switches between the two and stays on your choice for the
next being. **Behaviour** lists movement, hostility, dodge and attack-of-opportunity chances and the XP for the kill. Commander Tain and the
Dead Unwanted never attack, and NPCs and the Unwanted Guard never target you.

A merchant (Magus Clay, Ranger Bhato, Viend, Commander Tain, Gurb-Gurb or Ihar) leads with **Wares**, since you trade with them rather than
fight them: each ware's icon, its name linked to the wiki and the price of one in gold, silver and copper, in the order the game's trade
window lists them, with a note on when that merchant offers to trade. **How trading works** sums up the rules (see below), and their hit
points and attacks stay one click away under **Hit points and attacks**.

Click your own marker (**You**) to inspect your character as saved. **Hit points** draws your grid with burned and lost (wounded) hit
points, armor layers, poison stacks and bleeding, and says when new hit points from levelling up are not placed yet. **Wellbeing** shows
wellbeing and its four stats, Focus, Stamina, Satiation and Warmth (the game's word for body temperature; its bar marks the comfortable
40–60% band), each with what it does to wellbeing per turn, plus warm-to-the-core, well rested, sickness and overburdened bonuses or
penalties and the net change. **Conditions and level** lists the active effects (sickness, well rested, overburdened, shelter, tired and so
on) with turns left where the save records them, wet clothing, level, XP to the next level and unspent skill points. **Inventory** lists
equipped items and bag contents like a container, under a roll-up of every coin carried, bags included: **True coins** shows them as they
are, **Minimum coins** the same value in the fewest coins (100 copper make a silver, 10 silver a gold). The choice is kept for the session
and applies to every roll-up, including the one in **Saved equipment & inventory**. Everything is the state at save time; the game keeps
changing it every turn.

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
link to the wiki's _Tree health and chopping_ guide. **Trees, deadest first** lists the zone's trees (respecting the filter), and the
choices are kept across zones and characters.

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

**Hit-point grids** (`src/health.ts`). `Player.save` and each being in `Beings.save` store `hpgrid` and `statusgrid` row by row. In
`hpgrid`, −4 is no hit point, −1 burned (fire destroyed it; it cannot heal until treated), 0 lost, 1 healthy and 2–4 healthy under 1–3 armor
layers (`attack_lands` in `gml_GlobalScript_scr_basic_useful`, `hpcell_draw` in `gml_GlobalScript_scr_gui_general`). Each `statusgrid` cell
lists stacks: 2 is poison, 10–13 bleeding that spreads up, right, down or left once the hit point is lost, 23 stunned; the other values are
hit and miss flashes that fade within a second and are ignored.

**Creature stats and fresh hit points** (`src/bestiary.ts`). The numbers are `global.beingDB` (`gml_Object_databank_Alarm_3`), shown as the
examine card shows them (case 11 in `gml_Object_UI_Draw_64`): reach, movement and hostile distance in whole tiles, and a ranged attack only
when `rangedDist > 0`. A pattern cell `a.b` deals `a` to `b` damage (`floor` and `round(frac × 10)`, as `attack_draw` in
`gml_GlobalScript_scr_gui_general` prints it), and the total adds up every cell as the databank does. A being shoots only when you are out
of its melee reach, within range and in its line of sight; on Hard (`myDiff` 3 in `Player.save`) it aims one intelligence level better, up
to Highest; Sharp blows and High or better intelligence may land the pattern turned by quarter turns (`gml_Object_manager_area_Step_0`,
`being_get_attack_xy` in `gml_GlobalScript_scr_ai_related`). Each turn a being sees a target within its hostile distance it turns on it with
its hostility chance; team 0 (the NPCs, the Unwanted Guard and the Dead Unwanted) never picks you (`being_get_target`). A fresh being's grid
(`being_initiate` in `gml_GlobalScript_scr_basic_useful`) starts as all healthy hit points with the species' holes and extra layers
(Sceetler, Deathfly, Nightmare, Toadkin, Scaal by distance from its centre, Mirk Mauler, Wilda, Unwanted Guard), then its `armor` is laid
one layer at a time, row by row, on hit points with fewer than 3 layers; every unhurt being in the sampled saves matches it cell for cell.
The damage-class effects paraphrase `[TTgen]` in `UI.ini` and `attack_lands`.

**Merchants' wares** (`src/merchants.ts`). Every time you open a trade window the game stocks it afresh with one new, full-condition item of
each ware (`menu_add` in `gml_GlobalScript_scr_menu_related`), so wares never run out, then sorts them with `inventory_sort`
(`gml_GlobalScript_scr_basic_useful`): larger items first (width × height × 1,000), then cheaper ones, with arrows, medicine, camp gear,
repair kits, lamp oil and torches pushed back by their type. Commander Tain's Map Ledgers skip the sort. Equal ranks (Ihar's three 30-silver
two-handers) keep the stock order here; the game breaks such ties by grid position. Prices are the item database's, in silver
(`gml_Object_databank_Alarm_1`: a copper coin is 0.01, a silver 1 and a gold 10). The trade window (`gml_Object_UI_Draw_64`) charges exactly
that, with no markup, and pays the same price for your goods scaled by condition (`item_get_price` in `gml_GlobalScript_scr_items`:
durability left, at least 10%, or fuel left for light sources, at least 25%); quest items cannot be sold. Coins count at face value, the
trade goes through once your goods cover the cost, and the difference comes back in coins. When each merchant offers **Trade** comes from
the NPC dialogue options in `gml_Object_UI_Draw_64`: most in their everyday conversation, Viend only from main-quest stage 27, once Clay has
fled the fort.

**Wellbeing per turn** (`src/player.ts`). The circle bar (`gml_Object_UI_Draw_64`) shows `haelth` as wellbeing and `focus`, `energy`
(Stamina), `hunger` (Satiation) and `warmth` as percentages. `player_get_stat_changes` in `gml_GlobalScript_scr_basic_useful` scores each
stat against the thresholds in `gml_Room_rm_int_Create`: satiation, focus and stamina add 0.5%, 0.2% and 0.2% at 50% or more, and below 20%
take up to 1%, 0.5% and 0.5% (in proportion to how far below, the most at 0%); warmth costs nothing from 40% to 60% and up to 3% towards 0%
or 100%. Each is rounded to 0.1%. `player_get_combined_wellbeing` adds 1% each while warm to the core (`warmthTime`) and well rested
(`restedTime`), takes 1–3% for sickness I–III while `sickTime` lasts and 1% or 2% when very or extremely overburdened (aeList 25 or 26). The
end of a turn adds the sum to wellbeing, which stays between 0 and 100% (`gml_Object_obj_player_Step_1`); at 33% or less and falling the
game flags it as dangerously low (`gml_Object_obj_player_Step_0`). Temperature words are `temperature_get_label`
(`gml_GlobalScript_scr_map_and_weather`). XP to the next level is `xp_to_lvl`: ⌊28 × 1.2^level ÷ 5⌋ × 5, up to level 60, with a new hit
point every third level (`gml_Object_obj_player_Step_1`). Conditions are the saved `aeList`, indices into `UI.ini` [AEs], given short names
here. The coin roll-up counts every coin in your equipment and bags; **Minimum coins** converts by value as `item_draw_cost`
(`gml_GlobalScript_scr_items`) splits a price: 1 gold = 10 silver = 1,000 copper.

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
deno task wiki     # refresh src/wikidata.json and the bundled pictures (assets/wiki/, src/wikiart.json) from the public wiki; no saves or game data are sent
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
atomic-file store and quota lock are intentionally single-process, not a distributed database. Do not back up save payloads if the 30-day
retention promise must include backups. Upgrading from the seven-day sharing format deletes its old uploads on startup.

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
`set_real_ip_from 0.0.0.0/0`. Without this configuration all visitors behind the proxy share one per-network quota (safe but restrictive).
Verify two distinct external client IPs are accounted separately before enabling public uploads. API access logs are disabled in the bundled
nginx. Library and share keys are sent in `Authorization` headers, never in API URLs; do not log request headers in upstream proxies. The
default CSP now permits same-origin API connections only. Keep a disk quota on the volume and the example CPU/memory limits.

The homeserver (`dantebarbieri/homeserver`, service `mirklurk-map`) builds this repository from a pinned commit on `main`, so a release is:
push to `main`, wait for CI (`.github/workflows/ci.yml`: tests, then `tools/smoke.sh`, which builds the image and checks that contract),
then bump the pinned commit in the homeserver. Keep pinned commits on `main`, never rewrite them, and keep CI green: the server's nightly
update builds every service and stops at the first failure.

For a local check where Docker is available: `docker compose up --build -d` (http://127.0.0.1:8098) or `bash tools/smoke.sh`. The build
context is an allowlist (`.dockerignore`), so game files and saves cannot end up in the image.

Unofficial fan tool. Mirklurk and the game art are by Edym Pixels. Selected game art, including the pictures of creatures, NPCs, items and
quest buildings taken from mirklurk.wiki, is used on this site with the developer's permission; it remains the developer's copyrighted
material and is not relicensed as part of the viewer's source code.
