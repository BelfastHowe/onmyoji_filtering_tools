import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { openLibrary, resetLibrary, type ImportReport } from './library.ts';
import { accounts, catalogue, inventory, snapshotDetail } from './queries.ts';
import { queueTeams,startTeamPool,teamDetails,teamMode,teamProgress,type TeamMode } from './teamJobs.ts';
import { analysisVersion } from './analysis.ts';
import {inventoryReport} from './inventoryReport.ts';

const db=openLibrary();
const dist=resolve(import.meta.dirname,'../dist');
const port=Number(process.env.CBG_PORT || 4317);
let worker: Worker | undefined;
let teamPool:ReturnType<typeof startTeamPool>|undefined;
let runningMode:TeamMode|undefined;
let teamError='';
function enabledModes(){
  return db.prepare('SELECT mode FROM team_control WHERE paused=0 ORDER BY rowid').all().map(row=>teamMode(row.mode));
}
function scheduleTeams(){
  if(teamPool)return;
  const mode=enabledModes().find(m=>{
    const progress=teamProgress(db,m);
    return progress.some(r=>r.status==='待算')&&!progress.some(r=>r.status==='运行中');
  });
  if(!mode)return;
  runningMode=mode;
  teamPool=startTeamPool(db,mode,4);
  void teamPool.done.catch(e=>{
    teamError=String(e);
    db.prepare('UPDATE team_control SET paused=1 WHERE mode=?').run(mode);
  }).finally(()=>{teamPool=undefined;runningMode=undefined;scheduleTeams();});
}
function resumeEnabled(){
  try{for(const mode of enabledModes())queueTeams(db,mode);scheduleTeams();}
  catch(e){teamError=String(e);}
}
let job: {running:boolean;message:string;report?:ImportReport}={running:false,message:''};
const mime: Record<string,string>={'.js':'text/javascript','.css':'text/css','.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const server=createServer(async (req,res)=>{
  function send(status:number, data:unknown) {
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify(data));
  }
  try {
    const host=req.headers.host;
    if(!host || ![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) return send(403,{error:'仅允许本机访问'});
    const url=new URL(req.url || '/', 'http://'+host);
    if(url.pathname==='/api/teams'){
      const mode=teamMode(url.searchParams.get('mode')||'严格快速');
      if(req.method==='POST'){
        if(req.headers.origin!=='http://'+host || req.headers['content-type']!=='application/json')return send(403,{error:'请求来源无效'});
        if(url.searchParams.get('action')==='pause'){
          db.prepare('INSERT OR REPLACE INTO team_control VALUES(?,1)').run(mode);
          if(teamPool && runningMode===mode)await teamPool.pause();
        }else{
          queueTeams(db,mode,true);teamError='';scheduleTeams();
        }
      }else if(req.method!=='GET')return send(405,{error:'不支持该操作'});
      return send(200,{rows:teamProgress(db,mode),paused:!!db.prepare('SELECT paused FROM team_control WHERE mode=?').get(mode)?.paused,error:teamError});
    }
    if(req.method==='POST' && ['/api/import','/api/reset'].includes(url.pathname)) {
      if(req.headers.origin!=='http://'+host || req.headers['content-type']!=='application/json') return send(403,{error:'请求来源无效'});
      if(worker) return send(409,{...job,error:'正在导入或计算，请在任务完成后再试。'});
      if(url.pathname==='/api/reset') {
        if(teamPool||db.prepare("SELECT id FROM team_job WHERE status='运行中' LIMIT 1").get())return send(409,{error:'请先暂停阵容计算，再清空数据库。'});
        resetLibrary(db);
        job={running:false,message:'账号库已清空。'};
        return send(200,job);
      }
      job={running:true,message:'开始读取 account_data'};
      worker=new Worker(new URL('./import.ts',import.meta.url));
      worker.on('message',msg=>{if(msg.report)job.report=msg.report; if(msg.message)job.message=msg.message;});
      worker.on('error',err=>{job.message=err.message;});
      worker.on('exit',code=>{
        job.running=false;worker=undefined;
        if(!code){
          job.message='处理完成';
          resumeEnabled();
        }
      });
      return send(202,job);
    }
    if(req.method!=='GET')return send(405,{error:'不支持该操作'});
    if(url.pathname==='/api/job')return send(200,job);
    if(url.pathname==='/api/catalogue')return send(200,catalogue(db));
    if(url.pathname==='/api/accounts')return send(200,accounts(db,url.searchParams));
    const report=/^\/api\/snapshots\/(\d+)\/report$/.exec(url.pathname);
    if(report)return send(200,inventoryReport(db,Number(report[1]),url.searchParams));
    const teams=/^\/api\/snapshots\/(\d+)\/teams$/.exec(url.pathname);
    if(teams)return send(200,teamDetails(db,Number(teams[1]),teamMode(url.searchParams.get('mode')||'严格快速'),url.searchParams.get('version')||analysisVersion));
    const match=/^\/api\/snapshots\/(\d+)\/(detail|souls)$/.exec(url.pathname);
    if(match) return send(200,match[2]==='detail'?snapshotDetail(db,Number(match[1]),url.searchParams.get('version') || undefined):inventory(db,Number(match[1]),url.searchParams));
    if(url.pathname.startsWith('/api/'))return send(404,{error:'接口不存在'});
    const path=resolve(dist,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!path.startsWith(dist+sep))return send(403,{error:'路径无效'});
    const bytes=await readFile(path).catch(()=>null);
    if (!bytes) return send(404,{error:'缺少网页资源，请先构建前端'});
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','X-Content-Type-Options':'nosniff'});res.end(bytes);
  } catch(err) { send(400,{error:err instanceof Error?err.message:'请求失败'}); }
});
server.listen(port,'127.0.0.1',()=>{
  console.log(`御魂账号库 http://127.0.0.1:${port}/`);
  resumeEnabled();
});
