import { presetHeroes, type PresetHero as Hero } from './gearPanel.ts';
import type { Soul } from './domain.ts';
import type { SpeedResult } from './analysis.ts';

const defenseSets=new Set(['招财猫','雪幽魂','魅妖','反枕','日女巳时','珍珠','木魅','出世螺','火之车','奉海图','雨降']);
export const fourSets=['狂骨','海月火玉','伤魂鸟','破势','隐念','镇墓兽','片叶之苇'];
export const bossSets=['土蜘蛛','荒骷髅','鬼灵歌伎'];
const attackSets=new Set(['狂骨','隐念']);
const { 须佐之男:susano, 天照:amaterasu, 玉藻前:tamamo }=presetHeroes;
const popcount=Array.from({length:64},(_,i)=>i.toString(2).replaceAll('0','').length);
const empty=(key:string,name:string):SpeedResult=>({key,name,value:null,ids:[]});
function stat(s:Soul,name:string) {
  return (s.sub[name]??0)+(s.main[0]===name?parseFloat(String(s.main[1])):0)+
    (s.fixed?.[0]===name?parseFloat(String(s.fixed[1])):0);
}

// For a linear objective the best piece in a given set and slot is sufficient.
// Accumulate disjoint groups of slots, crediting each set's two-piece bonus once.
function support(pool:Soul[],defense:boolean,fire:boolean) {
  const result=empty(defense?'pve/yue/defense':fire?'pve/inaba/fire':'pve/inaba/loose',
    defense?'不见岳 · 散件防御':fire?'因幡辉夜姬 · 火灵暴伤 (%)':'因幡辉夜姬 · 散件暴伤 (%)');
  const groups=new Map<string,({id:string;v:number}|undefined)[]>();
  for(const s of pool){
    const main=s.main[0];
    if(s.pos%2===0){
      if(defense && main!=='防御加成')continue;
      if(!defense && (s.pos===6?main!=='暴击伤害':
        !['攻击加成','生命加成','防御加成',...(s.pos===4?['效果抵抗','效果命中']:[])].includes(main)))continue;
    }
    const score=defense?stat(s,'防御')+538*stat(s,'防御加成')/100:stat(s,'暴击伤害');
    let slots=groups.get(s.suit);if(!slots){slots=Array(6);groups.set(s.suit,slots);}
    if(!slots[s.pos-1]||score>slots[s.pos-1]!.v)slots[s.pos-1]={id:s.id,v:score};
  }
  if(fire&&!groups.has('火灵'))return result;
  type Choice={v:number; ids:string[]};
  let dp=new Map<number,Choice>([[0,{v:defense?538:165,ids:[]}]]);
  for(const [set,slots] of groups){
    const choices:{mask:number;v:number;ids:string[]}[]=[];
    for(let mask=0;mask<64;mask++){
      if(fire&&set==='火灵'&&popcount[mask]<4)continue;
      let v=0;const ids:string[]=[];
      for(let i=0;i<6;i++)if(mask&(1<<i)){const s=slots[i];if(s){ids.push(s.id);v+=s.v;}}
      if(ids.length!==popcount[mask])continue;
      if(ids.length>=2)v+=defense?(defenseSets.has(set)?538*.3:0):(set==='无刀取'?20:0);
      choices.push({mask,v,ids});
    }
    const next=new Map<number,Choice>();
    for(const [before,c] of dp)for(const opt of choices){
      if(before&opt.mask)continue;
      const key=before|opt.mask, value=c.v+opt.v;
      if(value>(next.get(key)?.v??-Infinity))next.set(key,{v:value,ids:[...c.ids,...opt.ids]});
    }
    dp=next;
  }
  const win=dp.get(63);if(win){result.value=win.v;result.ids=win.ids;}
  return result;
}

