// Small local assertions so tests need no downloads.

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ": " : ""}expected ${e}, got ${a}`);
}

export function assertAlmost(actual: number, expected: number, eps = 1e-9, msg?: string) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg ? msg + ": " : ""}expected ≈${expected}, got ${actual}`);
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
