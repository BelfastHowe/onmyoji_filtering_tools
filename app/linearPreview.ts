// The reference calculator partitions by suit first, then enumerates pieces
// with slot one changing fastest. Keep that order when two builds tie.
interface Candidate {
  id:string; pos:number; suit_id:number; preComputedDefense:number;
  preComputedDefenseRate:number; preComputedCritPower:number; preComputedSpeed:number;
}
export function linearPartitions(items:Candidate[],hero:{Defense:number},target:{value:string;sort?:string;x2nd?:unknown},
  filters:{suitCombos?:unknown[];propsLimit?:Record<string,unknown>},bonus:(id:number)=>Record<string,number>){
  if(filters.suitCombos?.length||Object.keys(filters.propsLimit??{}).length||target.x2nd||target.sort==='asc'||
    !['Defense','CritPower','Speed'].includes(target.value))return null;
  const defense=target.value==='Defense';
  function gain(s:Candidate){return defense?s.preComputedDefense+s.preComputedDefenseRate*hero.Defense:
    target.value==='Speed'?s.preComputedSpeed:s.preComputedCritPower;}
  const bySuit=new Map<number,(Candidate|undefined)[]>(),order=Array.from({length:6},()=>new Map<number,number>());
  for(const s of items){
    let slots=bySuit.get(s.suit_id);
    if(!slots){slots=Array(6);bySuit.set(s.suit_id,slots);}
    const rank=order[s.pos];
    if(!rank.has(s.suit_id))rank.set(s.suit_id,rank.size);
    if(!slots[s.pos]||gain(s)>gain(slots[s.pos]!))slots[s.pos]=s;
  }
  type Build={value:number;gear:(Candidate|undefined)[]};
  const earlier=(a:Build,b:Build)=>{
    for(let i=5;i>=0;i--){
      if(a.gear[i]?.suit_id!==b.gear[i]?.suit_id)
        return order[i].get(a.gear[i]!.suit_id)!<order[i].get(b.gear[i]!.suit_id)!;
    }
    return false;
  };
  let states=new Map<number,Build>([[0,{value:0,gear:Array(6)}]]);
  for(const [id,slots] of bySuit){
    const setBonus=bonus(id),points=defense?hero.Defense*(setBonus.DefenseRate||0):(setBonus[target.value]||0);
    const next=new Map(states);
    for(let mask=1;mask<64;mask++){
      const chosen=slots.filter((s,i)=>s&&(mask&(1<<i))) as Candidate[];
      if(chosen.reduce((m,s)=>m|(1<<s.pos),0)!==mask)continue;
      const value=chosen.reduce((v,s)=>v+gain(s),chosen.length>=2?points:0);
      for(const [filled,old] of states){
        if(filled&mask)continue;
        const key=filled|mask,total=value+old.value,previous=next.get(key);
        if(previous&&total<previous.value)continue;
        const build={value:total,gear:old.gear.slice()};
        for(const s of chosen)build.gear[s.pos]=s;
        if(!previous||total>previous.value||earlier(build,previous))next.set(key,build);
      }
    }
    states=next;
  }
  const best=states.get(63);
  return best?[best.gear.map(s=>[s!])]:[];
}
