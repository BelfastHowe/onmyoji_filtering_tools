import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexPending, openLibrary, resetLibrary, scan, scanSources } from '../app/library.ts';
import {runSnapshotWorkers} from '../app/parallelism.ts';
import { decode } from '../app/domain.ts';
import { catalogue, accounts, inventory, snapshotDetail } from '../app/queries.ts';
import { indicators, speedAnalysis, speedValue } from '../app/analysis.ts';
import {analysisVersion} from '../app/analysis.ts';
import {completedTeamModes,pauseTeamMode,queueTeams,startTeamPool,teamProgress} from '../app/teamJobs.ts';
import {fillQuickPreviews} from '../app/previewJobs.ts';
import {backfillSusanoMeans} from '../app/pveMean.ts';
import {fourSets,bossSets} from '../app/pve.ts';
import {inventoryReport} from '../app/inventoryReport.ts';
import {rulesDir,ruleFiles,rulesVersion} from '../app/rules.ts';
import {existsSync} from 'node:fs';
import {Worker} from 'node:worker_threads';

function account(order='A',time='2026-11-21 12:00:00') {
  const inventory={};
  for(let pos=1;pos<=6;pos++) for(let i=0;i<2;i++){
    const uuid=pos+'-'+i;
    inventory[uuid]={uuid,suitid:i?2:1,name:i?'火灵':'招财猫',pos,qua:6,level:15,
      attrs:[[pos===2?'速度':pos===4?'效果命中':pos===6?'生命加成':'攻击', pos===2?'57':'55'],['速度',i?'2.70':'2.40']],
      rattr:[['speedAdditionVal',i?0.9:0.8]]};
  }
  return {status:1,server_now_time:time,equip:{serverid:9,game_ordersn:order,price:10000,
    equip_name:'样本',equip_desc:{inventory,heroes:{}}}};
}
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'cbg-test-')), db=openLibrary(':memory:');
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  function write(file, value){writeFileSync(join(dir,file+'.json'),JSON.stringify(value));}
  return {db,dir,write};
}

test('damage migration invalidates affected candidates and their scene total, retaining independent results',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cbg-damage-')),file=join(dir,'old.db');
  let db=openLibrary(file);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  const doc=account();
  for(const id of ['1-0','2-0'])Object.assign(doc.equip.equip_desc.inventory[id],{name:'心眼',suitid:300022});
  writeFileSync(join(dir,'a.json'),JSON.stringify(doc));scan(db,dir);
  const prefix='team/'+rulesVersion+'/严格快速/魂土/';
  const job=db.prepare("INSERT INTO team_job(snapshot_id,rules,version,mode,scene,template,config,status,result) VALUES(1,?,?,'严格快速','魂土',?,'{}','完成',?)");
  const metric=db.prepare("INSERT INTO metric VALUES(1,?,?,?,1,'[]')");
  for(const [index,ids] of [['1-0','2-0'],['1-0','2-1']].entries()){
    job.run(rulesVersion,analysisVersion,index,JSON.stringify({members:[{ids,chosen:false}]}));
    for(const suffix of ['', '/owned'])metric.run(analysisVersion,prefix+index+suffix,'test');
  }
  metric.run(analysisVersion,prefix+'count','test');
  db.exec('PRAGMA user_version=2');db.close();db=openLibrary(file);
  assert.deepEqual(db.prepare('SELECT status FROM team_job ORDER BY template').all().map(r=>r.status),['已暂停','完成']);
  assert.deepEqual(db.prepare("SELECT key FROM metric WHERE key LIKE 'team/%' ORDER BY key").all().map(r=>r.key),[prefix+'1',prefix+'1/owned']);
});

