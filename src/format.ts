// Wording shared by the map's cards and panels and the save editor.

/** A count with its noun: "1 turn", "3 turns"; `many` for nouns that add more than an "s". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A chance as a whole percentage that never rounds to a certainty it is not: "<1%" and ">99%" rather than "0%" and "100%". */
export const pct = (p: number) => (p >= 0.995 && p < 1 ? ">99%" : p > 0 && p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);
