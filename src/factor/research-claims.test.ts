import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('research finding boundaries', () => {
  it('keeps the printer-key chronology and vendors precise', () => {
    const readme = read('README.md');
    for (const required of [
      'Canon',
      'Fuji Xerox',
      'Rambus',
      '2021 scan data',
      'certificates dated 2020–21',
      'advisories and fixes followed in\n  2022',
      'published in 2023',
    ]) {
      expect(readme).toContain(required);
    }
    expect(readme).not.toContain('2022 batch');
  });

  it('distinguishes ECM curve count from full-modulus arithmetic cost', () => {
    const copy = [read('README.md'), read('src/factor/ecm.ts'), read('src/ui/ladder.ts')].join('\n');
    expect(copy).toContain('expected curve count tracks the smallest factor');
    expect(copy).toContain('arithmetic modulo a larger N still costs more on every curve');
    expect(copy).not.toContain('neither depends on how big N is');
    expect(copy).not.toContain('largely independent of `N`');
  });

  it('records the randomized Shor retry and prime-power boundary', () => {
    const copy = [read('README.md'), read('src/ui/shor.ts')].join('\n');
    expect(copy).toContain('retry if `r` is odd');
    expect(copy).toContain('a^(r/2) ≡ -1 (mod N)');
    expect(copy).toContain('retry when r is odd');
    expect(copy).toContain('Prime powers are detected and handled classically');
  });
});
