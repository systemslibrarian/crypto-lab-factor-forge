/**
 * "Shor & the RSA rules" — the comparison the whole lab is built to set up.
 *
 * Every rule in RSA key generation is a defence against exactly one of the
 * classical methods on the race board. The first table below names which, and
 * every row of its last column reads No: not one of them touches Shor.
 *
 * The reason has to be stated carefully, and this panel used to state it
 * wrongly. "Shor exploits no structure of N at all" is an over-claim: Shor
 * exploits the multiplicative order of a modulo N, which is structure, and the
 * whole algorithm is built on it. What Shor needs no part of is an ACCIDENTAL
 * weakness in how p and q were chosen. MOST of the classical methods here wait
 * for a property only SOME moduli have -- a small factor, a narrow p - q, a
 * smooth p - 1 -- and a key-generation rule can take those methods off the
 * board entirely. The sieves are the exception and are the interesting case:
 * the quadratic sieve and the number field sieve need no accidental weakness
 * either, which is exactly why the only rule that touches them is "make N
 * bigger". So the sieves and Shor sit on the same side of the first
 * distinction and on opposite sides of the second: all three are structure-free,
 * and only Shor is polynomial. The periodicity of x -> a^x mod N is a property
 * EVERY modulus has, for every a coprime to it, so there is nothing to generate
 * your way out of and, unlike the sieves, no size at which the cost becomes
 * prohibitive. That is what "different in kind" means, and it is a sharper
 * claim than "no structure", not a softer one.
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
      'p-1 finds p whenever p - 1 is B-smooth for an affordable B — or B1-smooth apart from one prime up to B2, which is the stage 2 this page runs. One large prime factor in p - 1 puts it past every affordable bound, and the same has to hold for q - 1.',
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

/**
 * The page spells small numbers out, and so does the claims suite that reads
 * this panel's verdict as prose. Spelling a DERIVED count keeps the sentence
 * and the table in step: add a seventh rule and the sentence says "seven"
 * rather than continuing to say "six" beside seven rows.
 */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function spell(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

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
          // Read from the row, not hard-coded. The cell said "✗ No" whatever
          // `helpsVsShor` held, so the field carrying the panel's central claim
          // was never actually rendered -- a row could contradict its own
          // column and the page would keep printing No.
          r.helpsVsShor
            ? el('span', { class: 'pill pill-ok', text: '✓ Yes' })
            : el('span', { class: 'pill pill-bad', text: '✗ No' }),
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
            el('strong', {
              text:
                'no accidental weakness in p or q — only the period of x ↦ a^x mod N, which every modulus has',
            }),
            el('strong', { text: 'polynomial in log N' }),
          ],
        ],
        'Methods compared by what they exploit'
      )
    );
    cmp.append(
      verdict(
        'alarm',
        // The count is read off RULES, not typed. It was the literal word "six"
        // beside a table anyone could add a seventh row to -- the same drift the
        // ladder panel was caught in with "These four" beside three curves.
        `None of the ${spell(RULES.length)} rules above does anything against Shor.`,
        'Safe primes, independently drawn primes, a large |p - q| — each of those removes a structure that only SOME moduli have, and with it a whole method. Shor asks for none of them. It reduces factoring to finding the period of x ↦ a^x mod N, and that period exists for every N and every a coprime to it: there is no modulus you can generate without one. Period-finding is where a quantum computer is polynomial and no classical method is known to be — known, because the classical hardness of factoring has never been proved either.'
      )
    );
    // "Make the modulus larger" used to be described here as raising the qubit
    // count "from polynomial to slightly more polynomial". That is not a
    // well-formed statement about complexity: growing N moves you ALONG one
    // polynomial, it does not change the polynomial's degree, and no amount of
    // moving along it turns polynomial into anything else. The two things being
    // run together are the resources a fixed algorithm needs and the asymptotic
    // class it sits in, so the table below separates them explicitly.
    cmp.append(el('h3', { text: 'Removing an algorithm is not the same as raising its bill' }));
    cmp.append(
      el('p', {
        class: 'small',
        text:
          'The structural rules above do the first: each takes a method off the board and it never comes back. Making the modulus larger does only the second, to the sieves and to Shor alike.',
      })
    );
    cmp.append(
      table(
        ['The change', 'Effect on the classical board', 'Effect on Shor'],
        [
          [
            'Close a structure: safe primes, independent p and q, primes of equal size',
            'Removes a method outright. p-1 against a p - 1 with a large prime factor does not get slower; it does not finish at any bound you can afford, and the method leaves the board.',
            'None. Shor never asked whether p - 1 was smooth, or how far apart p and q were.',
          ],
          [
            'Make the modulus larger',
            'Raises the cost of the sieves — the quadratic sieve on the board here, and the number field sieve, which is not implemented on this page. Same L_N formulas, evaluated further out. It is the only lever against them, which is why it sets the key-size recommendations.',
            'Raises the resources: qubits grow linearly in the bit length of N (the standard constructions want a small multiple of it) and gate count polynomially. The algorithm is unchanged and it is still polynomial.',
          ],
        ],
        'Rules that remove a method, against a change that only raises the cost'
      )
    );
    cmp.append(
      el('p', {
        class: 'small',
      },
        document.createTextNode('Going from a 2048-bit modulus to a 4096-bit one therefore roughly doubles the qubits and, on the cubic gate count the Ladder panel plots, multiplies the gates by about eight. That is a bigger bill for the same algorithm at the same asymptotic cost — a move along one curve. Every classical rule on this page does something categorically different: it deletes a curve. See '),
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
