/**
 * The random source, made injectable so a run can be replayed.
 *
 * Production still uses `crypto.getRandomValues`. What changes is that a run can
 * be handed a SEED, and every random choice it makes then follows from that seed
 * — Pollard rho's c and x0, ECM's sigma per curve, the primes the weak-N forge
 * draws. Without this, a displayed result could not be attributed to anything: a
 * failed rho search is a statement about one particular pseudo-random walk, and
 * "rho gave up" means nothing if the walk is unrecoverable.
 *
 * HONEST LIMIT, stated here because the UI states it too: a seed reproduces the
 * SEARCH, not necessarily the outcome. Every method is capped on wall-clock time
 * (`Budget.maxMs`), so a slower machine can stop the same search at a different
 * point. A run that finished before its cap is fully reproducible; a run that hit
 * the cap is reproducible only up to where the cap fell. `FactorOutcome` records
 * which happened.
 *
 * xoshiro256** over SplitMix64 seeding: small, exactly specified, and identical
 * in any engine with 64-bit BigInt. It is NOT a cryptographic generator and is
 * never used for anything that needs one — the only consumers are search
 * heuristics and teaching-key generation, and the page says so.
 */

export interface Rng {
  /** n uniformly random bytes. */
  bytes(n: number): Uint8Array;
}

export const cryptoRng: Rng = {
  bytes(n) {
    const b = new Uint8Array(n);
    crypto.getRandomValues(b);
    return b;
  },
};

const M64 = (1n << 64n) - 1n;

function splitmix64(state: bigint): { value: bigint; next: bigint } {
  let z = (state + 0x9e3779b97f4a7c15n) & M64;
  let x = z;
  x = ((x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
  x = ((x ^ (x >> 27n)) * 0x94d049bb133111ebn) & M64;
  x = x ^ (x >> 31n);
  return { value: x, next: z };
}

function rotl(x: bigint, k: bigint): bigint {
  return ((x << k) | (x >> (64n - k))) & M64;
}

/**
 * A deterministic byte stream from a hex seed. Any non-empty string works; it is
 * folded into 64 bits by SplitMix64, which is what that construction is for.
 */
export function seededRng(seedHex: string): Rng {
  let sm = 0n;
  for (const ch of seedHex) sm = (sm * 131n + BigInt(ch.charCodeAt(0))) & M64;
  const s: bigint[] = [];
  let cur = sm;
  for (let i = 0; i < 4; i++) {
    const r = splitmix64(cur);
    cur = r.next;
    s.push(r.value);
  }

  const next = (): bigint => {
    const result = (rotl((s[1] * 5n) & M64, 7n) * 9n) & M64;
    const t = (s[1] << 17n) & M64;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = rotl(s[3], 45n);
    return result;
  };

  return {
    bytes(n) {
      const out = new Uint8Array(n);
      let i = 0;
      while (i < n) {
        let word = next();
        for (let k = 0; k < 8 && i < n; k++) {
          out[i++] = Number(word & 0xffn);
          word >>= 8n;
        }
      }
      return out;
    },
  };
}

let current: Rng = cryptoRng;

export function getRng(): Rng {
  return current;
}

export function setRng(rng: Rng): void {
  current = rng;
}

/**
 * Run `fn` with a seeded generator, restoring the previous source afterwards
 * even if `fn` throws. Synchronous on purpose: an async version could interleave
 * two seeded regions and silently mix their streams.
 */
export function withSeed<T>(seedHex: string, fn: () => T): T {
  const previous = current;
  current = seededRng(seedHex);
  try {
    return fn();
  } finally {
    current = previous;
  }
}
