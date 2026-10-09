import { coordLabel, ROOM } from "./rules.ts";
import { decodeTilemap, type Solid } from "./save.ts";
import { areaLayers, ART, mipLevel, type Sprite, tileSource, tileTransform } from "./tiles.ts";
import { loadDetail, loadTrees, type World } from "./world.ts";
import type { Raster, Rect } from "./mapview.ts";

export interface Scene {
  dir?: string;
  kind: number | null;
  solids: Solid[];
  x: number;
  y: number;
  label: string;
}

interface Texture {
  levels: HTMLCanvasElement[];
}

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  return c;
}

let images: Promise<Map<string, HTMLImageElement>> | undefined;
function loadImages() {
  return images ??= Promise.all([...Object.values(ART.tilesets), ...Object.values(ART.sprites)].map(async ({ file }) => {
    const img = new Image();
    img.src = file;
    await img.decode().catch(() => {
      throw new Error(`Could not load game art: ${file}`);
    });
    return [file, img] as const;
  })).then((entries) => new Map(entries)).catch((e) => {
    images = undefined;
    throw e;
  });
}

function pyramid(full: HTMLCanvasElement): Texture {
  const levels = [full];
  while (levels.at(-1)!.width > 80) {
    const prev = levels.at(-1)!;
    const next = canvas(prev.width / 2);
    const ctx = next.getContext("2d")!;
    // Exact 2:1 bilinear reductions average each 2x2 block, avoiding nearest-neighbour aliasing.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "low";
    ctx.drawImage(prev, 0, 0, next.width, next.height);
    levels.push(next);
  }
  return { levels };
}

const treeSpecies: Record<number, [string, string, string | null]> = {
  4: ["spr_willow_trunk", "spr_willow_branch", "spr_willow_leaves"],
  7: ["spr_cypress_trunk", "spr_cypress_branch", "spr_cypress_leaves"],
  17: ["spr_trollgnarl_trunk", "spr_trollgnarl_branch", "spr_trollgnarl_leaves"],
  20: ["spr_elder_branch", "spr_elder_branch", "spr_elder_leaves"],
  6: ["spr_brambles_branch", "spr_brambles_branch", null],
  13: ["spr_riftvine_branch", "spr_riftvine_branch", null],
};