test('Susano means use 21 exact presets per mode and version; historical rankings and range filters use the stored mean',t=>{
  const {db,dir,write}=fixture(t);
  write('a',account());scan(db,dir);
  const prefix='pve-fast/old-rules/',key=prefix+'mean/须佐之男';
  const put=db.prepare("INSERT INTO metric VALUES(1,?,?,?,?,'[]')");
  const keys=fourSets.flatMap(set=>bossSets.map(b=>prefix+'须佐之男/'+set+'/'+b));
  keys.forEach((k,i)=>{
    put.run(analysisVersion,k,'快速',i===20?null:i+0.125);
    if(i>0)put.run('incomplete',k,'旧版本',100);
  });
  put.run(analysisVersion,prefix+'天照/狂骨/鬼灵歌伎','其他预设',90000);
  db.exec('PRAGMA user_version=0');backfillSusanoMeans(db);
  const expected=(190+20*0.125)/21;
  assert.equal(db.prepare('SELECT value FROM metric WHERE key=? AND version=?').get(key,analysisVersion).value,expected);
  assert.equal(db.prepare('SELECT value FROM metric WHERE key=? AND version=?').get(key,'incomplete'),undefined);
  assert.equal(db.prepare("SELECT value FROM metric WHERE key='pve/mean/须佐之男'").get().value,0);
  assert.ok(catalogue(db).metrics.slice(0,2).every(m=>m.key.endsWith('/mean/须佐之男')));
  const query=new URLSearchParams({metric:key,batch:'1',filter:JSON.stringify([key,expected,expected])});
  assert.deepEqual(accounts(db,query).map(r=>r.value),[expected]);
  query.set('filter',JSON.stringify([key,expected+1,null]));
  assert.deepEqual(accounts(db,query),[]);
});

test('manual snapshot and batch runs unlock each complete mode independently in the selected scope',
  {skip:Object.keys(ruleFiles).some(name=>!existsSync(join(rulesDir,name)))},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cbg-manual-')),file=join(dir,'test.sqlite');
  let db=openLibrary(file);
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  function add(order){const doc=account(order);doc.equip.equip_desc.inventory={};writeFileSync(join(dir,order+'.json'),JSON.stringify(doc));}
  add('A');const a=scan(db,dir);
  add('B');scan(db,dir);
  assert.equal(db.prepare('SELECT count(*) n FROM team_job').get().n,0);
  const mode='严格快速';
  queueTeams(db,mode,true,1);await startTeamPool(db,mode,2).done;
  assert.equal(teamProgress(db,mode,2).length,0);
  assert.deepEqual(completedTeamModes(db,0),[]);
  assert.equal(completedTeamModes(db,a.batch).length,1);
  queueTeams(db,mode,true);await startTeamPool(db,mode,2).done;
  assert.equal(completedTeamModes(db,0).length,1);
  assert.equal(teamProgress(db,mode)[0].n,48);
  const second='宽容快速';
  queueTeams(db,second);pauseTeamMode(db,second);
  queueTeams(db,second,true,2);await startTeamPool(db,second,1).done;
  assert.equal(teamProgress(db,second,1)[0].status,'已暂停');
  assert.equal(teamProgress(db,second,2)[0].status,'完成');
  add('C');scan(db,dir);
  assert.equal(teamProgress(db,mode,3).length,0);
  assert.equal(completedTeamModes(db,0).length,0);
  queueTeams(db,mode);
  db.exec('PRAGMA user_version=1');db.close();db=openLibrary(file);
  assert.equal(teamProgress(db,mode,3)[0].status,'已暂停');
  assert.equal(teamProgress(db,mode,1)[0].status,'完成');
});

test('parallel base analysis reproduces serial metrics and rejects work claimed before a reset',async t=>{
  const {db:serial,dir,write}=fixture(t);
  write('a',account('A'));write('b',account('B'));scan(serial,dir);
  const file=join(dir,'parallel.db'),parallel=openLibrary(file);
  try{
    const {ids,epoch}=scanSources(parallel,dir);
    const worker=new URL('../app/analysisWorker.ts',import.meta.url);
    const completed=[];
    await runSnapshotWorkers(worker,file,ids,epoch,2,r=>completed.push(r));
    assert.deepEqual(completed,[{calculated:1},{calculated:1}]);
    indexPending(parallel,epoch);
    const metrics='SELECT * FROM metric ORDER BY snapshot_id,version,key';
    assert.deepEqual(parallel.prepare(metrics).all(),serial.prepare(metrics).all());
    resetLibrary(parallel);
    await assert.rejects(runSnapshotWorkers(worker,file,ids,epoch,2,()=>{}),/本次扫描已停止/);
    assert.equal(parallel.prepare('SELECT count(*) n FROM metric').get().n,0);
  }finally{parallel.close();}
});

