# MirkMap · Mirklurk World Viewer

**MirkMap** is a small browser-based viewer for **Mirklurk 0.8.1.5**, published at **https://map.mirklurk.danteb.com**. Open a character's
save folder and it shows:

- the 5×5 world with every zone under its in-game name (`UI.ini [LocTitles]`) and coordinate (`A,1`–`E,5`), each explored zone drawn with
  the map the game itself made for it (`Maps/x_y.png`);
- where **Fort Solid, Ranger Bhato, the Library, Scaal, Gurb-Gurb and Ihar** are — or, where the game has not placed them yet, where its own
  placement rules can still put them, with probabilities;
- per zone, from the saved objects: entrances (caves, ruin cellars, quest buildings) and whether you have been inside, NPCs, unsearched
  loot, dropped items (their own layer, as felling trees leaves many), storage (treasure chests, which stay after looting, your Hidden
  Hollows, the Camp stash and Clay's and Bhato's storage), camp items, rafts (placed ones, Raft Bases, and the one you stand on), rifts,
  large boulders and ruin rubble. Creatures, small rocks, trees, brambles, rift vines, sharp ground, a water overlay and gatherables
  (Calmia, Turnips, Cranberries, Watercress, Water Lilies, Vile Bulbs, bird nests and ferns) can be switched on. Click an explored entrance
  to see the inside, or a creature, NPC or your own marker to see hit points, attacks, a merchant's wares or your wellbeing, inventory and
  journal.

Save processing happens in the browser tab. Files stay local unless you add a world to your library to sync or share it. Realistic mode and
the pictures in inspections load bundled art from the same site, never a third party. There is no world seed to type in — the game does not
have a reusable one (see below).

