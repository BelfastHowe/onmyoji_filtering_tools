import type {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzipSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {analysisVersion} from './analysis.ts';
import {rulesVersion} from './rules.ts';
import {createTeamEngine,type Template,type TeamResult} from './teamEngine.ts';
import type {Soul} from './domain.ts';

export const teamModes=['严格快速','宽容快速','严格精确','宽容精确'] as const;
export type TeamMode=(typeof teamModes)[number];
export function teamMode(raw:unknown):TeamMode{
  if(!teamModes.includes(raw as TeamMode))throw Error('无效的阵容计算模式');
  return raw as TeamMode;
}
function transaction<T>(db:DatabaseSync,fn:()=>T){
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}
}
export function teamProgress(db:DatabaseSync,mode:TeamMode){
  return db.prepare(`SELECT j.status,count(*) AS n FROM team_job j
    JOIN current_member c ON c.current_snapshot=j.snapshot_id WHERE j.version=? AND j.rules=? AND j.mode=? GROUP BY j.status`)
    .all(analysisVersion,rulesVersion,mode);
}
let templateCatalogue:Template[]|undefined;
export function queueTeams(db:DatabaseSync,mode:TeamMode,retry=false){
  const templates=templateCatalogue??=createTeamEngine().templates;
  transaction(db,()=>{
    db.prepare('INSERT OR REPLACE INTO team_control VALUES(?,0)').run(mode);
    const insert=db.prepare(`INSERT OR IGNORE INTO team_job(snapshot_id,rules,version,mode,scene,template,config)
      SELECT current_snapshot,?,?,?,?,?,? FROM current_member`);
    for(const t of templates)insert.run(rulesVersion,analysisVersion,mode,t.scene,t.index,JSON.stringify(t));
    if(retry)db.prepare("UPDATE team_job SET status='待算',error=NULL WHERE status='出错' AND rules=? AND version=? AND mode=?").run(rulesVersion,analysisVersion,mode);
    for(const {owner} of db.prepare("SELECT DISTINCT owner FROM team_job WHERE status='运行中'").all()){
      const pid=Number(String(owner).split('/')[0]);
      try{process.kill(pid,0);}catch(e){
        if((e as NodeJS.ErrnoException).code==='ESRCH')release(db,String(owner));
      }
    }
  });
}
function release(db:DatabaseSync,owner:string){
  db.prepare("UPDATE team_job SET status='待算',owner=NULL WHERE owner=? AND status='运行中'").run(owner);
}
export function startTeamPool(db:DatabaseSync,mode:TeamMode,concurrency=4){
  const database=db.location();
  if(!database)throw Error('阵容工作线程需要磁盘数据库');
  const workers=new Set<Worker>();
  const finished:Promise<void>[]=[];
  let failure='';
  for(let i=0;i<concurrency;i++){
    const owner=process.pid+'/'+randomUUID();
    const worker=new Worker(new URL('./teamWorker.ts',import.meta.url),{workerData:{owner,mode,database}});
    workers.add(worker);
    worker.on('error',e=>{failure=e.message;});
    finished.push(new Promise(resolve=>worker.on('exit',()=>{
      workers.delete(worker);release(db,owner);resolve();
    })));
  }
  const done=Promise.all(finished).then(()=>{if(failure)throw Error(failure);});
  return {done,pause:()=>Promise.all([...workers].map(w=>w.terminate())).then(()=>done)};
}
export function teamDetails(db:DatabaseSync,id:number,mode:TeamMode,version:string){
  return db.prepare(`SELECT config,status,result,error,elapsed FROM team_job WHERE snapshot_id=? AND rules=? AND mode=? AND version=? ORDER BY id`)
    .all(id,rulesVersion,mode,version).map(r=>{
      const config:Template=JSON.parse(String(r.config)),result=r.result?JSON.parse(String(r.result)):null;
      // Earlier cached results omitted the name for template-only support members.
      let selected=0;
      for(const member of result?.members??[]){
        if(member.chosen){member.hero??=config.members[selected];selected++;}
      }
      return {...r,config,result};
    });
}
export async function processTeams(db:DatabaseSync,owner:string,mode:TeamMode){
  let last=0,heroes=new Map<string,number>(),empty=false;
  const cached=db.prepare('SELECT data FROM team_cache WHERE snapshot_id=? AND rules=? AND key=?');
  const save=db.prepare('INSERT OR IGNORE INTO team_cache VALUES(?,?,?,?)');
  const cacheVersion=rulesVersion+'/'+analysisVersion+'/search-v1';
  const engine=createTeamEngine(false,{
    get(key){const row=cached.get(last,cacheVersion,key);return row?gunzipSync(row.data as Uint8Array).toString():undefined;},
    put(key,data){save.run(last,cacheVersion,key,gzipSync(data));}
  });
  const getSouls=db.prepare('SELECT data FROM soul WHERE snapshot_id=? ORDER BY uuid');
  while(true){
    const job=transaction(db,()=>{
      if(db.prepare('SELECT paused FROM team_control WHERE mode=?').get(mode)?.paused)return;
      const row=db.prepare(`SELECT j.* FROM team_job j JOIN current_member c ON c.current_snapshot=j.snapshot_id
        WHERE status='待算' AND rules=? AND version=? AND mode=?
        ORDER BY (j.snapshot_id=?) DESC,
        EXISTS(SELECT 1 FROM team_job k WHERE k.snapshot_id=j.snapshot_id AND k.status='运行中'),j.snapshot_id,j.id LIMIT 1`).get(rulesVersion,analysisVersion,mode,last);
      if(row)db.prepare("UPDATE team_job SET status='运行中',owner=? WHERE id=?").run(owner,row.id);
      return row;
    });
    if(!job)return;
    const started=Date.now();
    const snapshot=Number(job.snapshot_id),template:Template=JSON.parse(String(job.config));
    try{
      if(last!==snapshot){
        const souls:Soul[]=getSouls.all(snapshot).map(s=>JSON.parse(String(s.data)));
        engine.setInventory(souls);empty=souls.length===0;
        const raw=db.prepare('SELECT hero_data FROM snapshot WHERE id=?').get(snapshot)!;
        const members=Object.values(JSON.parse(gunzipSync(raw.hero_data as Uint8Array).toString())) as {name:string}[];
        heroes=new Map();for(const h of members)heroes.set(h.name,(heroes.get(h.name)??0)+1);
        last=snapshot;
      }
      const result:TeamResult=empty?{pass:false,remaining:0,members:[]}:await engine.run(template.scene,template.index,mode.startsWith('严格'),mode.endsWith('快速'));
      const missing:string[]=[],remaining=new Map(heroes),used=new Set<string>();
      for(const hero of template.members){
        const n=remaining.get(hero)??0;if(!n)missing.push(hero);else remaining.set(hero,n-1);
      }
      for(const m of result.members.filter(m=>m.chosen)){
        if(m.ids.length && m.ids.length!==6)throw Error('阵容御魂数量异常');
        for(const id of m.ids){if(used.has(id))throw Error('阵容重复使用同一御魂');used.add(id);}
      }
      result.pass=result.pass && template.members.length===result.members.filter(m=>m.chosen).length;
      transaction(db,()=>{
        const saved=db.prepare("UPDATE team_job SET status='完成',owner=NULL,result=?,elapsed=? WHERE id=? AND owner=?")
          .run(JSON.stringify({...result,missing}),Date.now()-started,job.id,owner);
        if(!saved.changes)return;
        const prefix=['team',rulesVersion,mode,template.scene].join('/');
        const label=mode+' · '+template.scene+' #'+(template.index+1)+' '+template.name;
        const metric=db.prepare("INSERT OR REPLACE INTO metric VALUES(?,?,?,?,?,'[]')");
        metric.run(snapshot,analysisVersion,prefix+'/'+template.index,label+' · 配装达标',Number(result.pass));
        metric.run(snapshot,analysisVersion,prefix+'/'+template.index+'/owned',label+' · 式神齐全',Number(!missing.length));
        const group=db.prepare(`SELECT count(*) n,count(result) done,sum(json_extract(result,'$.pass')) passed FROM team_job
          WHERE snapshot_id=? AND rules=? AND version=? AND mode=? AND scene=?`).get(snapshot,rulesVersion,analysisVersion,mode,template.scene)!;
        if(group.n===group.done)metric.run(snapshot,analysisVersion,prefix+'/count',mode+' · '+template.scene+' · 达标模板数',group.passed);
      });
    }catch(e){
      db.prepare("UPDATE team_job SET status='出错',owner=NULL,error=?,elapsed=? WHERE id=? AND owner=?")
        .run(e instanceof Error?e.message:String(e),Date.now()-started,job.id,owner);
    }
  }
}
