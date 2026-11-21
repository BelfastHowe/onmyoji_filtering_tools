import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary, resetLibrary, scan } from '../app/library.ts';
import { decode } from '../app/domain.ts';
import { accounts, inventory, snapshotDetail } from '../app/queries.ts';
import { indicators, speedAnalysis, speedValue } from '../app/analysis.ts';

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
