// Read-only export of the permitted map art. Run from the repository root.
// UndertaleModCli load <data.win> -s tools\dump_art.csx
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using ImageMagick;
using UndertaleModLib.Models;
using UndertaleModLib.Util;

{
EnsureDataLoaded();
string root = Environment.GetEnvironmentVariable("MIRKLURK_ART_OUT") ?? Directory.GetCurrentDirectory();
string outDir = Path.Combine(root, "assets", "game");
Directory.CreateDirectory(outDir);
using var worker = new TextureWorker();

string WriteImage(IMagickImage<byte> image, string name)
{
    byte[] bytes = image.ToByteArray(MagickFormat.Png);
    string hash = Convert.ToHexString(SHA256.HashData(bytes)).Substring(0, 10).ToLowerInvariant();
    string file = name + "." + hash + ".png";
    File.WriteAllBytes(Path.Combine(outDir, file), bytes);
    return "assets/game/" + file;
}

var hidden = new HashSet<string> { "Data", "NatureData", "LootData", "EffRain" };
var rooms = new Dictionary<string, object>();
var used = new HashSet<string> { "ts_cave", "ts_castle", "ts_ruin", "ts_ruin_top", "ts_riftworld", "ts_effects_water" };
foreach (var room in Data.Rooms)
{
    var layers = new List<object>();
    foreach (var layer in room.Layers.OrderByDescending(l => l.LayerDepth))
    {
        if (layer.Data is not UndertaleRoom.Layer.LayerTilesData tiles || hidden.Contains(layer.LayerName.Content)) continue;
        string tileset = tiles.Background.Name.Content;
        used.Add(tileset);
        layers.Add(new { name = layer.LayerName.Content, tileset, depth = layer.LayerDepth });
    }
    if (layers.Count > 0) rooms.Add(room.Name.Content, layers);
}

var tilesets = new Dictionary<string, object>();
foreach (var b in Data.Backgrounds.Where(b => used.Contains(b.Name.Content)))
{
    if (b.Texture == null || b.GMS2TileWidth != 16 || b.GMS2TileHeight != 16)
        throw new Exception("Unsupported tileset: " + b.Name.Content);
    using var image = worker.GetTextureFor(b.Texture, b.Name.Content, true);
    tilesets.Add(b.Name.Content, new {
        file = WriteImage(image, b.Name.Content),
        width = image.Width, height = image.Height,
        columns = b.GMS2TileColumns,
        borderX = b.GMS2OutputBorderX, borderY = b.GMS2OutputBorderY,
        // Logical tile IDs may refer to animated sequences. Keep the first saved visual frame.
        frames = Enumerable.Range(0, (int)b.GMS2TileCount)
            .Select(i => b.GMS2TileIds[i * (int)b.GMS2ItemsPerTileCount].ID).ToArray()
    });
}

var sprites = new Dictionary<string, object>();
var allowed = new Regex(@"^spr_(boulders_|building_|built_|caves_|cavesolids_|drops_|entrances_|found_|placed_|rift_|ruins_|stairs_natural|willow_|cypress_|trollgnarl_|riftvine_|elder_|brambles_|soldier$)");
foreach (var sprite in Data.Sprites.Where(s => allowed.IsMatch(s.Name.Content)))
{
    using var frames = new MagickImageCollection();
    foreach (var frame in sprite.Textures)
    {
        if (frame.Texture == null) throw new Exception("Missing sprite frame: " + sprite.Name.Content);
        frames.Add(worker.GetTextureFor(frame.Texture, sprite.Name.Content, true));
    }
    if (frames.Count == 0) continue;
    using var strip = frames.AppendHorizontally();
    if (strip.Width != sprite.Width * frames.Count || strip.Height != sprite.Height)
        throw new Exception("Unexpected sprite padding: " + sprite.Name.Content);
    sprites.Add(sprite.Name.Content, new {
        file = WriteImage(strip, sprite.Name.Content),
        w = sprite.Width, h = sprite.Height, ox = sprite.OriginX, oy = sprite.OriginY,
        frames = frames.Count
    });
}

Directory.CreateDirectory(Path.Combine(root, "src"));
File.WriteAllText(Path.Combine(root, "src", "artdata.json"),
    JsonConvert.SerializeObject(new { version = "0.8.1.5", tilesets, sprites, rooms }, Formatting.Indented) + "\n");
Console.WriteLine($"Exported {tilesets.Count} tilesets and {sprites.Count} environment sprite strips to {outDir}");
}
