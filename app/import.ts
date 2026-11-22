import { isMainThread, parentPort } from 'node:worker_threads';
import { analyzeSnapshot, indexPending, openLibrary, scanSources } from './library.ts';
import {fillQuickPreviews} from './previewJobs.ts';
import {runSnapshotWorkers, workerLimit} from './parallelism.ts';

const db = openLibrary();
try {
  const progress=(message:string)=>parentPort?.postMessage({message});
  const {report,epoch,ids}=scanSources(db,undefined,progress);
  const threads=Math.min(workerLimit(),ids.length);
  let completed=0;
  const notify=()=>progress(`库存、一速和本地最优 PVE · 已完成 ${completed}/${ids.length} 个账号（${threads} 线程）`);
  function record(result:ReturnType<typeof analyzeSnapshot>){
    report.calculated+=result.calculated;
    if(result.error)report.errors.push(result.error);
    completed++;notify();
  }
  if(ids.length)notify();
  if(threads>1)await runSnapshotWorkers(new URL('./analysisWorker.ts',import.meta.url),db.location()!,ids,epoch,threads,record);
  else for(const id of ids)record(analyzeSnapshot(db,id,epoch));
  progress('建立御魂索引');
  indexPending(db,epoch);
  await fillQuickPreviews(db,progress);
  if (isMainThread) {
    console.log(JSON.stringify(report,null,2));
    if (report.errors.length) process.exitCode=1;
  } else parentPort?.postMessage({report});
} finally { db.close(); }
