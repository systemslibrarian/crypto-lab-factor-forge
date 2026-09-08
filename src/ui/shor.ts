/**
 * "Shor & the RSA rules" — the comparison the whole lab is built to set up.
 *
 * Every rule in RSA key generation is a defence against exactly one of the
 * classical methods on the race board. The table below names which. The last
 * row is the honest one: none of the rules touches Shor, because Shor exploits
 * no structure of N at all. That is what "different in kind" means.
 */

import { ALGORITHMS } from '../factor/types';
import { clear, el, table, verdict } from './dom';

const SHOR = 'https://systemslibrarian.github.io/crypto-lab-shor/';
const RSA_EDU = 'https://systemslibrarian.github.io/crypto-lab-rsa-educational/';
const RSA_FORGE = 'https://systemslibrarian.github.io/crypto-lab-rsa-forge/';

interface Rule {
  rule: string;
  defends: string;
  because: string;
  helpsVsShor: boolean;
}

const RULES: Rule[] = [
  {
    rule: 'Use two large primes of the same bit length',
    defends: 'Trial division; Pollard rho; ECM',
    because:
      'All three are driven by the size of the SMALLEST factor. Equal-size primes make the smallest factor as large as it can be.',
    helpsVsShor: false,
  },
  {
    rule: 'Choose p and q independently — never q = nextprime(p)',
    defends: 'Fermat difference of squares',
    because:
      'Fermat needs about (p-q)²/(8·sqrt(N)) steps. Independently drawn primes of the same size still differ by roughly sqrt(N), which puts that count out of reach.',
    helpsVsShor: false,
  },
  {
    rule: 'Require p - 1 to have a large prime factor (a "strong" or safe prime)',
    defends: "Pollard's p-1",
    because:
      'p-1 succeeds exactly when p - 1 is B-smooth for an affordable B. One large prime factor in p - 1 removes the whole attack.',
    helpsVsShor: false,
  },
  {
    rule: 'Require p + 1 to have a large prime factor too',
    defends: "Williams' p+1",
    because:
      'A safe prime p = 2q + 1 fixes p - 1 but leaves p + 1 = 2(q + 1) arbitrary — the Weak N Forge on this page demonstrates exactly that gap.',
    helpsVsShor: false,
  },
  {
    rule: 'Make the modulus large (2048 bits or more)',
    defends: 'Quadratic sieve; number field sieve',
    because:
      'These two exploit no structure of p or q whatsoever, so size is the only lever there is. NFS at L_N[1/3, 1.923] is what sets the current key-size recommendations.',
    helpsVsShor: false,
  },
  {
    rule: 'Use a fresh modulus per key; never share p between moduli',
    defends: 'Batch GCD across a corpus of keys',
    because:
      'Two moduli sharing a prime are split by one gcd — not a method on this page, but the same lesson: the attack finds the structure you left behind.',
    helpsVsShor: false,
  },
];

export function mountShorPanel(root: HTMLElement): () => void {
  const render = (): void => {
    clear(root);

    root.append(
      el(
        'div',
        { class: 'intro' },
        el('h2', { text: 'Every rule on this list has a name attached' }),
        el('p', {
          text:
            'RSA key generation reads like a list of arbitrary requirements. It is not. Each line is a defence against one specific method, and the ones you have been running on this page are those methods. Then there is the last row.',
        })
      )
    );

    const rulesCard = el('div', { class: 'card' });
    rulesCard.append(el('h2', { text: 'The rules and what they defend against' }));
    rulesCard.append(
      table(
        ['Key-generation rule', 'Defends against', 'Why', 'Helps against Shor?'],
        RULES.map((r) => [
          r.rule,
          r.defends,
          r.because,
          el('span', { class: 'pill pill-bad', text: '✗ No' }),
        ]),
        'RSA key-generation rules'
      )
    );
    root.append(rulesCard);

    const cmp = el('div', { class: 'card' });
    cmp.append(el('h2', { text: 'Shor is different in kind, not in degree' }));
    cmp.append(
      table(
        ['Method', 'What it exploits', 'Cost'],
        [
          ...ALGORITHMS.map((a) => [a.name, a.exploits, a.complexity]),
          [
            'Number field sieve (not implemented here)',
            'nothing about p or q — relations in a number field',
            'L_N[1/3, 1.923] — sub-exponential',
          ],
          [
            el('strong', { text: "Shor's algorithm" }),
            el('strong', { text: 'nothing at all — it finds the period of a^x mod N' }),
            el('strong', { text: 'polynomial in log N' }),
          ],
        ],
        'Methods compared by what they exploit'
      )
    );
    cmp.append(
      verdict(
        'alarm',
        'None of the six rules above does anything against Shor.',
        'Bigger primes, safe primes, a large |p - q| — every one of them removes a STRUCTURE. Shor uses no structure of N. It reduces factoring to finding the period of the function x ↦ a^x mod N, and period-finding is where a quantum computer is polynomial and every classical machine is not.'
      )
    );
    cmp.append(
      el('p', {
        class: 'small',
      },
        document.createTextNode('The one rule that does respond is "make the modulus larger" — and only in the sense that it raises the qubit count of the machine you need, from polynomial to slightly more polynomial. It does not change the shape of the problem. See '),
        el('a', { href: SHOR, target: '_blank', rel: 'noopener noreferrer' }, "crypto-lab-shor"),
        document.createTextNode(' for the period-finding half of this story, run as real arithmetic on a small N.')
      )
    );
    root.append(cmp);

    const scope = el('div', { class: 'card' });
    scope.append(el('h2', { text: 'What this page is not' }));
    scope.append(
      el('ul', {},
        li('The number field sieve is a pointer here, not an implementation. Everything about NFS on this page is a cost formula, and it is labelled as one.'),
        li('Nothing here factors anything close to RSA-sized. The sizes are set by what finishes in a browser tab while you watch, and they are measured, never extrapolated.'),
        li('Miller-Rabin is a probabilistic primality test. Below 3.3 × 10^24 the base set used here is proven deterministic, and above it the page says the verdict is probabilistic.'),
        li('There is no quantum simulation on this page. The Shor row is a cost comparison and a link, not a computation.')
      )
    );
    scope.append(
      el('p', { class: 'small' },
        document.createTextNode('Related: '),
        el('a', { href: RSA_EDU, target: '_blank', rel: 'noopener noreferrer' }, 'crypto-lab-rsa-educational'),
        document.createTextNode(' builds the keys these rules are about and breaks a deliberately tiny one with trial division and rho; '),
        el('a', { href: RSA_FORGE, target: '_blank', rel: 'noopener noreferrer' }, 'crypto-lab-rsa-forge'),
        document.createTextNode(' attacks the padding and the protocol rather than the modulus.')
      )
    );
    root.append(scope);
  };

  render();
  return render;
}

function li(text: string): HTMLElement {
  return el('li', { class: 'small', text });
}
