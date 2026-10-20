import { seededRng, withSeed } from '../factor/rng';
import { randomPrime } from '../factor/primality';
export interface CorpusContext { K:number; s:number; bits:number; seed:string }
export interface CorpusKey { n:bigint; rp:number; rq:number }
export const CORPUS_MAX_KEYS=128;
export function validateCorpus(ctx:CorpusContext):void {
  if(!Number.isInteger(ctx.K)||ctx.K<2||ctx.K>CORPUS_MAX_KEYS)throw new Error(`CORPUS_BUDGET: use 2–${CORPUS_MAX_KEYS} keys`);
  if(!Number.isInteger(ctx.s)||ctx.s<1||ctx.s>24)throw new Error('ENTROPY_BITS: use 1–24');
  if(!Number.isInteger(ctx.bits)||ctx.bits<8||ctx.bits>1024)throw new Error('PRIME_BITS: use 8–1024');
  if(!/^[0-9a-f]{1,64}$/i.test(ctx.seed))throw new Error('SEED: use 1–64 hex digits');
}
export const primeFromSeed=(r:number,bits:number):bigint=>withSeed(r.toString(16).padStart(8,'0'),()=>randomPrime(bits));
// [extension] point: draw p during boot's low-entropy window, q after entropy arrives.
export function generateCorpus(ctx:CorpusContext,onProgress?:(done:number,total:number,note:string)=>void):{keys:CorpusKey[];distinctSeeds:number;rejectedEqual:number;observedSeedPairs:number} {
  validateCorpus(ctx);const rng=seededRng(ctx.seed),cache=new Map<number,bigint>(),keys:CorpusKey[]=[];
  const draw=():number=>{const b=rng.bytes(3);return (b[0]|b[1]<<8|b[2]<<16)&(2**ctx.s-1);};
  const prime=(r:number):bigint=>{if(!cache.has(r))cache.set(r,primeFromSeed(r,ctx.bits));return cache.get(r)!;};
  let rejectedEqual=0;const uses=new Map<number,number>();
  for(let i=0;i<ctx.K;i++){
    const rp=draw(),p=prime(rp);let rq=draw(),attempts=0;
    while(rq===rp||prime(rq)===p){
      rejectedEqual++;if(++attempts>10000)throw new Error('DISTINCT_PRIME_BUDGET_EXHAUSTED');rq=draw();
    }
    const q=prime(rq);keys.push({n:p*q,rp,rq});
    for(const r of [rp,rq])uses.set(r,(uses.get(r)??0)+1);
    onProgress?.(i+1,ctx.K,`${cache.size} distinct seeds generated`);
  }
  const observedSeedPairs=[...uses.values()].reduce((sum,n)=>sum+n*(n-1)/2,0);
  return {keys,distinctSeeds:cache.size,rejectedEqual,observedSeedPairs};
}