test('parallel quick previews match serial scores and IDs, then skip completed snapshots',
  {skip:Object.keys(ruleFiles).some(name=>!existsSync(join(rulesDir,name)))},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cbg-pve-workers-')),db=openLibrary(join(dir,'db.sqlite'));
  t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
  for(const id of ['A','B'])writeFileSync(join(dir,id+'.json'),JSON.stringify(account(id)));
  scan(db,dir);
  const results=()=>db.prepare("SELECT * FROM metric WHERE key LIKE 'pve-fast/%' ORDER BY snapshot_id,key").all();
  await fillQuickPreviews(db,undefined,1);
  const expected=results();
  assert.equal(expected.length,68);
  db.exec("DELETE FROM metric WHERE key LIKE 'pve-fast/%'");
  await fillQuickPreviews(db,undefined,2);
  assert.deepEqual(results(),expected);
  await fillQuickPreviews(db,()=>assert.fail('completed snapshots were scheduled'),2);
});
test('effective rolls preserve detail precision; exceptional gift uses its displayed value',()=>{
  const doc=account();const soul=doc.equip.equip_desc.inventory['1-0'];
  soul.attrs[1][1]='2.67';soul.rattr[0][1]=0.891;
  let normalized=decode(Buffer.from(JSON.stringify(doc)),0).souls[0];
  assert.equal(normalized.sub['速度'],0.891*3);
  soul.attrs[1][1]='16.00';normalized=decode(Buffer.from(JSON.stringify(doc)),0).souls[0];
  assert.equal(normalized.sub['速度'],16);
  assert.equal(indicators(normalized).速度,99);
});
test('reset clears data and history atomically, then imports the original JSON again',t=>{
  const {db,dir,write}=fixture(t);
  write('a',account());
  scan(db,dir);
  scan(db,dir);
  db.exec("CREATE TEMP TRIGGER fail_reset BEFORE DELETE ON snapshot BEGIN SELECT RAISE(ABORT,'blocked'); END");
  assert.throws(()=>resetLibrary(db),/blocked/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM batch').get().n,2);
  assert.equal(accounts(db,new URLSearchParams())[0].souls,12);
  db.exec('DROP TRIGGER fail_reset');
  resetLibrary(db);
  resetLibrary(db);
  for(const table of ['listing','snapshot','source','soul','analysis','metric','batch','member']){
    assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0,table);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  const fresh=scan(db,dir);
  assert.equal(fresh.added,1);assert.equal(fresh.calculated,1);assert.equal(fresh.duplicates,0);
  assert.deepEqual(fresh.errors,[]);
});
test('a scan started before reset cannot repopulate the cleared database',t=>{
  const {db,dir,write}=fixture(t);
  write('a',account());
  assert.throws(()=>scan(db,dir,message=>{
    if(message.startsWith('计算库存'))resetLibrary(db);
  }),/本次扫描已停止/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metric').get().n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM batch').get().n,0);
});
test('four-piece speed matches enumeration and successive loose ranks use disjoint UUIDs',()=>{
  const {souls}=decode(Buffer.from(JSON.stringify(account())),0);
  const slots=Array.from({length:6},(_,i)=>souls.filter(s=>s.pos===i+1));
  let best=-Infinity;
  for(let mask=0;mask<64;mask++){
    const picks=slots.map((s,i)=>s[(mask>>i)&1]);
    if(picks.filter(s=>s.suit==='招财猫').length>=4)best=Math.max(best,picks.reduce((sum,s)=>sum+speedValue(s),0));
  }
  const speeds=speedAnalysis(souls);
  assert.equal(speeds.find(r=>r.key==='speed/set/招财猫').value,best);
  assert.equal(new Set([...speeds[0].ids,...speeds[1].ids]).size,12);
  assert.equal(speeds[2].value,null);
});
test('append five + three duplicate files; keep original batch membership and reuse results',t=>{
  const {db,dir,write}=fixture(t);
  for(let i=0;i<30;i++)write(String(i),account('s'+i));
  const first=scan(db,dir);assert.equal(first.added,30);assert.equal(first.calculated,30);
  for(let i=0;i<5;i++)write('new'+i,account('new'+i));
  for(let i=0;i<3;i++)write('copy'+i,account('s'+i));
  const next=scan(db,dir);
  assert.equal(next.added,5);assert.equal(next.calculated,5);assert.equal(next.duplicates,33);
  assert.equal(accounts(db,new URLSearchParams()).length,35);
  assert.equal(accounts(db,new URLSearchParams({batch:String(first.batch)})).length,30);
  assert.equal(scan(db,dir).calculated,0);
});
test('metadata-only change, changed inventory and out-of-order old capture',t=>{
  const {db,dir,write}=fixture(t);
  write('a',account());const first=scan(db,dir);
  const update=account('A','2026-11-22 10:00:00');update.equip.price=123000;
  write('b',update);assert.equal(scan(db,dir).calculated,0);
  assert.equal(accounts(db,new URLSearchParams())[0].price,123000);
  assert.equal(accounts(db,new URLSearchParams({batch:String(first.batch)}))[0].price,10000);
  const newer=account('A','2026-11-23 10:00:00');
  delete newer.equip.equip_desc.inventory['1-0'];write('c',newer);assert.equal(scan(db,dir).updated,1);
  const oldest=account('A','2026-11-20 10:00:00');
  oldest.equip.price=999;write('d',oldest);scan(db,dir);
  const row=accounts(db,new URLSearchParams())[0];assert.equal(row.souls,11);assert.equal(row.price,10000);
  const detail=snapshotDetail(db,row.snapshot_id);
  const ids=detail.metrics.find(m=>m.key==='speed/loose/1').ids;
  assert.equal(inventory(db,row.snapshot_id,new URLSearchParams(ids.map(id=>['id',id]))).total,6);
  assert.equal(accounts(db,new URLSearchParams({filter:JSON.stringify(['speed/loose/1',500,null])})).length,0);
});
test('relisting with reliable role ID; malformed file does not break remaining imports',t=>{
  const {db,dir,write}=fixture(t);
  const a=account('a'),b=account('b','2026-11-22 10:00:00');
  a.equip.roleid='123';b.equip.roleid='123';write('a',a);write('b',b);write('bad',{status:2});
  const report=scan(db,dir);assert.equal(report.errors.length,1);
  const list=accounts(db,new URLSearchParams());assert.equal(list.length,1);assert.ok(list[0].url.endsWith('/b'));
});

