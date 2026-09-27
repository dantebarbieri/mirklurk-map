// Dumps sprite metadata from data.win for tools/gamedata.ts.
// UndertaleModCli load <data.win> -s tools/dump_meta.csx   (output dir: $MIRKLURK_META_OUT or ./meta)
using System;
using System.IO;
using System.Text;
using UndertaleModLib;
using UndertaleModLib.Models;

EnsureDataLoaded();

string outDir = Environment.GetEnvironmentVariable("MIRKLURK_META_OUT") ?? Path.Combine(Directory.GetCurrentDirectory(), "meta");
Directory.CreateDirectory(outDir);

string J(string s) => s == null ? "null" : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";

var sb = new StringBuilder("[\n");
bool first = true;
foreach (var s in Data.Sprites)
{
    if (s == null) continue;
    if (!first) sb.Append(",\n");
    first = false;
    sb.Append("{\"name\":" + J(s.Name?.Content) +
        ",\"w\":" + s.Width + ",\"h\":" + s.Height +
        ",\"ox\":" + s.OriginX + ",\"oy\":" + s.OriginY +
        ",\"bl\":" + s.MarginLeft + ",\"br\":" + s.MarginRight +
        ",\"bt\":" + s.MarginTop + ",\"bb\":" + s.MarginBottom +
        ",\"frames\":" + s.Textures.Count + "}");
}
sb.Append("\n]\n");
File.WriteAllText(Path.Combine(outDir, "sprites.json"), sb.ToString());
Console.WriteLine("sprites.json: " + Data.Sprites.Count + " sprites -> " + outDir);
