import type {DatabaseSync} from 'node:sqlite';
import {rulesVersion} from './rules.ts';

// 心眼、海月火玉、破势、狂骨、隐念 (the four-piece branches in ue).
const mindsEye=300022;
const fourPieceEffects=[mindsEye,300083,300030,300048,300086];

// Adapt the pinned calculator where set counts become names for the damage
// multiplier. Its separate panel and display helpers still need two-piece sets.
export function applyDamageSetRules(source:string){
  const edits=[
    ['Ee=u=>{let t=f.countBy(u,n=>n.suit_id),e=f.pickBy(t,n=>n>=2)',
      `damagePieces=id=>${JSON.stringify(fourPieceEffects)}.includes(Number(id))?4:2,Ee=(u,damageOnly=false)=>{let t=f.countBy(u,n=>n.suit_id),e=f.pickBy(t,(count,id)=>count>=(damageOnly?damagePieces(id):2))`],
    ['const n=Ee(u);return ue(n,t,e)','const n=Ee(u,true);return ue(n,t,e)'],
    ['_e=u=>u?u.map(t=>ee(t.id)):[]','_e=u=>u?u.filter(t=>t.count>=damagePieces(t.id)).map(t=>ee(t.id)):[]'],
    // No HP information means no missing-health bonus. Keep exact 15% steps
    // stable at decimal boundaries (e.g. 55% HP means three steps).
    ['Math.floor((1-Math.max(s.value,0))/.15)',
      'Math.floor((1-Math.min(1,Math.max(s?.value??1,0))+1e-12)/.15)']
  ];
  for(const [before,after] of edits){
    if(!source.includes(before))throw Error('伤害套装适配与固定规则版本不匹配');
    source=source.replace(before,after);
  }
  return source;
}

// Called in the library migration transaction. Include unchosen candidates:
// a corrected damage check can change which candidate gets selected.
export function invalidateOldDamageResults(db:DatabaseSync){
  const jobs=db.prepare(`SELECT id,snapshot_id,version,mode,scene,template FROM team_job j
    WHERE rules=? AND status='完成' AND EXISTS(
      SELECT 1 FROM json_each(j.result,'$.members') m CROSS JOIN json_each(m.value,'$.ids') g
      CROSS JOIN soul s ON s.snapshot_id=j.snapshot_id AND s.uuid=g.value
      WHERE json_extract(s.data,'$.suitId') IN (${fourPieceEffects.map(()=>'?').join(',')})
      GROUP BY m.key,json_extract(s.data,'$.suitId')
      HAVING count(*) IN (2,3) OR (json_extract(s.data,'$.suitId')=? AND count(*)>=4))`).all(rulesVersion,...fourPieceEffects,mindsEye);
  const reset=db.prepare("UPDATE team_job SET status='已暂停',owner=NULL,result=NULL,error=NULL,elapsed=NULL WHERE id=?");
  const remove=db.prepare('DELETE FROM metric WHERE snapshot_id=? AND version=? AND key IN (?,?,?)');
  for(const job of jobs){
    const prefix=['team',rulesVersion,job.mode,job.scene].join('/');
    const key=prefix+'/'+job.template;
    remove.run(job.snapshot_id,job.version,key,key+'/owned',prefix+'/count');
    reset.run(job.id);
  }
}
