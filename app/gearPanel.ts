import type { Soul } from './domain.ts';
import { soulSets } from './soulSets.ts';

export const rollTypes: Record<string, [string, number]> = {
  speedAdditionVal: ['速度', 3], attackAdditionVal: ['攻击', 27], defenseAdditionVal: ['防御', 5],
  maxHpAdditionVal: ['生命', 114], critRateAdditionVal: ['暴击', 3], critPowerAdditionVal: ['暴击伤害', 4],
  maxHpAdditionRate: ['生命加成', 3], defenseAdditionRate: ['防御加成', 3], attackAdditionRate: ['攻击加成', 3],
  debuffEnhance: ['效果命中', 4], debuffResist: ['效果抵抗', 4]
};

export const presetHeroes = {
  须佐之男: { name:'须佐之男', atk:4154, hp:11735, defense:494, speed:112, crit:12, cd:150 },
  天照: { name:'天照', atk:3886, hp:11963, defense:595, speed:119, crit:12, cd:160 },
  玉藻前: { name:'玉藻前', atk:3350, hp:12532, defense:353, speed:110, crit:12, cd:160 },
  因幡辉夜姬: { name:'因幡辉夜姬', atk:2949, hp:11393, defense:397, speed:113, crit:8, cd:165 },
  不见岳: { name:'不见岳', atk:2492, hp:12532, defense:538, speed:115, crit:8, cd:130 }
};
export type PresetHero = (typeof presetHeroes)[keyof typeof presetHeroes];
const heroByMetric: Record<string, PresetHero> = {
  ...presetHeroes, inaba:presetHeroes.因幡辉夜姬, yue:presetHeroes.不见岳
};
export function heroForMetric(key:string) {
  const [group, hero]=key.split('/');
  return group==='pve' ? heroByMetric[hero] : undefined;
}

export function gearBonuses(souls:Soul[], hero?:PresetHero) {
  if(!hero || souls.length!==6 || new Set(souls.map(s=>s.pos)).size!==6) return null;
  const stats:Record<string,number>={};
  const counts=new Map<number,number>();
  function add(stat:string, value:number|string) {
    stats[stat]=(stats[stat]??0)+parseFloat(String(value));
  }
  for(const soul of souls){
    add(...soul.main);
    if(soul.fixed) add(...soul.fixed);
    for(const [stat,value] of Object.entries(soul.sub)) add(stat,value);
    counts.set(soul.suitId,(counts.get(soul.suitId)??0)+1);
  }
  for(const [id,count] of counts){
    // Only a flat two-piece stat applies before combat. Four/six of one set still grants it once.
    const passive=soulSets[id]?.two.match(/^(攻击加成|生命加成|防御加成|效果命中|效果抵抗|暴击伤害|暴击)(\d+(?:\.\d+)?)%$/);
    if(count>=2 && passive) add(passive[1],passive[2]);
  }
  for(const [label,base] of [['攻击',hero.atk],['生命',hero.hp],['防御',hero.defense]] as const) {
    add(label,base*(stats[label+'加成']??0)/100);
  }
  return ['攻击','暴击','生命','暴击伤害','防御','效果命中','速度','效果抵抗'].map(label=>({label,value:stats[label]??0}));
}

export function formatStat(label:string,value:string|number){
  const percent=['暴击','暴击伤害','效果命中','效果抵抗','攻击加成','生命加成','防御加成'].includes(label);
  const number=parseFloat(String(value));
  return (number<0?'':'+')+number.toFixed(2)+(percent?'%':'');
}

export function extraRolls(soul:Soul,label:string){
  const count=soul.rolls.filter(([key])=>rollTypes[key]?.[0]===label).length;
  return Math.max(0,count-1);
}