async function renderScene(world: World, scene: Scene, signal: AbortSignal): Promise<Texture> {
  signal.throwIfAborted();
  if (!scene.dir) throw new Error("This area has no saved tile layers.");
  if (scene.kind === null) throw new Error("This interior's tileset is unknown.");
  const art = await loadImages();
  signal.throwIfAborted();
  const specs = areaLayers(scene.kind);
  const layers = await Promise.all(specs.map(async (spec) => {
    const file = world.files.get(`${scene.dir}${spec.name}.tmap`);
    const bytes = file ? await file.read() : null;
    signal.throwIfAborted();
    return { spec, grid: bytes ? decodeTilemap(bytes) : null };
  }));
  signal.throwIfAborted();
  if (!layers.some((l) => l.grid)) throw new Error("No saved visual tile layers. Open the full character folder, not just Player.save.");
  const [detail, trees] = await Promise.all([loadDetail(world, scene.dir), loadTrees(world, scene.dir)]);
  signal.throwIfAborted();
  const full = canvas(ROOM);
  const ctx = full.getContext("2d")!;
  ctx.fillStyle = "#120e0f";
  ctx.fillRect(0, 0, ROOM, ROOM);
  ctx.imageSmoothingEnabled = false;
  const drawLayer = ({ spec, grid }: typeof layers[number]) => {
    if (!grid) return;
    const tileset = ART.tilesets[spec.tileset];
    const image = art.get(tileset.file)!;
    for (let i = 0; i < grid.data.length; i++) {
      const data = grid.data[i];
      const source = tileSource(tileset, data);
      if (!source) continue;
      const x = i % grid.w * 16, y = Math.floor(i / grid.w) * 16;
      if (data & 0x70000000) {
        ctx.setTransform(...tileTransform(data), x + 8, y + 8);
        ctx.drawImage(image, ...source, 16, 16, -8, -8, 16, 16);
        ctx.resetTransform();
      } else ctx.drawImage(image, ...source, 16, 16, x, y, 16, 16);
    }
  };
  for (const l of layers) if (l.spec.depth > 0) drawLayer(l);

  const tinted = new Map<string, HTMLCanvasElement>();
  function drawSprite(
    name: string,
    pic: number,
    x: number,
    y: number,
    sx = 1,
    sy = 1,
    angle = 0,
    tint = 0xffffff,
  ) {
    const spec: Sprite | undefined = ART.sprites[name];
    if (!spec) throw new Error(`Unsupported saved environment sprite: ${name}`);
    let image: CanvasImageSource = art.get(spec.file)!;
    if (tint !== 0xffffff) {
      const key = `${name}:${tint}`;
      let strip = tinted.get(key);
      if (!strip) {
        strip = canvas(1);
        strip.width = spec.w * spec.frames;
        strip.height = spec.h;
        const paint = strip.getContext("2d")!;
        paint.drawImage(image, 0, 0);
        paint.globalCompositeOperation = "multiply";
        paint.fillStyle = `rgb(${tint & 255} ${(tint >> 8) & 255} ${(tint >> 16) & 255})`;
        paint.fillRect(0, 0, strip.width, strip.height);
        paint.globalCompositeOperation = "destination-in";
        paint.drawImage(image, 0, 0);
        tinted.set(key, strip);
      }
      image = strip;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-angle * Math.PI / 180);
    ctx.scale(sx, sy);
    const frame = ((Math.floor(pic) % spec.frames) + spec.frames) % spec.frames;
    ctx.drawImage(image, frame * spec.w, 0, spec.w, spec.h, -spec.ox, -spec.oy, spec.w, spec.h);
    ctx.restore();
  }

  const objects: { y: number; draw: () => void }[] = [];
  for (
    const item of [
      ...scene.solids,
      ...detail.decorations,
      ...detail.containers.filter((c) => c.status !== -209),
      ...detail.stations,
      ...detail.interactables,
    ]
  ) {
    // Beings, carcasses and transient effects remain the viewer's semantic markers.
    if (!item.sprite || item.sprite === "spr_part_circles") continue;
    objects.push({ y: item.y, draw: () => drawSprite(item.sprite, item.pic, item.x, item.y) });
  }
  for (const tree of trees) {
    const species = treeSpecies[tree.index];
    if (!tree.parts?.length) continue;
    if (!species) throw new Error(`Unsupported saved tree species: ${tree.index}`);
    objects.push({
      y: tree.y,
      draw: () => {
        for (const b of tree.parts!) {
          const trunk = b[21] === 0;
          drawSprite(species[trunk ? 0 : 1], b[14], b[1], b[2], b[11] * b[20], b[11], b[12], b[15]);
          if (species[2] && !(trunk && tree.index === 17) && b[22] > 0.33) {
            drawSprite(species[2], b[9], b[3], b[4], b[20], 1, b[10] - b[18]);
          }
        }
      },
    });
  }
  objects.sort((a, b) => a.y - b.y);
  for (const item of objects) item.draw();
  for (const l of layers) if (l.spec.depth <= 0) drawLayer(l);
  return pyramid(full);
}

/** Retain small previews for the whole world, but at most four full-resolution areas. */
export class TerrainStore {
  readonly previews = new Map<string, Texture>();
  readonly errors = new Map<string, string>();
  private full = new Map<string, Texture>();
  private queue = new Map<string, Scene>();
  private listeners = new Set<() => void>();
  private busy = false;
  private dead = false;
  private controller = new AbortController();

  constructor(private world: World, private render = renderScene) {}

  subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  dispose() {
    this.dead = true;
    this.controller.abort();
    this.queue.clear();
    this.listeners.clear();
    this.full.clear();
    this.previews.clear();
    this.errors.clear();
  }

  get(scene: Scene, high: boolean): Texture | undefined {
    const dir = scene.dir;
    if (this.dead || !dir) return undefined;
    const full = this.full.get(dir);
    if (high && full) {
      this.full.delete(dir);
      this.full.set(dir, full);
    }
    const preview = this.previews.get(dir);
    if (!this.errors.has(dir) && !(high ? full : preview) && !this.queue.has(dir)) {
      this.queue.set(dir, scene);
      void this.work();
    }
    return high && full ? full : preview;
  }

