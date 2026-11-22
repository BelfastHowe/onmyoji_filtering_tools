import {openLibrary} from './library.ts';
import {queueTeams,startTeamPool,teamMode,teamProgress} from './teamJobs.ts';
const mode=teamMode(process.argv[2]||'严格快速');
const db=openLibrary();
try{
  queueTeams(db,mode,true);
  const pool=startTeamPool(db,mode);
  process.once('SIGINT',()=>{void pool.pause();});
  await pool.done;
  const rows=teamProgress(db,mode);console.log(rows);
  if(rows.some(r=>r.status==='出错'))process.exitCode=1;
}finally{db.close();}
