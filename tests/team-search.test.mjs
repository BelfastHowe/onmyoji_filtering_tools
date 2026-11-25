import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ruleFiles,ruleText,rulesDir} from '../app/rules.ts';
import {createTeamEngine} from '../app/teamEngine.ts';
import {optimizeWorker} from '../app/workerSearch.ts';
import {applyDamageSetRules} from '../app/damageSets.ts';
import {soulSets} from '../app/soulSets.ts';

const workerFile='calculatorWorker-309b3933.js';
test('damage uses four ordinary pieces and two boss pieces; panel sets retain their two-piece threshold',
  {skip:![workerFile,'calculator-70eebf65.js'].every(f=>existsSync(join(rulesDir,f)))},()=>{
    const code=applyDamageSetRules(ruleText('calculator-70eebf65.js'));
    const ctx=createContext({ee:id=>soulSets[id].name});
    runInContext('globalThis.self=globalThis;globalThis.onmessage=null;'+ruleText(workerFile).replace('var lt=On.exports','globalThis.f=On.exports;var lt=On.exports'),ctx);
    const defs=code.slice(code.indexOf('damagePieces=id=>'),code.indexOf(',gt=u=>'));
    const factors=code.slice(code.indexOf('Q=(u,t,e)=>{const n=Ee('),code.indexOf(',Z=(u,t)=>'));
    const {actual,planned,panel}=runInContext(`const b={剩余生命比例:'remainingHpRatio'},${defs},${factors};
      ({actual:Q,planned:(groups,hit,extras)=>ue(_e(groups),hit,extras),panel:Ee})`,ctx);
    function check(groups,hp,expected){
      const extras=hp==null?[]:[{type:'remainingHpRatio',value:hp}];
      const gear=groups.flatMap(({id,count})=>Array.from({length:count},()=>({suit_id:id})));
      for(const value of [actual(gear,0,extras),planned(groups,0,extras)])assert.ok(Math.abs(value-expected)<1e-10);
    }
    const eye=count=>({id:300022,count});
    assert.ok(panel([{suit_id:300022},{suit_id:300022}]).includes('心眼'));
    for(const count of [2,3])for(const hp of [undefined,1,.55,0])check([eye(count)],hp,1);
    for(const count of [4,5,6]){
      for(const [hp,factor] of [[undefined,1],[1,1],[.851,1],[.85,1.1],[.55,1.3],[0,1.6]])check([eye(count)],hp,factor);
    }
    check([eye(4),{id:300030,count:2}],.55,1.3);
    check([eye(2),{id:300030,count:4}],.55,1.4);
    check([eye(4),{id:300052,count:2}],.55,1.3*1.1);
  });
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
