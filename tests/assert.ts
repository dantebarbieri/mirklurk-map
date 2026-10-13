// Small local assertions so tests need no downloads.

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

function equal(actual: unknown, expected: unknown, left = new Map<object, object>(), right = new Map<object, object>()): boolean {
  if (typeof actual !== "object" || actual === null || typeof expected !== "object" || expected === null) {
    return Object.is(actual, expected);
  }
  if (left.has(actual) || right.has(expected)) return left.get(actual) === expected && right.get(expected) === actual;
  if (actual === expected) return true;
  const prototype = Object.getPrototypeOf(actual);
  if (prototype !== Object.getPrototypeOf(expected)) return false;
  left.set(actual, expected);
  right.set(expected, actual);
  const matches = (a: unknown, b: unknown) => equal(a, b, left, right);
  try {
    if (actual instanceof Date && expected instanceof Date) return Object.is(actual.getTime(), expected.getTime());
    if (actual instanceof RegExp && expected instanceof RegExp) {
      return actual.source === expected.source && actual.flags === expected.flags && actual.lastIndex === expected.lastIndex;
    }
    if (actual instanceof ArrayBuffer && expected instanceof ArrayBuffer) {
      return matches(new Uint8Array(actual), new Uint8Array(expected));
    }
    if (ArrayBuffer.isView(actual) && ArrayBuffer.isView(expected)) {
      if (actual.byteLength !== expected.byteLength) return false;
      const a = new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength);
      const b = new Uint8Array(expected.buffer, expected.byteOffset, expected.byteLength);
      return a.every((value, i) => value === b[i]);
    }
    if (actual instanceof Map && expected instanceof Map) {
      if (actual.size !== expected.size) return false;
      const remaining = [...expected];
      for (const [key, value] of actual) {
        const at = remaining.findIndex(([k, v]) => matches(key, k) && matches(value, v));
        if (at < 0) return false;
        remaining.splice(at, 1);
      }
      return true;
    }
    if (actual instanceof Set && expected instanceof Set) {
      if (actual.size !== expected.size) return false;
      const remaining = [...expected];
      for (const value of actual) {
        const at = remaining.findIndex((v) => matches(value, v));
        if (at < 0) return false;
        remaining.splice(at, 1);
      }
      return true;
    }
    // Other class instances need an explicit assertion of their observable state, not a comparison of often-empty own keys.
    if (!Array.isArray(actual) && prototype !== Object.prototype && prototype !== null) return false;
    const keys = Reflect.ownKeys(actual);
    return keys.length === Reflect.ownKeys(expected).length &&
      keys.every((key) => Object.hasOwn(expected, key) && matches(Reflect.get(actual, key), Reflect.get(expected, key)));
  } finally {
    left.delete(actual);
    right.delete(expected);
  }
}

export function assertEquals<T>(actual: T, expected: T, msg?: string) {
  if (equal(actual, expected)) return;
  const show = (value: unknown) => Deno.inspect(value, { depth: Infinity, sorted: true, colors: false });
  throw new Error(`${msg ? msg + ": " : ""}expected ${show(expected)}, got ${show(actual)}`);
}

export function assertAlmost(actual: number, expected: number, eps = 1e-9, msg?: string) {
  if (!Number.isFinite(eps) || eps < 0) throw new Error("tolerance must be finite and non-negative");
  if (!Number.isFinite(actual) || !Number.isFinite(expected) || !(Math.abs(actual - expected) <= eps)) {
    throw new Error(`${msg ? msg + ": " : ""}expected ≈${expected}, got ${actual}`);
  }
}

export function assertThrows(fn: () => unknown, match: RegExp) {
  try {
    fn();
  } catch (e) {
    if (!match.test((e as Error).message)) throw new Error(`wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected an error matching ${match}`);
}

export async function assertRejects(fn: () => unknown, match?: RegExp) {
  try {
    await fn();
  } catch (e) {
    if (match && !match.test(String((e as Error).message))) throw new Error(`wrong error: ${(e as Error).message}`);
    return;
  }
  throw new Error("expected an error");
}
