// Mutations run only on a committed, clean source baseline. Each is built, killed,
// restored byte-for-byte, rebuilt and tested green before the next begins.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); process.chdir(root);
const config = process.env.PLAYWRIGHT_CONFIG;
const browser = title => ['npx', ['playwright','test','e2e/claims.spec.ts','--project=claims','--grep',title,'--workers=1','--retries=0',...(config ? ['--config',config] : [])]];
const unit = title => ['npx',['vitest','run','src/corpus/corpus.test.ts','-t',title]];
const build = ['npm',['run','build']];
const run = ([cmd,args]) => {
 const env={...process.env,CI:'1'};
 if(cmd==='npx'&&args[0]==='playwright')env.MUTATION_ASSETS=JSON.stringify(Object.fromEntries(readdirSync('dist/assets').filter(p=>p.endsWith('.js')).map(p=>[p,createHash('sha256').update(readFileSync(join('dist/assets',p))).digest('hex')])));
 return spawnSync(cmd,args,{cwd:root,encoding:'utf8',env});
};
const pass = (cmd,label) => { const r=run(cmd); if(r.status!==0) throw Error(`${label}\n${r.stdout}\n${r.stderr}`); return r; };
const hash = () => { const h=createHash('sha256'); const walk=d=>{for(const e of readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(d,e.name); if(e.isDirectory())walk(p);else {h.update(p);h.update(readFileSync(p));}}};walk('dist');return h.digest('hex'); };
const cases = [
 ['wrong remainder modulus','src/corpus/batchgcd.ts','%(n*n)','%n',unit('batch and independent pairwise raw gcds')],
 ['missing leaf division','src/corpus/batchgcd.ts','gcd(n,remainders[0][i]/n)','gcd(n,remainders[0][i])',browser('corpus public GCD transcript')],
 ['fresh primes ignore repeated seeds','src/corpus/generate.ts',
  'const prime=(r:number):bigint=>{if(!cache.has(r))cache.set(r,primeFromSeed(r,ctx.bits));return cache.get(r)!;};',
  'const prime=(_r:number):bigint=>randomPrime(ctx.bits);',browser('corpus observed collisions')],
 ['verifier bypass','src/corpus/verify.ts',
  'verifyFactorization({n:ns[i],p:split.factor,q:split.factor===null?null:ns[i]/split.factor})',
  "(void verifyFactorization, void ns[i], void split.factor, {status:'no-claim',product:null,productMatchesN:false,factors:[],fullyFactored:false,reason:'Verifier bypassed'} as Verdict)",unit('every corpus result goes through the original verifier')],
 ['compromise painted green','src/ui/corpus.ts',"recovered?'alarm':v.status", "recovered?'pass':v.status",browser('corpus public GCD transcript')],
 ['missing negative claim','src/ui/corpus.ts',
  "export const CORPUS_NEGATIVE_CLAIM='The four bounded per-key searches found no factor, yet the same public key was factored by the corpus. Giving up is not a certificate of security.';",
  "export const CORPUS_NEGATIVE_CLAIM='';",browser('corpus negative claim')],
];
const dirty=spawnSync('git',['diff','--exit-code','--',...new Set(cases.map(x=>x[1]))],{encoding:'utf8'});
if(dirty.status!==0)throw Error('Commit the source baseline before mutation checks.');
pass(build,'baseline build');const baseline=hash();const evidence=[];
mkdirSync('mutation-logs',{recursive:true});
for(const [name,file,before,after,command] of cases){
 pass(command,`${name}: baseline test`);
 const original=readFileSync(file,'utf8');if(original.split(before).length!==2)throw Error(`${name}: expected one mutation site`);
 let mutant;
 try{
  writeFileSync(file,original.replace(before,after));
  const diff=spawnSync('git',['diff','--',file],{encoding:'utf8'}).stdout;if(!diff.trim())throw Error(`${name}: empty diff`);
  pass(build,`${name}: mutant build`); mutant=hash();if(mutant===baseline)throw Error(`${name}: bundle did not move`);
  const r=run(command);writeFileSync(`mutation-logs/${name.replaceAll(' ','-')}.log`,r.stdout+r.stderr);
  if(r.status===0 || /MUTATION_ASSET_MISMATCH/.test(r.stdout+r.stderr) || !/expect\(|AssertionError|Error: expect/.test(r.stdout+r.stderr))throw Error(`${name}: no assertion kill\n${r.stdout}\n${r.stderr}`);
  evidence.push({name,sourceDiff:diff,baseline,mutant,namedTest:command[1].includes('--grep') ? command[1][command[1].indexOf('--grep')+1] : command[1].at(-1),assertionFailure:true,retries:0,servedAssetGuard:true});
 }finally{writeFileSync(file,original);pass(build,`${name}: restore build`);if(hash()!==baseline)throw Error(`${name}: restored hash differs`);pass(command,`${name}: restored test`);}
 evidence.at(-1).restoredGreen=true;console.log(`${name}: killed; exact artifact restored; owning test green`);
}
writeFileSync('mutation-evidence.json',JSON.stringify(evidence,null,2)+'\n');
