import {createContext,runInContext} from 'node:vm';
import {ruleText} from './rules.ts';
import type {Soul} from './domain.ts';
import {linearPartitions} from './linearPreview.ts';
import {optimizeWorker} from './workerSearch.ts';
import {applyDamageSetRules} from './damageSets.ts';
import {createHash} from 'node:crypto';

const types:Record<string,string>={攻击:'Attack',速度:'Speed',生命:'Hp',防御:'Defense',暴击:'CritRate',暴击伤害:'CritPower',攻击加成:'AttackRate',生命加成:'HpRate',防御加成:'DefenseRate',效果命中:'EffectHitRate',效果抵抗:'EffectResistRate'};
function attr(name:string,raw:string|number){
  const type=types[name];
  if(!type)throw Error('未识别御魂属性 '+name);
  const value=parseFloat(String(raw));
  return {type,value:['Speed','Attack','Defense','Hp'].includes(type)?value:value/100};
}
export function engineSoul(s:Soul){
  return {id:s.id,suit_id:s.suitId,kind:s.suit,pos:s.pos-1,quality:s.quality,level:s.level,
    base_attr:attr(...s.main),random_attrs:Object.entries(s.sub).map(([k,v])=>attr(k,v)),single_attrs:s.fixed?[attr(...s.fixed)]:[]};
}
export interface Template {scene:string;index:number;name:string;members:string[];seconds?:number;requirements:string[]}
export interface MemberResult {hero:string; pass:boolean; chosen:boolean; ids:string[]; set:string; panel?:Record<string,number>;
  values?:Record<string,number>;goal?:number;damage?:number;remaining?:number; reasons:string[]; skill?:string; notes:string[]}
