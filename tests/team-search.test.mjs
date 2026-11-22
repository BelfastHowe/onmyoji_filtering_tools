import test from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {ruleText,rulesDir} from '../app/rules.ts';
import {optimizeWorker} from '../app/workerSearch.ts';

const workerFile='calculatorWorker-309b3933.js';
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
