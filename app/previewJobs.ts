import type { DatabaseSync } from 'node:sqlite';
import { analysisVersion } from './analysis.ts';
import { createTeamEngine } from './teamEngine.ts';
import { rulesVersion } from './rules.ts';
import { fourSets } from './pve.ts';
import { claimSnapshots, runSnapshotWorkers, workerLimit } from './parallelism.ts';
import { saveSusanoMeans } from './pveMean.ts';

const prefix='pve-fast/'+rulesVersion+'/';

export async function fillQuickPreviews(db:DatabaseSync, progress?:(s:string)=>void, concurrency=workerLimit()){
  const epoch=Number(db.prepare('SELECT generation FROM library_state WHERE id=1').get()!.generation);
  const missing=db.prepare(`SELECT DISTINCT current_snapshot id FROM current_member c
    WHERE NOT EXISTS(SELECT 1 FROM metric WHERE snapshot_id=c.current_snapshot AND version=? AND key=?)`)
    .all(analysisVersion,prefix+'yue/defense');
  if(!missing.length)return;
  const ids=missing.map(r=>Number(r.id));
  const database=db.location();
  const count=database?Math.max(1,Math.min(concurrency,ids.length)):1;
  let completed=0;
  const notify=()=>progress?.(`魔方快速 PVE · 已完成 ${++completed}/${ids.length} 个账号（${count} 线程）`);
  progress?.(`计算魔方快速 PVE · ${ids.length} 个账号（${count} 线程）`);
  if(count===1)return runQuickPreviews(db,ids,new Int32Array(1),epoch,notify);
  await runSnapshotWorkers(new URL('./previewWorker.ts',import.meta.url),database!,ids,epoch,count,notify);
}

export async function runQuickPreviews(db:DatabaseSync, ids:number[], cursor:Int32Array, epoch:number, notify:()=>void){
  const engine=createTeamEngine();
  const insert=db.prepare('INSERT OR REPLACE INTO metric VALUES(?,?,?,?,?,?)');
  const generation=db.prepare('SELECT generation FROM library_state WHERE id=1');
  for(const id of claimSnapshots(ids,cursor)){
    const souls=db.prepare('SELECT data FROM soul WHERE snapshot_id=? ORDER BY uuid').all(id);
    engine.setInventory(souls.map(s=>JSON.parse(String(s.data))));
    const rows=await engine.pvePreview();
    const sums=new Map<string,number>();
    db.exec('BEGIN IMMEDIATE');
    try{
      if(generation.get()!.generation!==epoch)throw Error('账号库已重置');
      for(const r of rows){
        const [four,boss]=r.sets.split(' + ');
        const key=r.hero==='不见岳'?'yue/defense':r.hero==='因幡辉夜姬'?'inaba/'+(four==='火灵'?'fire':'loose'):[r.hero,four,boss].join('/');
        if(r.hero==='须佐之男')sums.set(four,(sums.get(four)??0)+(r.value??0));
        insert.run(id,analysisVersion,prefix+key,'魔方快速 · '+r.hero+' · '+r.sets,r.value,JSON.stringify(r.ids));
      }
      for(const set of fourSets)insert.run(id,analysisVersion,prefix+'mean/'+set,'魔方快速 · '+set+' · 三首领均值',(sums.get(set)??0)/3,'[]');
      saveSusanoMeans(db,prefix,id,analysisVersion);
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    notify();
  }
}
