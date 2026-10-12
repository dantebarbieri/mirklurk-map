// Helpers shared by the tools: bundling for the browser, joining bytes, and writing generated sources.

/** The repository root. */
export const root = new URL("../", import.meta.url);

/** `entry` (a path from the root) bundled for the browser with `deno bundle` and `flags`; throws with the compiler's errors. */
export async function bundle(entry: string, ...flags: string[]): Promise<Uint8Array> {
  const { success, stdout, stderr } = await new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform", "browser", ...flags, entry],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) throw new Error(new TextDecoder().decode(stderr));
  return stdout;
}

/** The parts, one after another, in one array. */
export function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Writes a generated source file (`path` from the root) and formats it as `deno fmt` would, so CI's format check passes. */
export async function writeSource(path: string, text: string) {
  await Deno.writeTextFile(new URL(path, root), text);
  const { success, stderr } = await new Deno.Command(Deno.execPath(), { args: ["fmt", "--quiet", path], cwd: root, stderr: "piped" })
    .output();
  if (!success) throw new Error(`deno fmt ${path} failed: ${new TextDecoder().decode(stderr)}`);
}