test('account imports ignore legacy ratings and reference exports, retaining attribute-based inventory metrics',t=>{
  const {db,dir,write}=fixture(t),doc=account();
  write('account',doc);scan(db,dir);
  Object.assign(doc.equip.equip_desc.inventory['1-0'],{score:9,zscore:14});
  write('updated',doc);write('reference',{data:{hero_equips:[{id:'1-0',score:9,zscore:14}]}});
  const result=scan(db,dir);
  assert.deepEqual(result.errors,[]);assert.equal(result.calculated,0);
  assert.equal(db.prepare('SELECT count(*) n FROM snapshot').get().n,1);
  const view=inventoryReport(db,1,new URLSearchParams({field:'yield'}));
  assert.equal(view.total,12);assert.equal(view.rows[0].value,1);
  for(const field of ['score','zscore']){
    assert.ok(!(field in view.rows[0].soul));
    assert.throws(()=>inventoryReport(db,1,new URLSearchParams({field})),/库存指标无效/);
  }
});

test('opening a legacy library removes ratings and keeps historical results and deduplication',t=>{
  const dir=mkdtempSync(join(tmpdir(),'cbg-migration-')),file=join(dir,'old.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const doc=account(),input=join(dir,'account.json');
  writeFileSync(input,JSON.stringify(doc));
  let db=openLibrary(file);
  const batch=scan(db,dir).batch;
  const before=snapshotDetail(db,1);
  db.exec(`
    ALTER TABLE inventory_piece RENAME TO piece_rating;
    ALTER TABLE piece_rating ADD COLUMN score REAL;
    ALTER TABLE piece_rating ADD COLUMN zscore REAL;
    ALTER TABLE inventory_ready RENAME TO rating_ready;
    CREATE TABLE rating_reference(hash TEXT PRIMARY KEY,snapshot_id INTEGER);
    INSERT INTO rating_reference VALUES('old',1);
    UPDATE piece_rating SET score=9,zscore=14;
    UPDATE soul SET data=json_set(data,'$.score',9,'$.zscore',14);
    UPDATE snapshot SET fingerprint='legacy-fingerprint';
    INSERT INTO metric SELECT snapshot_id,version,'inventory/zmax','旧指标',14,'[]' FROM analysis;
  `);
  db.close();
  db=openLibrary(file);
  try{
    assert.deepEqual(snapshotDetail(db,1),before);
    assert.equal(accounts(db,new URLSearchParams({batch:String(batch)}))[0].snapshot_id,1);
    assert.ok(catalogue(db).metrics.every(m=>m.key!=='inventory/zmax'));
    assert.equal(inventoryReport(db,1,new URLSearchParams()).total,12);
    assert.ok(inventory(db,1,new URLSearchParams()).rows.every(s=>!('score' in s || 'zscore' in s)));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    doc.equip.price++;writeFileSync(input,JSON.stringify(doc));
    assert.equal(scan(db,dir).calculated,0);
    assert.equal(db.prepare('SELECT count(*) n FROM snapshot').get().n,1);
  }finally{db.close();}
});

test('multiple template filters and tie breakers use only computed results',t=>{
  const {db,dir,write}=fixture(t);
  for(const key of ['a','b','c'])write(key,account(key));
  scan(db,dir);
  const save=db.prepare("insert into metric values(?,?,?,?,?,'[]')");
  for(const [id,a,b,n] of [[1,1,0,2],[2,1,1,3],[3,0,null,4]]){
    for(const [key,v] of [['team/r/m/s/0',a],['team/r/m/s/1',b],['secondary/test',n]])
      if(v!==null)save.run(id,analysisVersion,key,key,v);
  }
  const q=new URLSearchParams([['template','team/r/m/s/0'],['template','team/r/m/s/1'],['then',JSON.stringify(['secondary/test','desc'])]]);
  const ids=()=>accounts(db,q).map(row=>row.snapshot_id);
  assert.deepEqual(ids(),[2]);q.set('match','any');assert.deepEqual(ids(),[2,1]);
  q.set('pass','0');assert.deepEqual(ids(),[3,1]);q.set('match','all');assert.deepEqual(ids(),[]);
});

test('concurrent imports of renamed duplicates survive a database reopen',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cbg-concurrent-')),file=join(dir,'test.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const doc=JSON.stringify(account());
  for(const name of ['source.json','renamed.json'])writeFileSync(join(dir,name),doc);
  openLibrary(file).close();
  const url=new URL('../app/library.ts',import.meta.url).href;
  const code=`import {workerData,parentPort} from 'node:worker_threads';
    import {openLibrary,scan} from ${JSON.stringify(url)};
    const db=openLibrary(workerData.file);
    try{parentPort.postMessage(scan(db,workerData.dir))}finally{db.close()}`;
  const run=()=>new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('data:text/javascript,'+encodeURIComponent(code)),{workerData:{dir,file}});
    let report;worker.on('message',r=>{report=r;});worker.on('error',reject);
    worker.on('exit',n=>n?reject(Error('worker exit '+n)):resolve(report));
  });
  const results=await Promise.all([run(),run()]);
  assert.ok(results.every(r=>!r.errors.length));
  assert.equal(results.reduce((n,r)=>n+r.added,0),1);
  const db=openLibrary(file);
  try{
    assert.equal(accounts(db,new URLSearchParams()).length,1);
    assert.equal(db.prepare('select count(*) n from inventory_piece').get().n,12);
    const [first,second]=results.map(r=>accounts(db,new URLSearchParams({batch:String(r.batch)})));
    assert.deepEqual(first,second);
    assert.ok(first[0].value>0);
  }finally{db.close();}
});

