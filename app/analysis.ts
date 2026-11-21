import type { Soul } from './domain.ts';

export const analysisVersion = 'inventory-speed-pve-v2';
export const hitSets = ['招财猫','火灵','遗念火','油赤子','共潜','蚌精','返魂香','魅妖','钟灵','雪幽魂'];
export const dimensions = ['速度','效果命中','效果抵抗','攻击加成','生命加成','防御加成','暴击','暴击伤害'];
export function indicators(s: Soul) {
  const sub=(key:string)=>s.sub[key]??0;
  const sp=sub('速度')/2.7, crit=sub('暴击')/2.7, dmg=sub('暴击伤害')/3.6, atk=sub('攻击加成')/2.7;
  const pct=(sum:number,rolls:number)=>Math.round(sum*100/rolls);
  return { 输出:pct(sp+crit+atk+dmg,9), 孔雀:pct(sp+crit+atk+sub('效果命中')/2.7+dmg,9),
    季:pct(sp+atk+dmg,9), 速度:pct(sp,6), 治疗:pct(sp+crit+sub('生命加成')/2.7+dmg,9),
    命中:pct(sp+sub('效果命中')/3.6,7), 防御输出:pct(sp+crit+sub('防御加成')/2.7+dmg,9) };
}
export const speedValue = (s: Soul) => (s.sub['速度'] ?? 0) +
  (s.main[0] === '速度' ? parseFloat(String(s.main[1])) : 0) +
  (s.fixed?.[0] === '速度' ? parseFloat(String(s.fixed[1])) : 0);
export interface SpeedResult { key: string; name: string; value: number | null; ids: string[] }
export interface SetStats { name: string; count: number; full: number; max: Record<string, number[]>; fullSpeed: number[] }
function mainMatches(s: Soul, attr: string) {
  if (attr === '速度' && s.pos === 2) return s.main[0] === attr;
  if ((attr === '效果命中' || attr === '效果抵抗') && s.pos === 4) return s.main[0] === attr;
  if (attr === '暴击伤害' && s.pos === 6) return s.main[0] === attr;
  return true;
}
export function inventoryStats(souls: Soul[]) {
  const groups = new Map<string, SetStats>();
  for (const soul of souls) {
    let group = groups.get(soul.suit);
    if (!group) {
      group = { name: soul.suit, count: 0, full: 0, fullSpeed: Array(6).fill(0),
        max: Object.fromEntries(dimensions.map(d => [d, Array(6).fill(0)])) };
      groups.set(soul.suit, group);
    }
    group.count++;
    if (soul.level === 15 && soul.quality === 6) group.full++;
    if (mainMatches(soul, '速度') && Math.ceil((soul.sub['速度'] ?? 0) / 3) >= 6) group.fullSpeed[soul.pos - 1]++;
    for (const dim of dimensions) {
      if (mainMatches(soul, dim)) group.max[dim][soul.pos - 1] = Math.max(group.max[dim][soul.pos - 1], soul.sub[dim] ?? 0);
    }
  }
  return [...groups.values()].sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
}
// Force a four-piece set in each of the 15 possible position selections.
// For a fixed selection, each position can be maximized independently.
const fourSlots = Array.from({ length: 64 }, (_, mask) => mask)
  .filter(mask => mask.toString(2).replaceAll('0', '').length === 4);
export function speedAnalysis(souls: Soul[]): SpeedResult[] {
  const slots: Soul[][] = Array.from({length: 6}, () => []);
  for (const s of souls) {
    if (s.quality === 6 && s.level === 15 && (s.pos !== 2 || s.main[0] === '速度')) slots[s.pos-1].push(s);
  }
  for (const slot of slots) slot.sort((a,b) => speedValue(b)-speedValue(a) || a.id.localeCompare(b.id));
  const results: SpeedResult[] = [];
  function solve(key: string, name: string, used: Set<string>, suit?: string, fourth?: string, sixth?: string) {
    const options = slots.map((list, index) => list.filter(s => !used.has(s.id) &&
      (index !== 3 || !fourth || s.main[0] === fourth) && (index !== 5 || !sixth || s.main[0] === sixth)));
    const free = options.map(list => list[0]);
    const forced = suit ? options.map(list => list.find(s => s.suit === suit)) : free;
    const row: SpeedResult = { key, name, value: null, ids: [] };
    for (const mask of suit ? fourSlots : [0]) {
      const picks = free.map((s,i) => mask & (1 << i) ? forced[i] : s);
      if (picks.some(s => !s)) continue;
      const value = picks.reduce((sum,s) => sum + speedValue(s!), 0);
      if (row.value === null || value > row.value) { row.value = value; row.ids = picks.map(s => s!.id); }
    }
    results.push(row);
    for (const id of row.ids) used.add(id);
  }
  for (const [key, label, main, ranks] of [
    ['loose','散件',undefined,5], ['hit','散件命中','效果命中',3], ['resist','散件抵抗','效果抵抗',2]
  ] as const) {
    const used = new Set<string>();
    for (let n=1; n<=ranks; n++) solve(`speed/${key}/${n}`, label+'一二三四五'[n-1]+'速', used, undefined, main);
  }
  for (const suit of [...new Set(souls.map(s => s.suit))].sort()) {
    solve('speed/set/'+suit, suit+'一速', new Set(), suit);
  }
  for (const suit of hitSets) solve('speed/hit-set/'+suit, suit+'命中一速（六号生命）', new Set(), suit,'效果命中','生命加成');
  return results;
}
