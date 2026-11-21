import test from 'node:test';
import assert from 'node:assert/strict';
import { extraRolls, formatStat, gearBonuses, heroForMetric } from '../app/gearPanel.ts';

const example=Array.from({length:6},(_,i)=>({
  id:String(i),pos:i+1,suitId:i<4?300048:300052,main:i===0?['攻击','486']:['生命加成','5.00%'],
  sub:{防御:3,暴击:2},fixed:i>=4?['攻击加成','8.00%']:null,
  rolls:[['critRateAdditionVal',1],['critRateAdditionVal',0.9]]
}));
test('gear panel uses the preset base, one bonus per set, innate stats and gear-only deltas',()=>{
  const hero=heroForMetric('pve/须佐之男/狂骨/荒骷髅');
  const stats=Object.fromEntries(gearBonuses([...example].reverse(),hero).map(s=>[s.label,s.value]));
  assert.ok(Math.abs(stats.攻击-(486+4154*.31))<1e-8);
  assert.equal(stats.生命,11735*.25);
  assert.equal(stats.暴击,12);assert.equal(stats.防御,18);assert.equal(stats.速度,0);
  assert.equal(heroForMetric('pve/inaba/fire').name,'因幡辉夜姬');
  assert.equal(heroForMetric('pve/yue/defense').defense,538);
  assert.equal(gearBonuses(example,heroForMetric('speed/loose/1')),null);
  assert.equal(gearBonuses(example.slice(1),hero),null);
  assert.equal(gearBonuses(Array(6).fill(example[0]),hero),null);
});
test('detail formats points and percentage points and counts upgrades beyond the initial roll',()=>{
  assert.equal(formatStat('攻击加成','8.00%'),'+8.00%');
  assert.equal(formatStat('速度',2.7),'+2.70');
  assert.equal(extraRolls(example[0],'暴击'),1);
  assert.equal(extraRolls(example[0],'防御'),0);
});
