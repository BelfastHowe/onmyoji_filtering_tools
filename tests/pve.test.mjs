import test from 'node:test';
import assert from 'node:assert/strict';
import { pveAnalysis } from '../app/pve.ts';

function piece(pos,suit,main,sub,tag='') {
  return {id:[pos,suit,tag].join('-'),suit,suitId:1,pos,quality:6,level:15,main,sub,fixed:null,rolls:[],wornBy:'',locked:false,discarded:false};
}
test('damage optimiser agrees with exhaustive six-slot search under full-crit and 4+2 constraints',()=>{
  const slots=Array.from({length:6},(_,i)=>{
    const p=i+1,main=[['攻击',486],['攻击加成',55],['防御',104],['攻击加成',55],['生命',2052],['暴击',55]][i];
    return ['狂骨','鬼灵歌伎'].flatMap((suit,k)=>[
      piece(p,suit,main,{'攻击':20+p*k,'暴击':8,'暴击伤害':3},'A'),
      piece(p,suit,main,{'攻击':60-p*k,'暴击':1,'暴击伤害':14},'B')]);
  });
  let best=0;
  function enumerate(p,choices){
    if(p<6){for(const s of slots[p])enumerate(p+1,[...choices,s]);return;}
    if(choices.filter(s=>s.suit==='狂骨').length!==4)return;
    if(12+55+choices.reduce((sum,s)=>sum+s.sub.暴击,0)<100)return;
    const attack=4154*(1+.15+1.10)+486+choices.reduce((sum,s)=>sum+s.sub.攻击,0);
    const cd=150+choices.reduce((sum,s)=>sum+s.sub.暴击伤害,0);best=Math.max(best,attack*cd/100);
  }
  enumerate(0,[]);assert.ok(best>0);
  const results=pveAnalysis(slots.flat());assert.equal(results.length,26);
  const win=results.find(r=>r.key==='pve/须佐之男/狂骨/鬼灵歌伎');
  assert.ok(Math.abs(win.value-best)<1e-7);assert.equal(new Set(win.ids).size,6);
  assert.equal(results.find(r=>r.key==='pve/天照/狂骨/鬼灵歌伎').value,null);
});
test('support panels count a two-piece bonus once per suit and enforce four-piece Fire Spirit',()=>{
  const souls=Array.from({length:6},(_,i)=>piece(i+1,'无刀取',[i===5?'暴击伤害':i%2?'攻击加成':'攻击',i===5?89:55],{'暴击伤害':4}));
  const fire=souls.map(s=>({...s,suit:'火灵',id:'f'+s.id,sub:{'暴击伤害':1}}));
  const defensive=Array.from({length:6},(_,i)=>piece(i+1,'招财猫',[i%2?'防御加成':'生命',i%2?55:100],{'防御':5}));
  const rows=pveAnalysis([...souls,...fire,...defensive]);
  assert.equal(rows.find(r=>r.key==='pve/inaba/loose').value,165+89+24+20);
  assert.equal(rows.find(r=>r.key==='pve/inaba/fire').value,165+89+4+8+20);
  assert.ok(Math.abs(rows.find(r=>r.key==='pve/yue/defense').value-(538*(1+1.65+.30)+30))<1e-8);
});