interface Option {id:string;atk:number;cd:number;crit:number;spd:number}
function frontier(list:Option[]) {
  const out:Option[]=[];
  const dominates=(a:Option,b:Option)=>a.atk>=b.atk&&a.cd>=b.cd&&a.crit>=b.crit&&a.spd>=b.spd;
  for(const item of list){
    if(out.some(v=>dominates(v,item)))continue;
    for(let i=out.length-1;i>=0;i--)if(dominates(item,out[i]))out.splice(i,1);
    out.push(item);
  }
  return out.sort((a,b)=>(b.atk+24*b.cd)-(a.atk+24*a.cd));
}

function damage(pool:Soul[],hero:Hero,set:string,boss:string,minSpeed:number,title:string) {
  const key=['pve',hero.name,set,boss].join('/');
  const result=empty(key,title);
  const flexible=hero===amaterasu || (hero===susano && set==='隐念' && boss==='鬼灵歌伎');
  const options=new Map<string,Option[]>();
  for(const s of pool){
    if(s.suit!==set&&s.suit!==boss)continue;
    if(s.pos===2&&s.main[0]!=='攻击加成'&&!(flexible&&s.main[0]==='速度'))continue;
    if(s.pos===4&&s.main[0]!=='攻击加成')continue;
    if(s.pos===6&&!['暴击','暴击伤害'].includes(s.main[0])&&!((flexible||hero===tamamo)&&s.main[0]==='攻击加成'))continue;
    const group=s.pos+':'+s.suit;
    let list=options.get(group);if(!list){list=[];options.set(group,list);}
    list.push({id:s.id, atk:hero.atk*stat(s,'攻击加成')/100+stat(s,'攻击'),cd:stat(s,'暴击伤害'),
      crit:stat(s,'暴击'),spd:minSpeed?stat(s,'速度'):0});
  }
  for(const [key,group] of options)options.set(key,frontier(group));
  for(let mask=0;mask<64;mask++){
    if(popcount[mask]!==4)continue;
    const lists=Array.from({length:6},(_,i)=>options.get((i+1)+':'+(mask&(1<<i)?set:boss))??[]);
    if(lists.some(list=>!list.length))continue;
    lists.sort((a,b)=>a.length-b.length);
    // Independent component maxima are admissible upper bounds: pruning never
    // excludes a better feasible combination simply because its pieces rank lower.
    const upper=Array.from({length:7},()=>({atk:0,cd:0,crit:0,spd:0}));
    for(let i=5;i>=0;i--)for(const k of ['atk','cd','crit','spd'] as const)
      upper[i][k]=upper[i+1][k]+Math.max(...lists[i].map(s=>s[k]));
    const picked:string[]=[];
    function visit(i:number,atk:number,cd:number,crit:number,spd:number){
      const u=upper[i];
      if(crit+u.crit+1e-9<100||spd+u.spd+1e-9<minSpeed)return;
      if((atk+u.atk)*(cd+u.cd)/100<=(result.value??-Infinity))return;
      if(i===6){result.value=atk*cd/100;result.ids=picked.slice();return;}
      for(const s of lists[i]){
        picked.push(s.id);visit(i+1,atk+s.atk,cd+s.cd,crit+s.crit,spd+s.spd);picked.pop();
      }
    }
    visit(0,hero.atk*(attackSets.has(set)?1.15:1),hero.cd,hero.crit+(attackSets.has(set)?0:15),hero.speed);
  }
  return result;
}

export function pveAnalysis(souls:Soul[]) {
  const pool=souls.filter(s=>s.quality===6&&s.level===15);
  const out:SpeedResult[]=[];
  for(const set of fourSets)for(const boss of bossSets)
    out.push(damage(pool,susano,set,boss,0,'须佐之男 · '+set+' / '+boss));
  out.push(damage(pool,amaterasu,'狂骨','鬼灵歌伎',158,'魂土天照 · 狂骨 / 鬼灵歌伎'),
    damage(pool,tamamo,'破势','荒骷髅',128,'超星玉藻前 · 破势 / 荒骷髅'),
    support(pool,false,false),support(pool,false,true),support(pool,true,false));
  return out;
}
