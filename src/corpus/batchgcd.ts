import { gcd } from '../factor/bigint';
export type LevelObserver = (kind:'product'|'remainder',level:number,values:bigint[])=>void;
function validate(ns:bigint[]):void {if(!ns.length || ns.some(n=>n<2n))throw new Error('NONEMPTY_MODULI_AT_LEAST_TWO_REQUIRED');}
export function productTree(ns:bigint[],observe?:LevelObserver):bigint[][] {
  validate(ns);const levels=[ns.slice()];observe?.('product',0,levels[0]);
  while(levels.at(-1)!.length>1){
    const previous=levels.at(-1)!,next:bigint[]=[];
    for(let i=0;i<previous.length;i+=2)next.push(previous[i]*(previous[i+1]??1n));
    levels.push(next);observe?.('product',levels.length-1,next);
  }
  return levels;
}
/** Levels use the product tree's leaf-first indices, but are visited root first. */
export function remainderTree(products:bigint[][],observe?:LevelObserver):bigint[][] {
  const levels:bigint[][]=Array(products.length),top=products.length-1;
  levels[top]=products[top].slice();observe?.('remainder',top,levels[top]);
  for(let level=top-1;level>=0;level--){
    levels[level]=products[level].map((n,i)=>levels[level+1][Math.floor(i/2)]%(n*n));
    observe?.('remainder',level,levels[level]);
  }
  return levels;
}
export interface CorpusSplit {raw:bigint; factor:bigint|null; repeated:number[]; sharedWith:number[]; fallback:boolean}
function split(ns:bigint[],i:number,raw:bigint):CorpusSplit {
  const n=ns[i],repeated:number[]=[],sharedWith:number[]=[];
  let factor=raw>1n&&raw<n?raw:null;
  for(let j=0;j<ns.length;j++)if(j!==i && raw>1n){
    if(ns[j]===n)repeated.push(j);
    // Only the ambiguous g=N case needs pairwise GCD fallback. For a proper
    // split, compute the sharing annotation by divisibility of recovered factors.
    const g=raw===n?gcd(n,ns[j]):ns[j]%raw===0n?raw:1n;if(g>1n)sharedWith.push(j);
    if(raw===n&&g>1n&&g<n)factor=g;
  }
  // Canonical ordering lets independent routes compare recovered splits.
  if(factor!==null && n/factor<factor)factor=n/factor;
  return {raw,factor,repeated,sharedWith,fallback:raw===n};
}
// [extension] point: scaled remainder trees and Bernstein's further speedups.
export function batchGcd(ns:bigint[],observe?:LevelObserver):{products:bigint[][];remainders:bigint[][];splits:CorpusSplit[]} {
  const products=productTree(ns,observe),remainders=remainderTree(products,observe);
  const splits=ns.map((n,i)=>split(ns,i,gcd(n,remainders[0][i]/n)));
  return {products,remainders,splits};
}
/** Independent O(K²) route: exactly K(K-1)/2 pairwise GCD operations. */
export function pairwiseGcd(ns:bigint[]):{splits:CorpusSplit[];comparisons:number} {
  validate(ns);const raw=ns.map(()=>1n),factors:(bigint|null)[]=ns.map(()=>null);
  const shared=ns.map(()=>[] as number[]),repeated=ns.map(()=>[] as number[]);let comparisons=0;
  for(let i=0;i<ns.length;i++)for(let j=i+1;j<ns.length;j++){
    const g=gcd(ns[i],ns[j]);comparisons++;
    if(g===1n)continue;
    shared[i].push(j);shared[j].push(i);
    for(const index of [i,j]){
      raw[index]=gcd(ns[index],raw[index]*g);
      if(g<ns[index])factors[index]=g<ns[index]/g?g:ns[index]/g;
    }
    if(ns[i]===ns[j]){repeated[i].push(j);repeated[j].push(i);}
  }
  return {comparisons,splits:ns.map((n,i)=>({raw:raw[i],factor:factors[i],sharedWith:shared[i],repeated:repeated[i],fallback:raw[i]===n}))};
}
