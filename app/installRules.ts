import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {rulesDir,ruleFiles,verifyRule} from './rules.ts';
mkdirSync(rulesDir,{recursive:true});
for(const name of Object.keys(ruleFiles) as (keyof typeof ruleFiles)[]){
  const destination=join(rulesDir,name);
  try{verifyRule(name,readFileSync(destination));continue;}catch{}
  const response=await fetch('https://yyshub.top/assets/'+name,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('规则下载失败 '+name+' '+response.status);
  const tmp=destination+'.'+process.pid+'.tmp';
  writeFileSync(tmp,verifyRule(name,Buffer.from(await response.arrayBuffer())));
  renameSync(tmp,destination);
}
console.log('一键预设规则已就绪');
