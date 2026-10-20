import {it,expect,vi} from 'vitest';
import {productTree,remainderTree,batchGcd,pairwiseGcd} from './batchgcd';
import {generateCorpus,primeFromSeed} from './generate';
import {birthdayPrediction} from './birthday';
import {verifyCorpus} from './verify';
import * as verifier from '../verify/verify';

it('product and remainder levels match direct arithmetic including odd leaf counts',()=>{
  for(const ns of [[15n],[15n,21n],[15n,21n,77n,143n,323n]]){
    const tree=productTree(ns),p=ns.reduce((a,b)=>a*b,1n),rest=remainderTree(tree);
    expect(tree.at(-1)).toEqual([p]);
    expect(rest[0]).toEqual(ns.map(n=>p%(n*n)));
    tree.forEach((row,l)=>expect(rest[l]).toEqual(row.map(n=>p%(n*n))));
  }
});
it('batch and independent pairwise raw gcds and recovered sets agree on 200 seeded corpora',()=>{
  for(let i=0;i<200;i++){
    const ns=generateCorpus({K:2+i%19,s:1+i%8,bits:16,seed:i.toString(16)}).keys.map(k=>k.n);
    const batch=batchGcd(ns),naive=pairwiseGcd(ns);
    expect(batch.splits).toEqual(naive.splits);expect(naive.comparisons).toBe(ns.length*(ns.length-1)/2);
  }
},60000);
it('generator repeats primes from repeated public seeds and rejects equal seeds inside a key',()=>{
  const result=generateCorpus({K:12,s:3,bits:32,seed:'c0ffee'});
  const seen=new Map<number,bigint>();
  for(const key of result.keys){
    expect(key.rp).not.toBe(key.rq);
    const p=primeFromSeed(key.rp,32),q=primeFromSeed(key.rq,32);expect(key.n).toBe(p*q);
    for(const [r,prime]of [[key.rp,p],[key.rq,q]] as const){if(seen.has(r))expect(seen.get(r)).toBe(prime);seen.set(r,prime);}
  }
  expect(result.distinctSeeds).toBeLessThanOrEqual(8);expect(result.observedSeedPairs).toBeGreaterThan(0);
  expect(generateCorpus({K:12,s:3,bits:32,seed:'c0ffee'})).toEqual(result);
  // Local deterministic regression pin, not a published known-answer vector.
  expect(result.keys.map(k=>String(k.n))).toEqual(["8734349077250713901", "10378219387951704749", "9168905614756450799", "10647462346315825843", "8082390252680979661", "11585256964773938893", "10235294096406353743", "8082390252680979661", "8082390252680979661", "14041185870919867007", "7521456257918324593", "10235294096406353743"]);
  expect(batchGcd(result.keys.map(k=>k.n)).splits.flatMap((s,i)=>s.factor===null?[]:[i])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
it('both-primes-shared falls back and an identical modulus alone cannot be split',()=>{
  expect(batchGcd([15n,21n,35n]).splits.map(s=>s.factor)).toEqual([3n,3n,5n]);
  const repeated=batchGcd([15n,15n]).splits;
  expect(repeated.map(s=>s.factor)).toEqual([null,null]);expect(repeated[0].repeated).toEqual([1]);
  expect(batchGcd([15n,77n,221n]).splits.every(s=>s.raw===1n&&s.factor===null)).toBe(true);
});
it('every corpus result goes through the original verifier including no claims',()=>{
  const ns=[15n,21n,143n],splits=batchGcd(ns).splits,spy=vi.spyOn(verifier,'verifyFactorization');
  try{const out=verifyCorpus(ns,splits);expect(spy).toHaveBeenCalledTimes(3);expect(out.map(x=>x.status)).toEqual(['verified','verified','no-claim']);expect(out[0].fullyFactored).toBe(true);}finally{spy.mockRestore();}
});
it('birthday prediction distinguishes its exact model probability from the expected number of pairs',()=>{
  const p=birthdayPrediction(2,2);expect(p.expectedPairs).toBe(1.5);expect(p.exactNumerator).toBe(29n);expect(p.exactDenominator).toBe(32n);expect(p.collisionProbability).toBeCloseTo(29/32,14);
  expect(birthdayPrediction(3,2).collisionProbability).toBe(1);
});