  private async work() {
    if (this.busy || this.dead) return;
    this.busy = true;
    while (this.queue.size && !this.dead) {
      const [dir, scene] = this.queue.entries().next().value!;
      try {
        const texture = await this.render(this.world, scene, this.controller.signal);
        if (this.dead) break;
        this.previews.set(dir, { levels: texture.levels.slice(3) });
        this.full.set(dir, texture);
        while (this.full.size > 4) this.full.delete(this.full.keys().next().value!);
      } catch (e) {
        if (this.dead) break;
        console.error(e);
        this.errors.set(dir, `${scene.label}: ${(e as Error).message}`);
      }
      this.queue.delete(dir);
      for (const update of this.listeners) update();
      // Yield between zones so zooming and save selection stay responsive.
      if (this.queue.size) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    this.busy = false;
  }
}

function drawTexture(ctx: CanvasRenderingContext2D, texture: Texture, x: number, y: number, size: number) {
  const base = texture.levels[0].width;
  const scale = size / base;
  const image = texture.levels[mipLevel(scale, texture.levels.length)];
  ctx.imageSmoothingEnabled = size < ROOM;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, x, y, size, size);
}

export class TerrainRaster implements Raster {
  constructor(private store: TerrainStore, private scenes: Scene[]) {}

  subscribe(callback: () => void) {
    return this.store.subscribe(callback);
  }

  paint(ctx: CanvasRenderingContext2D, view: Rect) {
    const scale = ctx.canvas.width / view.width;
    const visible = this.scenes.filter((scene) =>
      scene.x + ROOM > view.x && scene.y + ROOM > view.y && scene.x < view.x + view.width && scene.y < view.y + view.height
    );
    const distance = (scene: Scene) =>
      Math.hypot(scene.x + ROOM / 2 - view.x - view.width / 2, scene.y + ROOM / 2 - view.y - view.height / 2);
    const detailed = new Set([...visible].sort((a, b) => distance(a) - distance(b)).slice(0, 4));
    for (const scene of visible) {
      const x = (scene.x - view.x) * scale, y = (scene.y - view.y) * scale, size = ROOM * scale;
      const texture = this.store.get(scene, detailed.has(scene) && size > 320);
      if (texture) drawTexture(ctx, texture, x, y, size);
      else {
        ctx.fillStyle = "#251d1f";
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = "#b6a39a";
        ctx.font = `${Math.max(11, Math.min(16, size / 14)) * devicePixelRatio}px system-ui`;
        const text = scene.dir ? this.store.errors.has(scene.dir) ? "Tile data unavailable" : "Loading tiles..." : "No saved terrain";
        ctx.fillText(text, x + 8, y + size / 2, size - 16);
      }
      if (this.scenes.length > 1) {
        ctx.strokeStyle = "#cebbae88";
        ctx.lineWidth = devicePixelRatio;
        ctx.strokeRect(x, y, size, size);
        if (size > 55 * devicePixelRatio && Math.min(view.width, view.height) > ROOM * 1.2) {
          ctx.font = `${11 * devicePixelRatio}px system-ui`;
          ctx.fillStyle = "#120e0fcc";
          ctx.fillRect(x, y, size, 20 * devicePixelRatio);
          ctx.fillStyle = "#fff3b2";
          ctx.fillText(scene.label, x + 4, y + 14 * devicePixelRatio, size - 8);
        }
      }
    }
  }
}

export function worldScenes(world: World, originX: number, originY: number): Scene[] {
  return world.zones.flat().map((z) => ({
    dir: z.dir,
    kind: z.type,
    solids: z.solids,
    x: (z.x - originX) * ROOM,
    y: (z.y - originY) * ROOM,
    label: `${coordLabel(z.x, z.y)} ${z.name}`,
  }));
}

export function paintThumbnail(target: HTMLCanvasElement, store: TerrainStore, scene: Scene) {
  const texture = store.get(scene, false);
  const ctx = target.getContext("2d")!;
  ctx.clearRect(0, 0, target.width, target.height);
  if (texture) drawTexture(ctx, texture, 0, 0, target.width);
}
