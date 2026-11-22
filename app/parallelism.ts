import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import { Worker } from 'node:worker_threads';

let physical:number|null|undefined;
export function cpuInfo(){
  if(physical===undefined){
    physical=null;
    try{
      let count=0;
      const options={encoding:'utf8' as const,timeout:4000,windowsHide:true};
      if(process.platform==='win32')count=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','(Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum'],options).trim());
      else if(process.platform==='darwin')count=Number(execFileSync('sysctl',['-n','hw.physicalcpu'],options).trim());
      else if(process.platform==='linux'){
        const pairs=new Set<string>();
        for(const block of readFileSync('/proc/cpuinfo','utf8').split(/\n\s*\n/)){
          const socket=/^physical id\s*:\s*(\d+)/m.exec(block),core=/^core id\s*:\s*(\d+)/m.exec(block);
          if(socket&&core)pairs.add(socket[1]+'/'+core[1]);
        }
        count=pairs.size;
      }
      if(Number.isSafeInteger(count)&&count>0)physical=count;
    }catch{/* CPU affinity still supplies a usable worker limit. */}
  }
  return {physical,logical:cpus().length,available:availableParallelism()};
}
export function workerLimit(memoryPerWorkerMiB=512) {
  const reserve=Math.max(1024**3,totalmem()*0.1);
  const memorySlots=Math.floor((freemem()-reserve)/(memoryPerWorkerMiB*1024**2));
  return Math.max(1,Math.min(availableParallelism(),memorySlots));
}

export function* claimSnapshots(ids:number[],cursor:Int32Array) {
  for(let i=Atomics.add(cursor,0,1);i<ids.length;i=Atomics.add(cursor,0,1))yield ids[i];
}

export async function runSnapshotWorkers<T>(url:URL,database:string,ids:number[],epoch:number,count:number,onResult:(result:T)=>void) {
  const cursor=new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  const workers:Worker[]=[];
  try {
    const tasks=Array.from({length:count},()=>{
      const worker=new Worker(url,{workerData:{database,ids,cursor,epoch}});
      workers.push(worker);
      worker.on('message',onResult);
      return new Promise<void>((resolve,reject)=>{
        worker.on('error',reject);
        worker.on('exit',code=>code?reject(Error('账号计算线程退出 '+code)):resolve());
      });
    });
    await Promise.all(tasks);
  } finally { await Promise.all(workers.map(w=>w.terminate())); }
}