MirkMap only reads saves. Its companion page, the [save editor](#save-editor), changes them; worlds it changed carry a permanent **C**
(Cheated) badge in MirkMap.

## Using it

Save and quit to the menu, then pick `…\steamapps\common\Mirklurk Every Step Matters\Saves\<character>` with **Open save folder**, drop that
folder on the page, or open a `.zip` of it. Picking the whole `Saves` folder offers a character list. `Player.save` alone also works; zone
maps and objects then stay empty.

Map controls: wheel, two-finger pinch, or `+`/`−` to zoom; drag to pan; `⟲` to reset; **World** to fit the whole 5×5 world. The crosshair
below them does the opposite and locates your character: it zooms in on them wherever they are, opening the interior they are inside (a
building, cave or dungeon level) or their zone, and their marker pulses a moment (it also turns the You layer back on). Pinching also pans
around the fingers' midpoint. Tap a marker to inspect it, or hover for its name and tile; click a list entry to find it on the map. Markers
keep their small size at any zoom, so a tap that misses every marker's symbol picks the nearest one within a fingertip's reach. Touch
gestures inside the map control the map, while outside it normal page scrolling and browser zoom remain available. Controls and panels adapt
to narrow phone screens.

The corner button above `+` shows the map full screen, the easiest way to use it on a phone. It stays full screen while you pan into other
zones, look inside entrances and come back, switch Realistic mode, or a live or shared save refreshes; the button, Escape or the browser's
Back return to the page. Full screen fills the whole window, landscape or portrait, showing more of the world along the longer side. The
zone's title, the way back from an interior and the shaded-area note float on the map, and tapping a marker opens its details in a card
beside it that follows it as you pan (×, Escape, Back or a tap on empty map closes it; the next Back leaves full screen). On a narrow
screen, such as a phone held upright, the details open instead in a sheet along the bottom of the screen, and the map glides to keep the
marker in sight above it, as it also does when you switch to full screen with details already open. Drag the sheet up by its grabber or its
contents to see more and down to close it (once its contents are scrolled to the top), or tap the grabber to switch between half and nearly
full height. Browsers without a Fullscreen API for pages, such as Safari on iPhone, get the same layout over the page; on Android, where
Back first leaves the browser's own full screen, that Back closes an open card and the map stays over the page.

Whenever the map is at least 600 pixels wide, and always in full screen, a translucent legend floats in its corner: each layer's map symbol,
tapped to show or hide it (a group's title switches the whole group), and Realistic mode. It mirrors the layer chips below the map, which
still offer everything, and collapses to its title; it starts collapsed on small screens.

The zone map continues into its neighbours, with their maps, the markers of the enabled layers and the ground overlays (brambles, rift
vines, sharp ground, water and ferns), each loaded as its zone first comes into view. Pan into a neighbour and the selection follows: once
it fills two thirds of the map along the way you are panning, the grid, the title and the map's gold outline move to it, and its details
open in place when you let go, keeping the view and any open inspection. Peeking over a border, or hovering on one, never flips the
selection back and forth. Zoomed out beyond about one and a half zones the map is a survey: it keeps the selection but hides the gold
outline; zoom into a zone to select it, or click a neighbouring zone to jump to it.

### My worlds, sync and sharing (opt-in)

Expand **My worlds & sync**. Your browser keeps a private **library** of uploaded worlds: it is created and remembered automatically, and
its key is never shown. Open a save and click **Add _character_ to my worlds** to upload only the selected character. A world is identified
by its character name and zone layout, so adding a world that is already in your library **updates** it instead of adding a copy; the button
then reads **Update _character_ in my worlds**. While **Live saves** runs, **Keep it updated while Live saves runs** (on by default) sends
each settled change of a world that is already in your library, at most once every 30 seconds. Worlds you never added are never uploaded.

Each world has **Open**, **Share...**, **Download** and **Delete**. **Open** follows it: the map refreshes every 30 seconds while the page
is visible, unchanged versions are not downloaded, and inspection state is kept unless **Follow saved location** moves to another area. A
browser reopens the world it followed last when nothing else is on screen, so a phone that syncs your library shows your latest world on its
own. **Delete** removes the world from every synced device and stops its share link; copies already downloaded cannot be revoked.
**Download** saves it as a save you can play (below).

There are two kinds of link, each with its own key and QR code:

- **Sync another device...** is for your own devices. Scan the QR code with your phone, or open the link on another PC. After confirming
  (the prompt shows that library's name and worlds), that browser joins the same library: it sees, adds, updates and deletes the same
  worlds. If it already had a library with worlds (or a name), that library is kept under **Other libraries saved in this browser** to
  switch back to later. The link removes itself from the address bar. Anyone with it has full access to your library, and whoever made a
  sync link receives everything you add or update after joining it, so only use links you made on your own devices. Name the library (for
  example "Dante's PCs") to tell libraries apart. The card also shows a **one-time sync code** such as `K7M2-9QXR`: type it under **Sync
  code or link** on the other device, which then joins after the same confirmation. That is the way into an app added to an iPhone's Home
  Screen, which keeps its own storage apart from Safari and never receives links (scanning the QR code opens Safari instead). A code works
  once, for 10 minutes, and stops when the card is closed; case, spaces and the dash don't matter, and O, I and L are read as 0, 1 and 1.
  The same box also takes a whole pasted sync or share link.
- **Share...** on a world is for other people. It opens that one world read-only and follows its updates. A share key is derived one-way
  from the library key, so it can never be turned into a sync key; opening it does not change the viewer's own library. **Reset link** on
  the share card stops the old link working.

The server stores only hashes of library and share keys, never the keys themselves. Keys travel in `Authorization` headers, never in API
URLs, and links keep them in the URL fragment, which browsers do not send to the server. A sync code never reaches the server either: the
browser showing it encrypts the sync key (AES-GCM) with a key derived from the code and uploads only that ciphertext under the code's
SHA-256 hash. The server keeps it in memory only, hands it out once to whoever sends that hash, and forgets it after 10 minutes, when the
card closes, when the library makes a new code, or on restart. Clearing site data forgets the library on that browser; sync it again from
another device to get it back. Links from the earlier seven-day sharing system no longer work.

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
| Save package    | One character, at most 4,096 files and 256 MiB including manifest; sent and stored gzip-compressed, at most 64 MiB        |
| Updates         | At most once per 30 seconds per world; only one upload body processed at a time globally                                  |
| Per network     | Ten stored worlds, ten new worlds per rolling 24 hours (deleted ones count), ten named libraries; IPv6 /64s share a quota |
| API requests    | 60/minute per IP, plus nginx request/connection limits                                                                    |
| Storage         | 128 worlds and 1 GiB in total; 2,048 named libraries (clearing a name frees it)                                           |
| Sync codes      | One open code per library, ten per network and 1,024 in total; 20 wrong codes per network per hour                        |
| Upload duration | 60 seconds                                                                                                                |

Refusals are shown in the panel: a full library, a too-early update, an update of a world that was deleted on another device (it is not
quietly re-added), or an upload that claims to update a world but is a different world (the server recomputes the world from the uploaded
`Player.save` and changes nothing). Requests for expired worlds fail immediately; a minute-based sweep removes their files (or startup
cleanup after downtime). Salted IP hashes are stored instead of raw IP addresses, and daily quotas survive restarts. The in-memory
short-term request limiter resets on restart. Shared networks/NATs share the same quota. These are abuse guardrails, not protection against
a distributed attack; keep reverse-proxy bandwidth and resource limits in place. The package manifest is capped at 1 MiB, and `Player.save`
at 4 MiB before JSON parsing, to bound validation memory use. A compressed package is inflated into a buffer of the size its gzip trailer
declares, refused above 256 MiB before inflating and rejected if the stream disagrees, so a small upload cannot expand without bound.
Packages from older clients, sent uncompressed, are still accepted up to 64 MiB.

### Downloading a world to play it

**Download** saves a world as a `.zip` you can play, for example to move a character between PCs. **Download save**, next to **Stop
following**, does the same for the world you are following or viewing from a share link (the version on screen). The ZIP holds the
character's folder, byte-for-byte as it was added: every `.save`, `.tmap`, `.ini` and map `.png` the game wrote, with their saved times, and
MirkMap's own `MirkMap.json`. Put that folder (for example `Hero`) into the game's `Saves` folder, so that `Saves\Hero\Player.save` exists,
and load it in the game. Open the ZIP in Explorer and drag the folder in, or use **Extract All...** with `Saves` itself as the destination
(Explorer suggests a new folder named after the ZIP). MirkMap can also open the ZIP directly with **Open .zip**.

The game names a character after its folder, so the folder is the character's name. If `Saves` already has a folder of that name, move the
old one out first: extracting over it would mix two versions, and files the newer save no longer has (the game deletes the file of an item
pile when you pick it up) would bring those items back.

A world downloaded from a **share link** is someone else's: its ZIP is named `Hero (From Share).zip` and keeps the folder name `Hero`.
Before it downloads, a dialog warns that putting it into a `Saves` folder that already has a character called Hero overwrites that
character; to keep both, rename one of the two folders first. **Download** goes ahead; **Cancel**, Escape or a click outside the dialog
backs out, and focus returns to **Download save**. The download carries `"fromShare": true` in a hidden `MirkMap.json` next to
`Player.save`, so MirkMap shows the world as **Hero (From Share)** with an **S** badge, both when the folder or ZIP is opened and in a
library it is added to. The game never reads, lists or removes that file, so it survives playing; delete it (or its `fromShare` entry) to
drop the badge. Downloads from your own library are not marked, but keep any `MirkMap.json` the world already had.

`MirkMap.json` is MirkMap's own notes about a world: one JSON object (UTF-8) that any MirkMap feature can add keys to, keeping the others.
It is JSON rather than INI because Chrome and Edge on Windows refuse `.ini` files in the File System Access API that Live saves and the save
editor use (Safe Browsing lists `.ini` as a dangerous file type there). Downloads give it the Windows hidden attribute, which Explorer
applies when extracting. Downloads are built in the browser from the package MirkMap already fetches to show the world, so they add no
server storage or new endpoint, and the server records only a `fromShare` flag (from the uploaded `MirkMap.json`, read again on every
upload) in the world's small metadata record. The ZIP is deflated to 12-18% of the world's size (a new character's 2 MB to about 250 KB, a
58 MB world to 8.5 MB, built in about a second), much as the gzip-compressed package it comes from.

### As an app, and offline

MirkMap can be installed: **Add to Home Screen** in Safari's share menu on iPhone or iPad, **Install app** / **Add to Home screen** in
Chrome or Edge (Android, Windows, macOS). It then opens in its own window under its own name and icon. After the first visit a service
worker keeps the page, its script and stylesheet, the save editor's page, the icons and all bundled game art (about 0.6 MiB), so MirkMap
opens at once and works without a connection: saves you open (folders, `.zip` files, Live saves) are read in the browser anyway, and
Realistic mode and inspection pictures come from that copy. Worlds in your library and shared worlds need the connection; while offline the
panel says so, and they come back when the connection does. Each new release replaces the kept copy as a whole, reusing unchanged art. Pages
always try the network first (waiting up to 3 seconds) so an online visit gets the newest release; the sharing API is never cached.

An app on an iPhone's Home Screen has its own storage, separate from Safari, so it needs its own library: use a sync code (above) to join
your library. Safari may clear a website's storage after seven days of use without a visit, but not a Home Screen app's; installed apps also
ask the browser to keep their storage.

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

### Time and weather

Under the summary line, three rows show the sky as saved. **Time**: the clock in your browser's own format (12- or 24-hour, as your locale
prefers), the game's own label for that hour (Dawn, Sunrise, Morning, Midday, Afternoon, Sunset, Dusk or Night) and the turns until the next
label and until Dusk (by day, when sleeping until sunrise becomes possible) or Sunrise (by night), the countdown the game's day-cycle dial
shows on hover. **Weather**: Clear, Cloudy, Light rain, Rain or Heavy rain, or Rain easing off / Clearing while rain fades out; the
temperature word from the game's thermometer; and the odds that it changes at the next hour, the only time it can. **Rain balance**: the
game's counter that keeps it from raining or staying dry for ever. After a dry spell clouds and rain come more readily, after a wet one rain
starts less often and stops sooner; a bar shows where it stands and which way it is moving, with the turns until it is even again if the
weather holds. On the full-screen map the zone's floating title adds the clock and weather icons. Icons were designed by Astra (GPT-6
Astra).

**Weather is global, not per zone.** The game keeps one clock and one sky for the whole world, saved once per character in `Player.save`;
where you stand only decides how much of it reaches you. Every zone of the 5×5 world is outdoors and gets the rain and its wetness. In the
fort, Bhato's hideout, Gurb-Gurb's hut and the shipwreck the light follows the day but no rain falls on you. Underground (caves, ruin
interiors and cellars, the Undercroft, the Library and Scaal's depths) the dial reads _Unknown Time_, no weather reaches you and the air is
always Cold. Everything is the state at save time; see _Time and weather_ below for the rules.

### Inventory, containers and wiki

Expand **Saved equipment & inventory** to see equipped items and what their bags hold, stack quantities and each item's condition as the
game's tooltip shows it: durability out of its maximum (portions left for bread, oil left for Lamp Oil), fuel for torches and lanterns
(turns of burning left out of a full one's) and wetness, with a quarter or less left highlighted. All of this sits under a roll-up of every
coin you carry (see [the player](#creatures-merchants-and-you)). Click a container/corpse/drop marker or list entry to inspect its saved
contents. Reopened chests, empty containers, wood drops and separate `LOOT-x_y.save` ground-loot records are included.

A bag kept inside another bag or a chest shows as empty, because that is how the game loads it: `load_player` and `load_containers` give
every such container a new, empty inventory (`item_recreate_grid`), and `save_player` refreshes only worn containers' grids. Its saved grid
is a leftover from when it was last worn, written as those items are now wherever they went, sometimes with `null` for one the game freed;
MirkMap ignores it, as the game does. The game itself only lets an empty container be put inside another (`item_fits`).

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
draws NPCs only as dots. Placed items such as Hidden Hollows and workstations, and Bhato's hideout, Gurb-Gurb's hut and Ihar's shipwreck,
show theirs too, and inventory rows show each item's icon. Treasure chests, remains and the Camp stash have no wiki picture yet. The
pictures are downloaded from the wiki at development time (`deno task wiki`) and bundled with the site; it never contacts the wiki itself.

Rafts use SVG symbols drawn by Astra (GPT-6 Astra) from the game's world sprite: the Raft Base's two lashed crossbars, and the finished
raft's log deck and paddle. The map, legend and list rows share these symbols. The raft you stand on peeks out below your person marker
without changing its saved tile. A finished raft has no inventory picture: its inspection shows frame 1 of the game's bundled
`spr_placed_16x16_wider` strip, credited to the game and Edym Pixels, rather than to the wiki. Raft Bases keep the wiki's picture. The game
strip is same-origin, content-hashed and kept offline with the other bundled art.

**Realistic mode** is off by default; enable it with the **Realistic** toggle. It reconstructs explored zones and interiors from saved
`.tmap` layers using the game's own tilesets, including animated-tile first frames, atlas borders, mirroring and rotation. Buildings, rocks,
placed objects and procedural trees use their saved sprites/geometry. NPCs, creatures and carcasses remain markers; this is a static
daylight-like view, not a simulation of the game's lighting, weather, animation or camera-dependent roof fading. Layer chips control
informational markers, grouped as **Locations** (Places, Caves, Ruins, Rifts; indoor "Way out" exits always show), **Entities** (You, NPCs,
Creatures), **Items** (Loot, Dropped items, Camp, Storage, Rafts), **Terrain** (including Water), **Nature** and **Gatherables**; each
group's header checkbox (and the master **All**) toggles all its layers and shows a partial state when only some are on, and **Reset to
defaults** restores the initial selection. They do not affect the scenery baked into the realistic map, which draws the gatherable plants
too. Switch **Realistic** off to return to the original overview.

Zoom in uses nearest-neighbour sampling at native resolution and above. Zoom out uses a mip pyramid built with successive 2×2 area averages,
followed by filtered resampling, so small details do not flicker or disappear as they do with nearest-neighbour reduction. Only four
full-resolution areas are retained, alongside small world previews. Switching realistic mode off cancels pending terrain work and releases
its caches; switching it back on rebuilds them. Unexplored or missing terrain is labelled rather than invented: import the full character
folder or ZIP for realistic terrain (`Player.save` or map PNGs alone are insufficient).

### Creatures, merchants and you

Switch on **Creatures** to draw each living creature as a small red silhouette of its kind: flies (Dreadfly, Giant Gnat, Deathfly), the
Firelouse, the Sceetler, crabs (Boulder and Titanspine Crab), the Nightmare, snakes (Mire Serpent, Viper, Red Fang), the Giant Slug, fish
(Mudfin, Razorfin), rats (Mirk Runner, Mirk Mauler), trolls (Swamp and Cave Troll), the Toadkin, the Scaalmyr (Grunt, Warrior, Geomancer),
the Scaal and the Unwanted (Raving and Mutated). Kinds that look alike in the game share a shape, so hover or tap one for its exact name.
Map markers, the legend and the **Creatures when saved** list share the same hand-drawn shapes; NPCs keep their gold dot, and so do the rest
of their team, who never target you: the Dead Unwanted (Viend before he is revived) and the Unwanted Guard.

Click a living creature or NPC to see what the game's own examine card does, plus its saved hit points. **Hit points** draws the grid saved
in `Beings.save` square by square (armor as a bronze, silver or gold shield, larger for each of 1–3 layers; lost and burned points, poison
stacks and bleeding with the way it spreads) and compares it with a freshly spawned one ("Full health: 8 hit points, 4 armor; down 2 hit
points and 2 armor"); a being saved without one shows that fresh shape instead. **Attack** draws its attack pattern with each cell's damage
("2", or "1–2" for one to two) under a badge in the colour of its damage class (Sharp, Blunt, Force, Piercing, Poison, Fire or Weak) with
what that class does, then the total, its reach in tiles, its AP cost and its intelligence for the save's difficulty. The Sceetler, Scaalmyr
Geomancer, Scaal, Soldier, Magus Clay, Ranger Bhato and Wilda also shoot, with another pattern, class and reach: a **Melee / Ranged** toggle
switches between the two and stays on your choice for the next being. **Behaviour** lists movement, hostility, dodge and
attack-of-opportunity chances and the XP for the kill. Commander Tain and the Dead Unwanted never attack, and NPCs and the Unwanted Guard
never target you.

A merchant (Magus Clay, Ranger Bhato, Viend, Commander Tain, Gurb-Gurb or Ihar) leads with **Wares**, since you trade with them rather than
fight them: each ware's icon, its name linked to the wiki and the price of one in gold, silver and copper, in the order the game's trade
window lists them, with a note on when that merchant offers to trade. **How trading works** sums up the rules (see below), and their hit
points and attacks stay one click away under **Hit points and attacks**.

Click your own marker (**You**) to inspect your character as saved. While you are inside a building, cave or ruin, your marker sits on its
entrance (labelled below it so the building's name stays readable) and leads inside, where clicking it inspects you. **Hit points** draws
your grid with burned and lost (wounded) hit points, armor layers, poison stacks and bleeding, and says when new hit points from levelling
up are not placed yet. Under it, **Armor** totals your equipment's armor as the game's equipment screen does and says how many armor points
you will distribute on your hit points when the next combat starts (the total rounded down, at most 3 layers on each living hit point), with
**Armor by item** showing what each worn piece gives at its current durability. **Wellbeing** shows wellbeing and its four stats, Focus,
Stamina, Satiation and Warmth (the game's word for body temperature; its bar marks the comfortable 40–60% band), each with what it does to
wellbeing per turn, plus warm-to-the-core, well rested, sickness and overburdened bonuses or penalties and the net change. **Conditions and
level** lists the active effects (sickness, well fed, well rested, stamina boost, overburdened, shelter, tired and so on) with turns left
where the save records them, wet clothing, level, XP to the next level and unspent skill points. **Inventory** lists equipped items and bag
contents like a container, each worn or held item marked **E** (with its slot on hover; dashed for the weapon set not in hand, since worn
vests, pants and belts have pockets too), under a roll-up of every coin carried, bags included: **True coins** shows them as they are,
**Minimum coins** the same value in the fewest coins (100 copper make a silver, 10 silver a gold). The choice is kept for the session and
applies to every roll-up, including the one in **Saved equipment & inventory**. **Journal** shows your journal (see below). Everything is
the state at save time; the game keeps changing it every turn.

### Journal

Expand **Journal** under the map, or inspect yourself, to read your character's journal as the game lists it after loading the save, in the
game's own words. The newest entry, the one the game opens the journal on, comes first, and **Earlier entries** lists the rest from Entry 1.
MirkMap adds a short title to each entry (the game shows only "Entry 12"), and the panel's title names the newest entry, so it shows your
progress even when closed. Where the game fills in a place, MirkMap fills it in the same way: the direction of Bhato's zone from Fort Solid
in the entry that sends you to him, and the map coordinates of the Library's and Scaal's zones in the entries that send you there. Only
entries you have reached are shown; the wiki's _Quests and journal_ link covers the rest of the story, spoilers included.

The people and places an entry mentions are links that show them on the map, as clicking them in the lists under the map does: Captain Eir,
Magus Clay, Ranger Bhato, Viend, the commander (Commander Tain) and Scaal; Fort Solid, the Camp, your ship, the Undercroft, Bhato's zone and
hideout, the ruin cellar, the Library and its zone, Scaal's zone or lair and its depths, and the rift beside the Camp, where Clay's rift
samples come from. A link opens the zone centred on the marker, or the interior it is in, and inspects it, switching its layer on if needed.
Someone the save has no trace of (Clay after he disappears, Scaal before you reach him) leads to where they live, a place not entered yet to
its entrance, and a building not placed yet to its zone. In the save editor, the preview's links open the **Full map** there.

The game keeps no journal text in the save, only the main quest's stage (`mainQ` in `Player.save`), and rebuilds the journal from it on
loading (`journal_update` in `gml_GlobalScript_scr_basic_useful`). Entry 1 is the same for everyone (`UI.ini [Journal] First`), and each
stage from 0 up to the saved one adds the entry `[Journal]` has for it. Stages −10 to −6 are the opening tutorial and −5 means it is over or
was skipped, so the journal holds only Entry 1 until stage 0. Stages 14 (Viend reaches Captain Eir), 21 and 22 (the talk with Commander Tain
and the blast that ends it) and 27 (Eir hands over the Summoning Stone) have no text, so they add no entry; MirkMap says what such a stage
means under the newest entry. The journal's text is copied from `UI.ini` into `src/gamedata.ts` by `tools/gamedata.ts` (see
[Development](#development)), with the developer's permission. The save editor's preview and its **Full map** show the same journal, which
edits do not change.

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

### Gatherables

The **Gatherables** layers mark what you can pick or search for food and crafting, each kind with its own small symbol in the colours of
what it gives: **Calmia** (pink flowers over an orange root; Calmia Root), **Turnips**, **Cranberries** (red berries on a teal shrub; young
shrubs without berries are drawn bare), **Watercress** and **Water Lilies** (only flowering lilypads give lilies) in shallow water, **Vile
Bulbs** (Mushrooms), which grow only in caves, and **Bird nests** (Feathers and Eggs; a searched nest is drawn empty). Each plant is one
marker on its tile. Hovering one shows what harvesting it gives at its growth stage, such as "Cranberries x3–8 (grown)"; clicking it adds
the item's picture, how the amount grows over the plant's five stages, how the kind comes back, and a link to the wiki's _Plant harvesting_
guide. Lists under the map give each shown kind, the most to take first. Plants you harvested but did not empty say so: the game keeps what
you left on the ground (the **Ground loot** marker on the same tile), and harvesting again gives you that instead of a new roll. A searched
nest shows about how many days are left until it refills.

**Ferns** (Plant Fiber) grow on hundreds of tiles in every zone, so instead of markers that layer shades the ground they cover, green and
deeper the bigger the fern: one harvest gives 1–2 fibers from the smallest up to 5–14 from the biggest. Like Sharp ground, it shades the
selected zone only.

Mirklurk 0.8.1.5 has no tomatoes. Bramble Berries, Riftvine Berries and Elderwort Berries are not picked from the ground: they fall, by
chance, from the stems you cut on the **Brambles**, **Rift Vines** and Elderwort Shrubs (**Trees**). The layers show the plants as saved;
they keep growing, spreading and dying back as turns pass and when you come back to a zone.

## Save editor

**MirkMap Editor**, at `/edit/` (https://map.mirklurk.danteb.com/edit/, linked as **Save editor** from the map), changes a character's save
files. It is a separate page built from the same code as the map, which itself never writes your files. It needs desktop Chrome or Edge,
which can write to a folder you choose. Save and quit to the game's main menu, and stay at the menu until you have saved your edits: the
game keeps your character in memory and would overwrite them. **Open save folder for editing...** asks for write access to a character
folder or the whole `Saves` folder. Nothing is uploaded.

**Edit this character...** first explains that saving any edit marks the world as **Cheated, permanently**, and edit mode starts only once
you confirm. Each edit is written the way the game itself writes it (decompiled entries in brackets):

- **Level**: each level-up grants a skill point, and every third level a hit point to place (`obj_player` Step_1), so changing the level
  grants or takes back unspent ones (never below zero), and XP stays under the new level's threshold.
- **Skill points** to spend, and **new hit points** to place.
- **Hit points and their statuses**: your grid, as the preview draws it, where clicking a hit point picks it to set its **poison** and
  **bleeding** stacks and the way the bleed spreads, as `attack_lands` leaves them: one `statusgrid` entry per stack, a cell's bleeding all
  spreading one way. Only living hit points take them (healthy, armored or not), as in the game; lost and burned ones are greyed out. At the
  end of each turn `delayed_effects_check` takes a poisoned or bleeding hit point, armor or not, and moves its other stacks on: poison to a
  random living neighbour, bleeding to the next hit point its way. **Stun** makes you miss your next turn (`apply_stunned` puts it on the
  grid's first cell; the turn's end takes it away), and **Remove stun** takes it off. **Heal all wounds** heals lost and burned hit points
  and clears poison, bleeding and stun; armor stays.
- **Conditions**: **Sickness** None, I, II or III and its turns, and the turns left of **Warm to the core**, **Well fed**, **Well rested**
  and **Stamina boost**; 0 turns removes one. Each is written as the game gives it: its `aeList` entry (`UI.ini` [AEs] 17–22 and 29) with
  its timer (`sickTime`, `warmthTime`, `fedTime`, `restedTime`, `staminaBoostTime`), which `player_endturn` counts down by one a turn,
  dropping the entry at 0. A new sickness level replaces the old one as `player_get_sickness` does, and curing sickness clears `sickTime`
  too: the game reads a `sickTime` left without a level as a 16% wellbeing gain each turn. Warm to the core, well fed and well rested go up
  to 35 turns (`global.COREMAX`, `FEDMAX`, `RESTEDMAX`; 36 for warm to the core, as a hot drink leaves it); sickness and stamina boosts add
  up without a cap, so the editor stops at 999. Only the ones you change are written. Tiredness, overburdening, wading, shelter and the
  other conditions are left out: the game sets them again every step from your stats, load and surroundings. **Wet clothes** says what is
  wet, with the same **Dry all** as under Items.
- **Wellbeing, satiation, focus, stamina and temperature**: each value and the target it eases towards. The game recomputes wellbeing from
  its 25×25 wellbeing grid every second (`obj_player` Step_0), so every cell of that grid is set as well.
- **Time and weather**: day, time, Clear, Cloudy or Rain with its strength, and air temperature; only the ones you change are written. Cloud
  and rain are written as `player_endturn` leaves them, and days alive move with the day. The game eases the air temperature back toward the
  hour's usual value, and going back in time stops regrowth in zones visited later until the clock catches up.
- **Items and coins**: added to the bags you carry exactly as picking them up would (`item_pickup`, `item_stack`, `item_add`). Stacks are
  topped up first, then each new stack goes in the first free spot, column by column, written in every cell it covers. What finds no room
  upright anywhere is then turned sideways (`sideflipped`, covering height × width), as you could turn it in the game; nothing already in
  your bags is rearranged. New items glow gold in the game until you look at them. Whatever does not fit is reported, never dropped. Sizes,
  stack limits and durability come from the game's item database (`src/itemdata.ts`). Every item you can carry can be added, including ones
  the game keeps out of random treasure (`NONLOOTABLE`): quest items, seeds, Water Lilies and things you place, such as a Campfire or a Raft
  Base (place it in deep water, then finish the raft at it). Only Unarmed (your bare hands) and Finish Raft (the recipe that turns a placed
  Raft Base into the raft, never an item) are left out.
- **Removing items**: **What you wear and carry** lists every worn item by slot, with what its containers hold, and each container's size
  and free cells (a bag kept inside another holds nothing, as above). **Remove** takes all of an item, or as many of a stack as you say, out
  of the save: every grid cell it covered is emptied, every copy of the containers it was in is kept the same (the game saves a copy of an
  item in each cell it covers), and a two-handed weapon's off-hand copy goes with it. A container takes its contents with it, after asking.
  Items unsaved changes added or changed are tagged **unsaved**.
- **Moving and wearing items**: **Wear it** puts a new item on instead of in a bag, so a character with no bag (a new one, or one whose gear
  was removed) can put on a backpack, vest or pouch and then carry things. **Move to** beside an item lists only the containers you wear
  that have room for it (its first free spot, column by column as `item_add` scans, upright first, then turned sideways) and a free slot it
  fits; a worn item can be taken off into one of them. A container moves only when empty, and never into itself, as `item_fits` allows: the
  game would empty it otherwise. So to swap a small backpack for a large one, move what it holds into another bag you wear, remove it, and
  put the large one on with **Wear it**. Each slot takes what the game lets into it (`takes` in `gml_Object_obj_player_Create_0`,
  `item_fits_slot`): main hands take weapons (types 16, 17 and 23), off hands types 15, 23 and 24, and the rest their own type; a two-handed
  melee weapon (type 17 that is not a bow, `weapon_is_ranged`) also needs the off hand beside it and is saved there too. The game rebuilds
  worn containers, weights and looks from the save when it loads.
- **Durability, fuel and wetness**: every item in **What you wear and carry** shows its condition, current and maximum (see _Item condition_
  below). **Repair all** sets every worn or carried item's durability to its maximum, as repair kits do; food portions and lamp oil are used
  up rather than worn, so they stay. **Refuel all** fills every torch's and lantern's burn time and every Lamp Oil flask. **Dry all** dries
  every item and the clothes on your body (`wetness`, which the preview lists as wet clothes). Each says how many items it would change, and
  is greyed out when none. **Condition…** beside an item sets its durability, fuel or wetness to any value the game allows, lower too:
  durability, portions and oil above 0, since the game breaks or uses up an item at 0 (`item_durloss`, `items_bonus_apply`), fuel from 0 (a
  lit torch or lantern at 0 goes out, as one that burns down does), and wetness only on items that can get wet. Every copy the save keeps of
  the item (each cell it covers, a two-handed weapon's off-hand copy) changes with it.
- **Where you stand**: a tile of a zone or interior you have explored that is not a wall, a pit or something already standing there (a
  creature, a placed raft), picked on the area's map or on the full map. Ground moves you at once. Water and rafts ask first, never refuse:
  - The question says how deep the water is (`tile_get_height`): shallow, chest-deep, or deep, where you swim, using stamina every turn, and
    drown once it runs out (`player_set_ae_water`). Pointing at a tile on the zone's map says so too, and whether a raft floats there
    (`rafting_possible_here`: the ground below the water threshold, no reeds or low hinderances).
  - Off a raft, into water a raft floats on: **Bring your raft** (the nearest one you left, taken out of its zone), **Make a raft there**,
    or **Go without a raft**. Into shallower water: **Go into the water**.
  - On your raft, into water it floats on: **Bring your raft**, or **Leave your raft here** and go without it.
  - On your raft, onto land or into shallows: **Dock your raft at that shore**, or **Leave your raft where it is**. Docking moves it
    straight towards you, over any other island and its shallows (only dry ground, joined side by side or corner to corner, makes your
    land), until its way first reaches your land, and puts it on the nearest free raft water reached through the water from there, so it
    never ends up on the far side of your land.

  The game saves the raft you stand on with you, not with its zone (`ensureRaft` in `Player.save`; `player_raft_ensure` makes it under you
  on load), so bringing it only keeps that flag. A raft you leave or dock is written to that zone's `Stations.save` as Finish Raft leaves it
  (station 171), and one you bring from a zone is taken out of it. A move that changes several files is one change: the bar lists it as one
  line, and Undo, or a reload where it no longer applies (you are on a raft now, or no longer where you left it), takes all of it back.

  Moving inside a cave, ruin cellar, quest room or Scaal's depths, or into one, works the same way, without rafts: a raft never goes inside,
  so from your raft you leave it where it is (or, where it cannot stay, lose it). The game names the area you are in by `areaX`/`areaY`,
  `areaType` and the entrance it was entered by (`entranceX`/`entranceY`), and loads the folder `[ x,y,ex,ey ]` they name, or `RW1`–`RW3`
  for Scaal's depths by type alone (`savearea` in `gml_GlobalScript_scr_saveload`); a move inside writes all of them, taking the type from
  the entrance or stairs leading there (their `transPoint`), or your saved one when you are already inside. An interior no saved entrance or
  stairs lead to any more (the Fort interior and Undercroft once Fort Solid is gone) has only a guessed type, so you can move inside it only
  when you are already there. Inside, only the floor that its way out (and any stairs) can be walked to from, past walls and pits, is
  offered: quest rooms stand in open ground the game never lets you reach. The game loads an area only when its folder has `Ygrid.save`
  (`manager_area` Alarm_2) and makes a new one otherwise, so an area without it is refused. Arriving this way is not walking in: what the
  game does on entering through a door (quest steps on reaching the Library or Scaal's depths, regrowth since your last visit) waits for the
  next time you do.
- **Creatures**: spawn any creature except quest characters on a free tile of a zone or interior where it can live, with the hit points and
  armor of a fresh one, or remove creatures. Removing a quest character (NPCs, the Dead Unwanted who becomes Viend, and Scaal) asks first.
  Where a creature can live is the game's own rule (`tile_meets_classneeds`), which it checks wherever a creature spawns or moves. It also
  checks it whenever you enter an area other than straight from the menu: it then moves each creature to a random tile within 8 that suits
  it, and removes one that finds none. Flyers (Dreadfly, Giant Gnat, Deathfly) go anywhere. Swimmers need water: a Mire Serpent where the
  ground (`Ygrid.save`) lies at or below the water threshold (−0.3), a Mudfin or Razorfin below −0.25. Walkers wade, but not where the
  ground lies at or below −0.4 (−0.3 for small ones such as a Mirk Runner, `size` 0), unless reeds or a raised floor lift them out of the
  water. A Giant Slug keeps out of the second water layer, and only flyers go on brambles, sharp ground or rift vines. The creature list
  marks swimmers and flyers. With the Spawn tool, tiles the chosen creature cannot use are darkened, and pointing at one says why. The
  game's wildlife spawner puts Mudfins on any water, so some saved ones sit in shallows too shallow for them until they move.

**Full map**, beside **Editor** at the top, shows the character in MirkMap's own map, as saving would leave it: every zone, caves and
interiors, rifts, landmarks, NPCs and creatures, loot, the layer switches and Realistic mode, before or during edit mode. In edit mode,
**Move yourself** makes the next click on ground or water in an explored zone or interior move you there, with the same checks and questions
as the area's map in the editor; it then turns itself off (Escape turns it off too, and cancelling a question keeps it on). Switching back
to **Editor** opens the zone or interior the map was showing.

Edits stay in the tab, shown in the map's own player inspection as they will be saved, until **Save to game files**. The bar at the bottom
lists them; **Undo** beside one takes back just that change. The later changes to the same file run again on the file as it was read (each
edit is kept as a step that can be replayed, its line written anew), and any that no longer applies, such as removing a creature whose spawn
was undone, is dropped and named. **Discard changes** drops them all. Saving refuses if the game wrote the folder since it was read. It
keeps the files it replaces in this browser (the last 10 saves of each world; **Restore** writes them back), then writes the Cheated mark
first, `Player.save`, the other changed files and the current area's `Containers.save` last, in the game's own order, so Live saves accepts
the result.

The page can stay open while you play. Save and quit to the game's menu, then choose **Reload save** (at the top, in edit mode): it reads
the whole folder again (the character, its world and zone maps, creatures and the Cheated mark) and runs the unsaved changes again on the
newest save, in order, the same way Undo replays them, so they can be saved. Each change keeps what you asked for (skill points set to 5, 10
arrows added, the weather made Clear) and its line is written anew from the new save (`Skill points 2 → 5`). A change that now does nothing,
such as wellbeing set to 100% when the game already has it there, or that no longer applies, such as removing a creature that has since
moved or an item you dropped in the game, is dropped and named. Wellbeing and stats, and time and weather, change only the values you
changed, so a reload keeps the game's newer clock and stats. If the folder now holds a different world for that character, loading it drops
the unsaved changes, after asking.

### The Cheated mark

- `MirkMap.json` in the character folder gets `"cheated": { "since": …, "edits": … }` (the first saved edit's time and the number of saved
  edits), next to MirkMap's other notes such as `fromShare`. The game never reads or removes it, and uploads include it.
- This browser remembers every world it saved edits to, so the map still shows the mark if the file is removed, and puts it back into the
  world when it is added to your library.
- The upload server remembers, for good, each library world that was ever uploaded with the mark (`cheated.json` beside the stored worlds,
  not subject to the 30-day retention). A later upload of it without `MirkMap.json` gets the file back before it is stored, so every synced
  copy, share and download carries it. Another library's copy of the same world is its own, so someone who edits a world downloaded from
  your share link marks only their copy.
- MirkMap shows the world with a **C** badge and "(Cheated)" after its name, both for the open world and in **My worlds**.

Restoring a backup undoes edits, not the mark. On a computer that never saved edits to a world and never uploaded it, deleting
`MirkMap.json` does remove the mark; everywhere else it stays.

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

**Gatherables** (`src/gather.ts`). They are tiles of the saved `Hinderance` layer, which `tile_is_harvestable`
(`gml_GlobalScript_scr_tiles_autotiling`) and `tile_to_enum` (`gml_GlobalScript_scr_tiles_finders`) read: 147 Calmia, 148 Vile Bulb, 150–159
Turnip and 170–179 Watercress (two looks of five growth stages each), 160–164 Cranberry, the flowering lilypads 73–74 and 78–79, and bird
nests, 146 full and 145 searched; ferns are 80–89. Harvesting rolls `loot_generate` (`gml_GlobalScript_scr_items`): Calmia Root 1–3, Vile
Bulbs 1–2, one Turnip or two from stage 4, Cranberries `(n, 2n)` with n = 2, 3 or 4 from stage 3 (none before), Watercress
`(n, round(1.5n))` with n = stage (rounded half to even), Plant Fiber `(n, 2n)` with n = the fern's stage, one or two Water Lilies at stages
4 and 5, and from a nest 1–7 Feathers with a 40% chance of 1–3 Eggs. Ranges are `loot_amountchances(a, b)`, which picks one of `a…a`,
`a…a+1`, …, `a…a+b−1`, so `a` to `a+b−1` with low counts likelier; Green Fingers adds one with a chance. Picking everything clears the tile;
leaving some sets `LootData` 99 and saves the rest to `LOOT-x_y.save` (`gml_GlobalScript_scr_menu_related`). Emptying a nest turns it into
145 with `LootData` 4–12, days that count down each midnight and by the days you were away, after which it refills
(`gml_Object_manager_area_Step_0`). New zones other than the Rift Mire get 8–32 Calmia, 5–13 Turnips and 10–26 Cranberry plants spread into
patches, by area type, and every new zone up to 320 fern patches of 8–64 steps each (64 in the Rift Mire, 196 in the Withered Mire)
(`gml_Object_manager_area_Alarm_2`); on each return two Calmia sprout outdoors (again not in the Rift Mire), and one Vile Bulb in a cave,
per day or part of a day you were away (`gml_Object_obj_screenfader_Step_0`), and plants grow and spread with every turn's growth ticks
(`nature_grow` in `gml_GlobalScript_scr_nature`).

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
here; sickness I–III, warm to the core, well fed, well rested and stamina boost show the turns left on their saved timers, as their icons do
(`gml_Object_UI_Draw_64`). The coin roll-up counts every coin in your equipment and bags; **Minimum coins** converts by value as
`item_draw_cost` (`gml_GlobalScript_scr_items`) splits a price: 1 gold = 10 silver = 1,000 copper.

**Time and weather** (`src/weather.ts`). `manager_day` holds one clock and one sky for the whole world; `Player.save` stores them as
`MDminute`, `MDday`, `MDtemperature`, `MDweather`, `MDcloud`, `MDrain` and `MDrainBalance` (`gml_GlobalScript_scr_saveload`), with no zone
of their own. Every turn `player_endturn` (`gml_GlobalScript_scr_basic_useful`) adds 8 minutes; a new game starts at 07:00
(`gml_Object_manager_day_Create_0`), and at hour 24 `gml_Object_manager_day_Step_0` sets the minute to 0 and starts a new day, dropping day
1's leftover 4 minutes, so from day 2 every minute is a multiple of 8. The labels are the dial tooltip's (`gml_Object_UI_Draw_64`,
`UI.ini [Time]`): Dawn from 04:00, Sunrise 06:00, Morning 08:00, Midday 11:00, Afternoon 14:00, Sunset 17:00, Dusk 20:00 and Night 22:00, or
_Unknown Time_ in `area_is_dungeonlike` areas. Its countdown is to Dusk from 06:00 to 20:00 and to Sunrise otherwise; the game rounds
minutes ÷ 8 down, so on day 1 it reads one turn short, and the viewer counts the turns it really takes. "Sleep until Sunrise" is offered
from 20:00 to 06:00 (`gml_GlobalScript_scr_menu_related`). `localWeather` is 0 clear, 1 cloudy or 2 rain, with `cloudPower` 1 while cloudy
or raining. Each turn the rain balance rises by 1/180 while `rainPower > 0` and falls by 1/360 otherwise, within −1…1, so it settles where
about a third of turns are rainy. Only when the hour ticks over may the weather change, with `b` that balance: Clear turns Cloudy with
max(2%, 12% × (1 − b)); Cloudy clears with max(2%, 10% × (1 + b)), else rain starts with max(2%, 30% × (1 − b)) at a strength of 0.08–1
(never while `daysAlive` is under 2 on Easy or Medium); Rain eases back to Cloudy with max(1%, 25% × (1 + b)), else clears at once with
max(1%, 5% × (1 + b)), else its strength drifts by up to ±0.1. Leaving Rain fades the rain out over a few turns (`rainFadePower`, which is
not saved: a save made mid-fade keeps that drizzle until the weather next changes). The odds shown use the balance as it will be at that
hour's turn. Rain is called light up to 0.2 (the soft rain sound) and heavy from 0.725 (the largest splashes,
`gml_Object_manager_day_Step_0`). Rain only wets you, and your containers' contents, in `area_is_outside` areas (`player_rained_upon`,
`gml_Object_obj_container_Alarm_1`; `gml_GlobalScript_scr_map_and_weather`); the temperature word is `temperature_get_label` on
`MDtemperature`, and the thermometer's colour is the game's frame `floor(6.99 × temperature)`; underground the air is always 0.35, Cold
(`player_gets_all_wet`).

**Armor and equipment** (`src/armor.ts`). `Player.save` lists the 16 equipment slots of `myEquips` in order (two weapon sets of main and off
hand, then helmet, hood, shirt, vest, backpack, belt, pants, leg armor, gloves, cloak, socks and footwear;
`gml_Object_obj_player_Create_0`), with `actives` naming the weapon set in hand. A two-handed melee weapon is saved in its off-hand slot as
well and the loader skips that copy, so the viewer drops it too. `player_update_gearstats` (`gml_GlobalScript_scr_basic_useful`) adds up the
`armor` of every slot's item, both weapon sets included, each scaled by durability left and rounded to 0.01 (`item_durfix_value` in
`gml_GlobalScript_scr_items`), and rounds the total to 0.1: the **Total Armor** of the equipment screen. When combat starts,
`player_real_combat_check` gives `min(floor(totalArmor), being_get_armor_max)` armor points to distribute, the cap being 3 layers on each
living hit point (`gml_GlobalScript_scr_ai_related`); when it ends, the layers are removed. Armor values and maximum durability are the item
database's (`gml_Object_databank_Alarm_1`).

**Item condition** (`src/condition.ts`). An item's tooltip (`item_draw_info` in `gml_GlobalScript_scr_items`) shows its saved `durability`
out of the item database's `durabilityMax` when that is over 1, except on materials, coins, gems and quest items (types 14, 25 and 26): as
_Portions left_ for food, medicine and remedies (types 19, 20 and 13; only the Loaf of Bread has more than one), as _Oil left_ for Lamp Oil,
else as _Durability_. A new item starts full (the `item` constructor), and one not saved counts as full. Torches and lanterns
(`item_is_lightsource`) also keep `burnTimeLeft`, the turns they burn while lit, which starts at the database's `burnTime`; a Lamp Oil flask
pours up to 10 of its oil into a lantern at a time (`items_bonus_apply`). `wet` runs from 0 to 1 and shows when above 0, to 0.1%
(`textf_floatpercent`). Only items with a `waterproof` value ever get wet: worn gear in the rain, what a worn bag or a chest holds
(`wet_inventory`, `gml_Object_obj_container_Alarm_1`), and wood from a tree, wet by its trunk's life above 0.5
(`gml_Object_obj_tree_Step_0`).

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
sprite bounds), `Beings.save`, `Containers.save`, `Stations.save` (camp items, and rafts: a finished raft is station 171, a Raft Base 170),
`Interactables.save` (rifts), `Trees.save` (loaded only when trees, brambles or rift vines are switched on), `NatureData.tmap` for thorny
ground, `Hinderance.tmap` and `LootData.tmap` for gatherables (loaded only when one is switched on, in interiors too; `Hinderance.tmap`
alone for the fern overlay) and `Water1.tmap` / `Ygrid.save` for the water overlay. The raft you stand on is not in `Stations.save`: saving
marks it `destroyOnSave` and sets `ensureRaft` in `Player.save`, and loading makes it under you again (`player_raft_ensure`), so the map
draws it where you were saved. Interiors (`[ x,y,ex,ey ]` folders, `RW1`–`RW3` for Scaal's depths) are linked to the entrance whose door is
at `ex,ey` and drawn from their `Data`/`Lower`/`OnLower`/`Water1` layers.

## Development

Needs only [Deno](https://deno.com) 2.x; there are no dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md) for the standards, the checks
every pull request must pass and how merging works.

```powershell
deno task dev      # http://127.0.0.1:8123 — also serves ../Saves read-only, so /?dev=<Character>&zone=C2 loads one
                   # /edit/?dev=<Character> copies that save into the browser's private storage and edits the copy (&fresh starts over)
deno task test     # unit tests, plus checks against real saves in ../Saves (or $env:MIRKLURK_SAVES) when present
deno task check    # type-check
deno task fmt      # format (deno task lint lints)
deno task coverage # tests with coverage; fails below the thresholds in deno.json
deno task ci       # what CI runs: format check, lint, type-check, coverage and build
deno task build    # dist/: index.html and edit/index.html with hashed app.*.js, edit.*.js, style.*.css and editor.*.css, art, manifest.webmanifest, icons/ and sw.js
deno task icons    # regenerate icons/ (favicon.svg, favicon-32.png, app icons) from the pixel art in tools/icons.ts
deno task wiki     # refresh src/wikidata.json and the bundled pictures (assets/wiki/, src/wikiart.json) from the public wiki; no saves or game data are sent
```

To exercise sharing locally, set `$env:ENABLE_UPLOADS = "true"` before `deno task dev`. Uploads are stored in the ignored `.uploads/`
directory, never in `dist/`. The dev server otherwise leaves uploads disabled. It serves no service worker, so every reload is fresh; to try
offline use, run the built `dist/` (for example with `docker compose`, below).

The icons are pixel art drawn from the game's own "Map of area" item and the colours of the Mirklurk logo: a folded parchment map with green
land, the logo's purple outline and an amber waypoint. `tools/icons.ts` holds them as text rows and writes the SVG favicon and every PNG
size deterministically, without dependencies.

`src/gamedata.ts` holds the game's names, the journal's text and sprite bounds. After a game update, regenerate it:

```powershell
$env:MIRKLURK_META_OUT = "$env:TEMP\mirklurk-meta"
& "C:\Program Files (x86)\UTMT_CLI\UndertaleModCli.exe" load "..\data.win" -s tools\dump_meta.csx
deno run -R -W --allow-run tools/gamedata.ts ".." "$env:TEMP\mirklurk-meta"
```

Then re-check the rules above in the decompiled entries (`UndertaleModCli dump ..\data.win -c UMT_DUMP_ALL`). The save editor's item table
`src/itemdata.ts` comes from the same decompiled entries:

```powershell
deno run -R -W --allow-run tools/itemdata.ts "<decompiled CodeEntries folder>"
```

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
unprivileged nginx on port 8080 over IPv4 and IPv6 (`deploy/nginx.conf`: strict Content-Security-Policy, which allows only same-origin
manifests and service workers, immutable caching for hashed assets, `/healthz`). `index.html`, `sw.js`, `manifest.webmanifest` (served as
`application/manifest+json`) and `icons/` revalidate on every request, so a release reaches installed apps on their next visit. It runs with
a read-only root filesystem, only `/tmp` writable and no capabilities. HSTS and TLS are left to the reverse proxy.

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
quest buildings taken from mirklurk.wiki and the MirkMap icons drawn from the "Map of area" item and the logo's colours, and the journal's
text are used on this site with the developer's permission; they remain the developer's copyrighted material and are not relicensed as part
of the viewer's source code.
