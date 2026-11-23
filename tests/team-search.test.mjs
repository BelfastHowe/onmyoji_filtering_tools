import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ruleFiles,ruleText,rulesDir} from '../app/rules.ts';
import {createTeamEngine} from '../app/teamEngine.ts';
import {optimizeWorker} from '../app/workerSearch.ts';

const workerFile='calculatorWorker-309b3933.js';
test('Sea P2 checks Tamamo against a full-health first wave with two pieces of Mind’s Eye',
  {skip:Object.keys(ruleFiles).some(file=>!existsSync(join(rulesDir,file)))},async()=>{
    const gear=[];
    function loadout(hero,suits,evenMains,sub){
      const fixedMains=['攻击','防御','生命'];
      const values={攻击:486,防御:104,生命:2052,暴击伤害:89,速度:57};
      for(const [i,suitId] of suits.entries()){
        const main=i%2?evenMains[(i-1)/2]:fixedMains[i/2];
        gear.push({id:hero+i,suitId,pos:i+1,main:[main,values[main]??55],level:15,quality:6,sub});
      }
    }
    loadout('inaba',Array(6).fill(300019),['生命加成','生命加成','暴击伤害'],{暴击伤害:40});
    loadout('yue',Array(6).fill(300002),Array(3).fill('防御加成'),{防御:30});
    const damageMains=['攻击加成','攻击加成','暴击'];
    loadout('susano',[300083,300083,300083,300083,300077,300077],damageMains,{暴击:10,速度:4,暴击伤害:30,攻击加成:12});
    loadout('hannya',[300030,300030,300030,300030,300052,300052],damageMains,{暴击:10,速度:6,暴击伤害:30,攻击加成:12});
    gear.push({...gear.find(s=>s.id==='hannya4'),id:'spare-fifth-slot'});
    loadout('tamamo',[300022,300022,300079,300079,300079,300079],['速度','攻击加成','暴击'],{暴击:10,速度:13,攻击加成:12,暴击伤害:18});
    const engine=createTeamEngine();engine.setInventory(gear);
    const result=await engine.run('永生之海 P2',1,true,true);
    const member=result.members.find(m=>m.hero==='玉藻前'&&m.chosen);
    assert.deepEqual(member?.ids.slice().sort(),gear.slice(-6).map(s=>s.id));
    assert.match(member.skill,/三技能/);
  });
test('bounded search preserves the reference winner, ties and secondary-sort candidate list',
  {skip:!existsSync(join(rulesDir,workerFile))?'需要本地魔方规则包':false},()=>{
    const original=ruleText(workerFile);
    function worker(source){
      const ctx=createContext({});
      runInContext('globalThis.self=globalThis;globalThis.close=()=>{};globalThis.onmessage=null;globalThis.postMessage=r=>globalThis.result=r',ctx);
      runInContext(source,ctx);
      return message=>{
        ctx.request=JSON.stringify({data:{message}});
        return JSON.parse(runInContext('onmessage(JSON.parse(request));JSON.stringify(result.bulkRes)',ctx));
      };
    }
    const reference=worker(original),local=worker(optimizeWorker(original));
    const partitions=[300048,300036].map(suit=>Array.from({length:6},(_,pos)=>Array.from({length:3},(_,i)=>({
      id:[suit,pos,i].join('-'),suit_id:pos<4?suit:300052,pos,preComputedAttack:pos*7+i,
      preComputedAttackRate:(i+pos)/55,preComputedCritPower:(2-i+pos)/44,preComputedSpeed:(pos+i)%4*2,
      preComputedCritRate:(2-i)/10,preComputedHp:100*i,preComputedHpRate:i/12,
      preComputedDefense:pos+i,preComputedDefenseRate:i/11,preComputedEffectHitRate:i/15
    }))));
    for(const target of [{value:'Damage'},{value:'Defense',sort:'asc'},{value:'Speed'},{value:'Damage',x2nd:{value:'Speed',sort:'asc'}}]){
      const job={id:0,yuhunComboChunk:partitions,hero:'天照',target,knownSuitGain:{},haveUnknownSuit:true,
        preComputedPropsLimit:{Speed:{min:9,max:24},CritRate:{min:0.4}},extraProps:{},unknownTeamBonus:{},isPve:true};
      const want=reference(job),got=local(job);
      assert.ok(want.length>0);
      const values=rows=>rows.map(row=>[row.value,row.suit.map(s=>s.id)]);
      assert.deepEqual(values(got),values(target.x2nd?want:want.slice(0,1)));
    }
  });
