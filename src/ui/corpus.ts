import { el, table, verdict } from './dom';
import type { Runner } from './runner';
import { BUILD } from './build';
import { validateCorpus, type CorpusContext } from '../corpus/generate';
import { birthdayPrediction } from '../corpus/birthday';
import { DEFAULT_PARAMS, algorithmMeta, type AlgorithmId } from '../factor/types';
import { describeShape } from '../verify/verify';
import type { SerializedCorpus, SerializedCorpusAttack, SerializedOutcome } from '../worker/protocol';

export const CORPUS_NEGATIVE_CLAIM='The four bounded per-key searches found no factor, yet the same public key was factored by the corpus. Giving up is not a certificate of security.';
const AUDIT:AlgorithmId[]=['trial','fermat','pminus1','pplus1'];
const CAP_MS=200;
function button(id:string,text:string):HTMLButtonElement{return el('button',{id,type:'button',class:'btn',text});}
function field(label:string,input:HTMLElement):HTMLElement{return el('div',{class:'corpus-field'},el('label',{for:input.id,text:label}),input);}

export function mountCorpusPanel(root:HTMLElement,runner:Runner):()=>void {
  const keyCount=el('input',{id:'corpus-count',type:'number',min:'2',max:'128',value:'64'});
  const entropy=el('input',{id:'corpus-entropy',type:'range',min:'1',max:'24',value:'10',step:'1'});
  const entropyLabel=el('output',{for:'corpus-entropy',id:'corpus-entropy-label'});
  const bits=el('select',{id:'corpus-bits'},...[256,512,1024].map(n=>el('option',{value:String(n),text:`${n}-bit primes${n>256?' · real-size moduli':''}`})));
  const seed=el('input',{id:'corpus-seed',type:'text',value:'c0ffee',maxlength:'64',spellcheck:'false'});
  const generate=button('corpus-generate','Generate corpus'),batch=button('corpus-batch','Run batch GCD'),naive=button('corpus-naive','Run naive'),cancel=button('corpus-cancel','Cancel');
  const prediction=el('div',{id:'corpus-prediction'}),status=el('p',{id:'corpus-status',role:'status'}),generation=el('p',{id:'corpus-generation'});
  const treeBox=el('div',{id:'corpus-trees',class:'corpus-trees'}),results=el('div',{id:'corpus-results'}),negative=el('div',{id:'corpus-negative-fixture'});
  const victim=el('select',{id:'corpus-victim'}),audit=button('corpus-audit','Audit selected key'),auditBox=el('div',{id:'corpus-audit-result'});
  const exportButton=button('corpus-export','Export run'),linkButton=button('corpus-link','Copy permalink'),chart=el('div',{id:'corpus-timings'});
  let generated:SerializedCorpus|null=null,attacked:SerializedCorpusAttack|null=null,naiveResult:SerializedCorpusAttack|null=null;
  let ctx:CorpusContext|null=null,busy=false,epoch=0,auditRows:SerializedOutcome[]=[],auditVictim=-1;
  const history:{ctx:CorpusContext;batch:number|null;naive:number|null}[]=[];
  const partial={product:new Map<number,number[]>(),remainder:new Map<number,number[]>()};
  const inputs=[keyCount,entropy,bits,seed];
  const fingerprint=():string=>JSON.stringify(inputs.map(input=>input.value));
  const context=():CorpusContext=>{const c={K:Number(keyCount.value),s:Number(entropy.value),bits:Number(bits.value),seed:seed.value.toLowerCase()};validateCorpus(c);if(![256,512,1024].includes(c.bits))throw new Error('Choose a supported prime size.');return c;};
  const q=new URL(window.location.href).searchParams;
  const rejected:string[]=[];
  for(const [name,input]of [['ck',keyCount],['cs',entropy],['cb',bits],['cseed',seed]] as const){
    const value=q.get(name);if(value===null)continue;
    const n=Number(value),valid=name==='cseed'?/^[0-9a-f]{1,64}$/i.test(value):/^\d+$/.test(value)&&Number.isInteger(n)&&(name==='ck'?n>=2&&n<=128:name==='cs'?n>=1&&n<=24:[256,512,1024].includes(n));
    if(valid)input.value=value;else rejected.push(name);
  }
  let previous=fingerprint();
  function controls():void {
    generate.disabled=busy;batch.disabled=busy||!generated;naive.disabled=busy||!generated;cancel.disabled=!busy;
    audit.disabled=busy||!generated;victim.disabled=busy||!generated;exportButton.disabled=busy||!generated;
  }
  function predict():void {
    entropyLabel.textContent=`${entropy.value} entropy bits`;entropy.setAttribute('aria-valuetext',`${entropy.value} entropy bits`);
    prediction.replaceChildren();
    try{
      const c=context(),p=birthdayPrediction(c.K,c.s);
      prediction.append(el('p',{id:'corpus-expected',text:`Prediction before rejection: ${2*c.K} prime draws from ${2**c.s} seeds; C(2K,2)/2^s = ${p.expectedPairs.toFixed(6)} colliding draw pairs. Probability of at least one collision ≈ ${(100*p.collisionProbability).toFixed(6)}%.`}),
        el('details',{},el('summary',{text:'Exact birthday-model probability'}),el('p',{text:`${p.exactNumerator}/${p.exactDenominator}`})),
        el('p',{class:'small',text:'This is the independent-draw birthday model. Generation rejects equal seeds within one key, so the measured count omits those pairs. Different seeds can also map to the same prime; the public GCD checks decide what actually factors.'}));
    }catch(error){prediction.append(verdict('fail',(error as Error).message));}
  }
  function treeRender(cancelled=false):void {
    treeBox.replaceChildren();
    for(const kind of ['product','remainder'] as const){
      const region=el('div',{class:'corpus-tree-scroll',role:'region',tabindex:'0','aria-label':`${kind} tree node bit lengths`});
      region.append(el('h3',{text:`${kind==='product'?'Product tree ↑':'Remainder tree ↓'}${cancelled?' · cancelled, partial levels':''}`}));
      const levels=[...partial[kind]].sort((a,b)=>kind==='product'?a[0]-b[0]:b[0]-a[0]);
      for(const [level,lengths]of levels){
        const row=el('div',{class:'corpus-tree-level','data-tree':kind,'data-level':String(level)});
        row.append(el('strong',{text:`Level ${level}: `}));
        lengths.forEach((n,i)=>row.append(el('span',{class:'corpus-node','data-node':String(i),'data-bits':String(n),text:`${n} bits`})));
        region.append(row);
      }
      treeBox.append(region);
    }
  }
  function renderKeys():void {
    results.replaceChildren();if(!generated)return;
    const rows=generated.keys.map((key,i)=>{
      const details=el('details',{},el('summary',{text:`N${i} · ${BigInt(key.n).toString(2).length} bits`}),el('code',{'data-modulus':String(i),text:key.n}));
      if(!attacked)return [String(i),details,'Not attacked','Not checked'];
      const split=attacked.splits[i],v=attacked.verdicts[i],recovered=v.status==='verified'&&v.fullyFactored;
      const result=verdict(recovered?'alarm':v.status==='refuted'?'fail':'idle',recovered?'COMPROMISED':split.repeated.length?'Repeated modulus':'Shares nothing factored in this corpus',split.factor===null&&split.repeated.length?'The same key twice — gcd cannot split an identical modulus.':undefined);
      result.setAttribute('data-key',String(i));result.setAttribute('data-compromised',String(recovered));
      if(recovered)result.append(el('code',{'data-factor':String(i),text:split.factor!}));
      result.append(el('p',{'data-raw-gcd':String(i),text:`g${i} = ${split.raw}${split.fallback?' · pairwise fallback required':''}`}));
      const verified=el('span',{'data-verified':String(i),text:recovered?`VERIFIED: p × q = N; both pass Miller–Rabin (${v.factors.map(f=>f.bases).join(', ')} bases).`:v.reason});
      return [String(i),details,result,el('span',{'data-shares':String(i),text:split.sharedWith.length?split.sharedWith.join(', '):'none'}),verified];
    });
    results.append(table(attacked?['Key','Public modulus','Recovery','Shares a prime with key','Independent verifier']:['Key','Public modulus','Recovery','Verifier'],rows,'Corpus public keys and verified recoveries'));
    if(attacked){
      const count=attacked.verdicts.filter(v=>v.status==='verified'&&v.fullyFactored).length;
      const keyPairs=attacked.splits.reduce((sum,s)=>sum+s.sharedWith.length,0)/2;
      results.prepend(verdict(count?'alarm':'idle',count?`${count} OF ${generated.keys.length} KEYS COMPROMISED`:'NO SHARED PRIME FACTORIZATION IN THIS CORPUS',count?'A recovered factor compromises the key.':'This is a result about this corpus, not a claim that any key is secure.'));
      results.append(el('p',{id:'corpus-observed',text:`Observed seed-draw collision pairs: ${generated.observedSeedPairs}. Public key pairs with GCD > 1: ${keyPairs}. These are different counts: one pair of keys can share both primes.`}));
    }
    negativeRender();
  }
  function negativeRender():void {
    negative.replaceChildren();if(!generated||!attacked||auditRows.length!==4||auditVictim!==Number(victim.value))return;
    const i=auditVictim,shape=describeShape(BigInt(generated.keys[i].n));
    if(auditRows.every(r=>r.p===null)&&shape.perfectPower===null&&attacked.verdicts[i].fullyFactored){
      negative.append(verdict('alarm','BOUNDED PER-KEY SEARCHES GAVE UP — AND FACTORED',`Key ${i}; trial division, Fermat, p−1 and p+1; default parameters, ${CAP_MS} ms cap each. Not a perfect power.`),el('p',{id:'corpus-negative',text:CORPUS_NEGATIVE_CLAIM}));
    }
  }
  function charts():void {
    chart.replaceChildren();if(!history.length)return;
    chart.append(el('h3',{text:'Naive versus batch · only measured runs'}));
    const maximum=Math.max(1,...history.flatMap(h=>[h.batch??0,h.naive??0]));
    for(const h of history){
      const row=el('div',{class:'corpus-timing','data-k':String(h.ctx.K)});
      row.append(el('p',{text:`K=${h.ctx.K}; s=${h.ctx.s}; ${h.ctx.bits}-bit primes; seed ${h.ctx.seed}`}));
      for(const [name,ms]of [['Batch',h.batch],['Naive',h.naive]] as const){
        row.append(el('div',{class:'corpus-time-row'},el('span',{text:`${name}: ${ms===null?'not run':ms.toFixed(3)+' ms'}`}),el('span',{class:`corpus-time-bar ${name==='Naive'?'corpus-time-naive':''}`,style:`width:${ms===null?0:100*ms/maximum}%`,'aria-hidden':'true'})));
      }
      chart.append(row);
    }
    chart.append(el('p',{class:'small',text:'Worker wall time for each method, including tree progress and fallback/sharing annotations; verification runs afterward. No extrapolated sizes or fitted curve. Historical measurements retain their own context.'}));
  }
  function retire():void {
    const next=fingerprint();if(next===previous)return;previous=next;epoch++;runner.cancel();busy=false;
    generated=null;attacked=null;naiveResult=null;auditRows=[];ctx=null;victim.replaceChildren();auditBox.replaceChildren();generation.textContent='';negative.replaceChildren();results.replaceChildren();partial.product.clear();partial.remainder.clear();treeBox.replaceChildren();
    status.textContent='Previous corpus, audit and recovery verdicts retired: inputs changed.';predict();controls();
  }
  for(const input of inputs)input.addEventListener(input===entropy?'input':'change',retire);
  seed.addEventListener('input',retire);keyCount.addEventListener('input',retire);
  cancel.addEventListener('click',()=>{epoch++;runner.cancel();busy=false;attacked=null;negative.replaceChildren();status.textContent='Cancelled. No recovery verdict from this run will publish.';treeRender(true);renderKeys();controls();});
  generate.addEventListener('click',async()=>{
    let selected:CorpusContext;try{selected=context();}catch(error){status.textContent=(error as Error).message;return;}
    const version=++epoch;runner.cancel();busy=true;generated=null;attacked=null;naiveResult=null;auditRows=[];auditBox.replaceChildren();negative.replaceChildren();results.replaceChildren();generation.textContent='';partial.product.clear();partial.remainder.clear();treeBox.replaceChildren();ctx=selected;
    status.textContent='Previous results retired. Generating a fresh replay of this context…';controls();
    const response=await runner.corpus({kind:'corpus',operation:'generate',...selected},p=>{if(version===epoch)status.textContent=`Generating ${p.done}/${p.total}: ${p.note}.`;});
    if(version!==epoch)return;busy=false;
    if(!response.ok){status.textContent=response.kind==='cancelled'?'Cancelled.':response.message;controls();return;}
    generated=response.result as SerializedCorpus;
    generation.textContent=`Generated ${generated.keys.length} moduli in ${generated.ms.toFixed(1)} ms; ${generated.distinctSeeds} distinct seeds; ${generated.rejectedEqual} equal-seed/prime choices rejected inside a key.`;
    victim.replaceChildren(...generated.keys.map((_,i)=>el('option',{value:String(i),text:`Key ${i}`})));
    status.textContent='Corpus ready. Only public moduli are shown; run either public attack.';renderKeys();controls();
  });
  async function attack(operation:'batch'|'naive'):Promise<void>{
    if(!generated||!ctx)return;const version=++epoch;busy=true;controls();
    if(operation==='batch'){attacked=null;negative.replaceChildren();partial.product.clear();partial.remainder.clear();treeBox.replaceChildren();renderKeys();}
    status.textContent=`Running ${operation==='batch'?'batch GCD':'all pairwise GCDs'}…`;
    const response=await runner.corpus({kind:'corpus',operation,moduli:generated.keys.map(k=>k.n)},p=>{
      if(version!==epoch)return;status.textContent=p.note;
      if(p.stage!=='generate'&&p.level!==undefined&&p.bitLengths){partial[p.stage].set(p.level,p.bitLengths);treeRender();}
    });
    if(version!==epoch)return;busy=false;
    if(!response.ok){status.textContent=response.kind==='cancelled'?'Cancelled.':response.message;controls();return;}
    const result=response.result as SerializedCorpusAttack;
    if(operation==='batch'){
      attacked=result;result.products.forEach((row,i)=>partial.product.set(i,row));result.remainders.forEach((row,i)=>partial.remainder.set(i,row));treeRender();
      if(auditRows.length===0){const first=result.verdicts.findIndex(v=>v.fullyFactored);if(first>=0)victim.value=String(first);}
    }else naiveResult=result;
    let point=history.find(h=>JSON.stringify(h.ctx)===JSON.stringify(ctx));if(!point){point={ctx:{...ctx},batch:null,naive:null};history.push(point);}
    point[operation]=result.ms;charts();
    status.textContent=`${operation==='batch'?'Batch GCD':'Naive'} completed in ${result.ms.toFixed(3)} ms${result.comparisons===null?'':`; ${result.comparisons} pairwise comparisons`}.`;
    if(attacked&&naiveResult){
      const same=JSON.stringify(attacked.splits.map(s=>[s.raw,s.factor]))===JSON.stringify(naiveResult.splits.map(s=>[s.raw,s.factor]));
      status.textContent+=same?' Both routes agree on every raw GCD and factor.':' ERROR: the two routes disagree.';
    }
    renderKeys();controls();
  }
  batch.addEventListener('click',()=>void attack('batch'));naive.addEventListener('click',()=>void attack('naive'));
  victim.addEventListener('change',()=>{auditRows=[];auditVictim=-1;auditBox.replaceChildren(el('p',{text:'Audit retired: selected key changed.'}));negative.replaceChildren();});
  audit.addEventListener('click',async()=>{
    if(!generated||!ctx)return;const version=++epoch,index=Number(victim.value),n=BigInt(generated.keys[index].n);busy=true;auditRows=[];auditVictim=index;negative.replaceChildren();auditBox.replaceChildren();controls();
    const shape=describeShape(n);auditBox.append(el('p',{id:'corpus-shape',text:shape.perfectPower?`Perfect power: ${shape.perfectPower.base}^${shape.perfectPower.exponent}`:'Not a perfect power (computed by describeShape).'}));
    for(const id of AUDIT){
      status.textContent=`Auditing key ${index}: ${algorithmMeta(id).name}, ${CAP_MS} ms cap.`;
      const result=await runner.factor(id,n,{...DEFAULT_PARAMS},CAP_MS,ctx.seed);
      if(version!==epoch)return;
      if(!result.ok){busy=false;status.textContent=result.kind==='cancelled'?'Audit cancelled.':result.message;controls();return;}
      auditRows.push(result.outcome);const out=result.outcome;
      const row=verdict(out.p===null?'idle':'alarm',`${algorithmMeta(id).name}: ${out.p===null?'GAVE UP':'FACTOR FOUND'}`,`${out.ms.toFixed(3)} ms. ${out.trace.gaveUp?.reason??'A factor was returned.'}`);
      row.setAttribute('data-audit',id);auditBox.append(row);
    }
    busy=false;status.textContent='Four bounded single-key searches completed. Their limits are not a security proof.';negativeRender();controls();
  });
  exportButton.addEventListener('click',()=>{
    const data={schema:'crypto-lab-factor-forge/corpus@1',build:BUILD,environment:{userAgent:navigator.userAgent},context:ctx,generated:generated?{moduli:generated.keys.map(k=>k.n),ms:generated.ms,distinctSeeds:generated.distinctSeeds}:null,attack:attacked,naive:naiveResult,audit:{victim:auditVictim,params:DEFAULT_PARAMS,capMs:CAP_MS,rows:auditRows}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=el('a',{href:url,download:'factor-forge-corpus.json'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);
  });
  linkButton.addEventListener('click',async()=>{
    try{const c=context(),url=new URL(window.location.href);url.search='';url.hash='';url.searchParams.set('tab','corpus');for(const [k,v]of Object.entries({ck:c.K,cs:c.s,cb:c.bits,cseed:c.seed,cbuild:BUILD.commit}))url.searchParams.set(k,String(v));await navigator.clipboard.writeText(url.toString());status.textContent='Corpus permalink copied with K, entropy, prime size, seed and build.';}catch(error){status.textContent=`Could not copy permalink: ${(error as Error).message}`;}
  });
  root.replaceChildren(el('h2',{text:'Shared Primes · one method needs many keys'}),el('p',{text:'Each key looks large. A small seed pool can still make different keys reuse a prime. Generate public teaching moduli, predict collisions, then recover factors with a product tree and a remainder tree.'}),
    el('div',{class:'corpus-controls'},field('Key count K',keyCount),el('div',{class:'corpus-field'},el('label',{for:entropy.id,text:'Entropy s (bits)'}),entropy,entropyLabel),field('Prime size',bits),field('Replay seed (hex)',seed)),prediction,
    el('div',{class:'corpus-actions'},generate,batch,naive,cancel,exportButton,linkButton),status,generation,
    el('p',{class:'small',text:'The 40-digit cap belongs to Factor N only. Corpus moduli are full size because shared-prime GCD does not need a small N. Browser limit: 128 keys. Local generation checks measured 128 keys with 256-bit primes in 1.96 s, and 16 with 1024-bit primes in 9.95 s; these are measurements on one machine, not promises for yours.'}),
    el('p',{text:'This teaching generator uses the existing non-cryptographic xoshiro256** with one seed per prime. The seed space is the failure: a CSPRNG seeded from the same 2^s states would also repeat primes. Equal seeds within a key are rejected. Parameters and moduli stay in memory unless you explicitly export them.'}),
    el('p',{text:'Multiply adjacent nodes upward to P = ∏Nᵢ. Reduce downward modulo each subtree product squared, ending with zᵢ = P mod Nᵢ². Then gᵢ = gcd(Nᵢ, zᵢ/Nᵢ). If gᵢ = Nᵢ, use pairwise GCD fallback; an identical modulus alone cannot be split.'}),treeBox,results,
    el('h3',{text:'A single-key audit, then the corpus'}),field('Victim public key',victim),audit,el('p',{class:'small',text:`Trial bound ${DEFAULT_PARAMS.trialBound}; Fermat step bound ${DEFAULT_PARAMS.fermatSteps}; p−1/p+1 smoothness bound ${DEFAULT_PARAMS.smoothBound}; ${CAP_MS} ms per search. A time cap can stop the same search at a different point on another machine.`}),auditBox,negative,chart,
    el('p',{},'Published comparison, not this browser: Heninger et al. processed 11,170,883 distinct RSA moduli in 5.5 hours on one core (2012, §3.3). ',el('a',{href:'https://factorable.net/weakkeys12.conference.pdf',text:'Read Mining Your Ps and Qs'}),'. The product/remainder-tree method is credited there to Bernstein; ',el('a',{href:'https://nymity.ch/anomalous-tor-keys/bibliography/pdf/Bernstein04.pdf',text:'his 2004-05-10 draft'}),' gives the tree method. ',el('a',{href:'https://eprint.iacr.org/2012/064',text:'Lenstra et al., ePrint 2012/064'}),' independently reported weak keys.'),
    el('p',{class:'small',text:'Not performed here: scanning internet keys; splitting identical repeated moduli; the boot-time low-entropy-p / later-high-entropy-q model; scaled remainder trees or further Bernstein speedups; the number field sieve. This is the symmetric low-entropy seed model from Katz–Lindell §12.5.6.'}));
  if(q.has('cbuild')&&q.get('cbuild')!==BUILD.commit)status.textContent='The permalink names a different build. Old results are retired; new runs use the build shown in the footer.';
  if(rejected.length)status.textContent+=` Rejected invalid corpus permalink fields: ${rejected.join(', ')}. Their defaults are in use.`;
  predict();controls();return ()=>{};
}
