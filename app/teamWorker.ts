import {workerData} from 'node:worker_threads';
import {openLibrary} from './library.ts';
import {processTeams} from './teamJobs.ts';
const db=openLibrary(workerData.database);
try{await processTeams(db,workerData.owner,workerData.mode);}finally{db.close();}