test('paused and abandoned team jobs resume in the same database without replacing completed results',
  {skip:Object.keys(ruleFiles).some(name=>!existsSync(join(rulesDir,name)))?'需要本地魔方规则包':false},async t=>{
    const dir=mkdtempSync(join(tmpdir(),'cbg-workers-')),file=join(dir,'test.sqlite'),db=openLibrary(file);
    t.after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});
    const doc=account();doc.equip.equip_desc.inventory={};writeFileSync(join(dir,'a.json'),JSON.stringify(doc));
    scan(db,dir);const mode='严格快速';queueTeams(db,mode);
    db.prepare('update team_control set paused=1 where mode=?').run(mode);
    await startTeamPool(db,mode,1).done;
    assert.equal(teamProgress(db,mode)[0].n,24);
    db.exec("update team_job set status='运行中',owner='2147483647/abandoned' where id=1");
    queueTeams(db,mode);
    assert.equal(db.prepare('select status from team_job where id=1').get().status,'待算');
    await startTeamPool(db,mode,2).done;
    const results=db.prepare('select id,status,result,elapsed from team_job order by id').all();
    assert.equal(results.length,24);assert.ok(results.every(r=>r.status==='完成'&&!JSON.parse(r.result).pass));
    queueTeams(db,mode);await startTeamPool(db,mode,1).done;
    assert.deepEqual(db.prepare('select id,status,result,elapsed from team_job order by id').all(),results);
  });
