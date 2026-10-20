/** Birthday model before rejection of equal seeds within each key. */
export function birthdayPrediction(K:number,s:number):{expectedPairs:number;collisionProbability:number;exactNumerator:bigint;exactDenominator:bigint} {
  const draws=2*K,states=2**s;
  if(!Number.isInteger(K)||K<1||!Number.isInteger(s)||s<1||s>24)throw new Error('INVALID_BIRTHDAY_CONTEXT');
  let logNoCollision=0,numerator=1n,denominator=1n;
  for(let i=0;i<draws;i++){
    if(i>=states)return {expectedPairs:draws*(draws-1)/(2*states),collisionProbability:1,exactNumerator:1n,exactDenominator:1n};
    numerator*=BigInt(states-i);denominator*=BigInt(states);
    logNoCollision+=Math.log1p(-i/states);
  }
  let a=denominator-numerator,b=denominator;
  while(b)[a,b]=[b,a%b];
  return {expectedPairs:draws*(draws-1)/(2*states),collisionProbability:-Math.expm1(logNoCollision),exactNumerator:(denominator-numerator)/a,exactDenominator:denominator/a};
}