export interface TeamResult {pass:boolean; remaining:number; members:MemberResult[]}
function portion(source:string,start:string,end:string){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  if(from<0||to<0)throw Error('规则包的结构与版本不匹配');
  return source.slice(from,to);
}
// Bridge the pinned browser engine to one computation thread. No browser UI,
// IndexedDB, filesystem handles, account URLs or HTTP client enter this context.
export function createTeamEngine(originalWorker=false,cache?:{get:(key:string)=>string|undefined;put:(key:string,data:string)=>void}){
  const ctx=createContext(Object.create(null));
  ctx.digest=(key:string)=>createHash('sha256').update(key).digest('hex');
  ctx.readResult=cache?.get;ctx.saveResult=cache?.put;
  function load(source:string){return runInContext(source,ctx);}
  load(`globalThis.self=globalThis;globalThis.onmessage=null;
    globalThis.postMessage=data=>{globalThis.workerResult=data};globalThis.close=()=>{};
    const navigator={hardwareConcurrency:2}, modules={}, store={data:[]};
    const URL=class{constructor(path){this.pathname=path}};
    const workerCache=new Map();
    const Worker=class{
      constructor(url){if(url.pathname!='/assets/calculatorWorker-309b3933.js')throw Error('未知 worker')}
      postMessage(data){
        const {yuhunComboChunk,...settings}=data.message;
        const groups=new Map(),bySlot=new WeakMap();
        const partitions=yuhunComboChunk.map(slots=>slots.map(slot=>{
          if(bySlot.has(slot))return bySlot.get(slot);
          const ids=slot.map(s=>s.id).join(',');
          if(!groups.has(ids))groups.set(ids,groups.size);
          const index=groups.get(ids);bySlot.set(slot,index);return index;
        }));
        const key=digest(JSON.stringify([settings,[...groups.keys()],partitions]));
        this.result=workerCache.get(key);
        if(!this.result){
          const saved=readResult?.(key);
          if(saved)this.result=JSON.parse(saved);
          else{
            const started=Date.now();
            workerResult=null;globalThis.onmessage({data});this.result=workerResult;
            if(saveResult && Date.now()-started>=100)saveResult(key,JSON.stringify(this.result));
          }
          if(workerCache.size>=64)workerCache.delete(workerCache.keys().next().value);
          workerCache.set(key,this.result);
        }
      }
      set onmessage(fn){fn({data:this.result})}
      terminate(){}
    };globalThis.workerResult=null;`);
  const worker=ruleText('calculatorWorker-309b3933.js');
  const workerSource=worker.replace('var lt=On.exports','globalThis.lodash=On.exports;var lt=On.exports');
  load(originalWorker?workerSource:optimizeWorker(workerSource).replace('let lo={','globalThis.singleSuitBonus=oo;let lo={'));
  const index=ruleText('index-216a7005.js');
  load(`const Hi=lodash;`+portion(index,'let yf=',',rme=')+`;
    modules.index={af:Hi,ai:PCe,ag:TCe,as:CCe,al:MCe,at:console,u:()=>({getEqData:{value:store.data}}),
      a$:DCe,aw:yf,b0:tme,b1:OCe};`);
  function bindings(raw:string){
    return raw.replace(/import\{([^}]+)\}from"\.\/([\w-]+)-[a-f\d]+\.js";/g,(_,names:string,mod:string)=>{
      const fields=names.replace(/ as /g,':');
      return 'const {'+fields+'}=modules['+JSON.stringify(mod)+']??{};';
    }).replace(/import"[^"]+";/g,'');
  }
  function install(name:'heroData-db59b10f.js'|'calculator-70eebf65.js'|'calcPanel-1f9cb473.js'|'teamBase-a28c33c3.js'){
    let source=bindings(ruleText(name)).replace(/export\{([^}]+)\};/,(_,names:string)=>{
      const fields=names.split(',').map(field=>{const [local,exported]=field.split(' as ');return (exported??local)+':'+local;});
      return 'return {'+fields.join(',')+'};';
    });
    if(name==='calculator-70eebf65.js'){
      source=applyDamageSetRules(source);
      if(!originalWorker){
        load('const linearPartitions='+linearPartitions.toString());
        source=source.replace('v=nt(k,u,t,e)','v=linearPartitions(k,ge(u),t,e,singleSuitBonus)??nt(k,u,t,e)');
      }
    }
    load('modules.'+name.split('-')[0]+'=(()=>{'+source+'})();');
  }
  install('heroData-db59b10f.js');install('calculator-70eebf65.js');install('calcPanel-1f9cb473.js');install('teamBase-a28c33c3.js');
  const teams=ruleText('oneKeyCalcTeam-68d30cbe.js');
  // Evaluate a fresh catalogue for each template: the reference engine resolves
  // teammate-dependent functions into numbers and mutates that working template.
  const imports=bindings(teams.slice(0,teams.indexOf('const ss=')));
  const definitions='const '+portion(teams,'P={ref0a:',',on={class:"wrapper"}')+';';
  const execute=portion(teams,'const D=async()=>',';return(f,_)').replace('ct.optimal=!0,Q[M]','ct.chosenForTeam=true,ct.optimal=!0,Q[M]');
  load(`const createScenario=()=>{`+imports+definitions+`
    return {list:()=>Object.entries(Ft).flatMap(([scene,group])=>group.teams.map((a,index)=>({
      scene,index,name:a.name||a.team.map(m=>m.hero).join(' / '),members:a.team.map(m=>m.hero),
      seconds:a.timeConsuming,requirements:[...(a.u70||[]).map(s=>s+'契灵'),...(a.notes||[])]}))),
    run:async(scene,index,strict,fast)=>{
      const t={value:scene},h={value:strict},c={value:fast},x={value:false},C={value:index};
      const $e={yuhun:{toArray:()=>store.data}}, n={rows:[],clearTeamRes(){this.rows=[]},addTeamRes(row){this.rows.push(row)},
        addRes(i,row){this.rows[i].res.push(row)},getAllRes(i){return this.rows[i].res},getExclude(){return []},forceUpdate(){}};
      `+execute+`;await D();const row=n.rows[0];
      return {pass:row.pass===1,remaining:row.bossRemainingHp,members:row.res.map(m=>({
        hero:m.hero||m.teamMember?.hero,pass:m.pass,chosen:!!(m.chosenForTeam||(!m.target&&m.optimal)),ids:(m.suit||[]).map(s=>s.id),
        set:m.yuhunName,panel:m.finalPanel,values:m.values,goal:m.goal,damage:m.injuryStats?.injury,
        remaining:m.injuryStats?.remainingHp,reasons:m.failReasons||[],skill:m.skillRequirements,notes:m.teamMember?.notes||[]
      }))};
    }};};`);
  const templates:Template[]=JSON.parse(load('JSON.stringify(createScenario().list())'));
  function setStandardInventory(items:ReturnType<typeof engineSoul>[]){
    ctx.inventoryJson=JSON.stringify(items);load('workerCache.clear();store.data=JSON.parse(inventoryJson);inventoryJson=null');
  }
  let previewLoaded=false;
  return { templates,setStandardInventory,setInventory(souls:Soul[]){setStandardInventory(souls.map(engineSoul));},
    async pvePreview():Promise<{hero:string;sets:string;value:number|null;ids:string[]}[]>{
      if(!previewLoaded){
        const source=ruleText('pvePreview-791b9fe7.js');
        load('const runPreview=(()=>{'+bindings(source.slice(0,source.indexOf('const K=')))+
          portion(source,'const K=',',ps=[]')+`;return async()=>{const rows=[];
          for(const a of ds){
            const target=a.target||{value:'Damage'},sets=Q(a.suitCombos);
            const best=(await U(a.hero,target,{propsLimit:a.propsLimit,suitCombos:a.suitCombos,mainAttrsLimit:a.mainAttrs},{fastMode:true}))[0];
            const value=best?q(O(a.hero),target,best.suit).数值:null;
            rows.push({hero:a.hero,sets,value:target.value==='CritPower'&&value!=null?value*100:value,ids:best?best.suit.map(s=>s.id):[]});
          }return rows}})()`);
        previewLoaded=true;
      }
      return JSON.parse(await load('runPreview().then(JSON.stringify)'));
    },
    async referenceSpeed(suit:string,fourth:string,sixth:string,exclude:string[]):Promise<{value:number|null;ids:string[]}>{
      ctx.speedRequest=JSON.stringify({suit,fourth,sixth,exclude});
      return JSON.parse(await load(`(async({suit,fourth,sixth,exclude})=>{
        const mainAttrsLimit={2:['Speed']};if(fourth)mainAttrsLimit[4]=[fourth];if(sixth)mainAttrsLimit[6]=[sixth];
        const filters={mainAttrsLimit};if(suit)filters.suitCombos=[{id:modules.index.as(suit),count:4}];
        const best=(await modules.calculator.h('天照',{value:'Speed'},filters,{fastMode:true,excludes:exclude.map(id=>({id}))}))[0];
        return JSON.stringify({value:best?.yuhunGain?.Speed??null,ids:(best?.suit??[]).map(s=>s.id)})
      })(JSON.parse(speedRequest))`));
    },
    async run(scene:string,index:number,strict=true,fast=true):Promise<TeamResult>{
      ctx.requestJson=JSON.stringify([scene,index,strict,fast]);
      return JSON.parse(await load('createScenario().run(...JSON.parse(requestJson)).then(r=>JSON.stringify(r))'));
    }};
}
