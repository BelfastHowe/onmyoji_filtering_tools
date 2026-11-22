import {readFile,writeFile,rename,readdir,stat,rm} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './domain.ts';

// This command is opt-in. Starting the web server or importing a directory
// never calls this endpoint. It is the converter used by the site's upload page.
const input=process.argv[2];
if(!input)throw Error('请指定要发送到 api.yyshub.top 的账号 JSON 文件或目录');
const path=resolve(input);
const files=(await stat(path)).isDirectory()
  ?(await readdir(path,{withFileTypes:true})).filter(f=>f.isFile()&&f.name.endsWith('.json')&&!f.name.startsWith('ref-')).map(f=>join(path,f.name)).sort()
  :[path];
const origin='https://api.yyshub.top';
let failures=0;
for(const file of files){
  let temp='';
  try{
    const bytes=await readFile(file);
    const raw=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
    if(Array.isArray(raw.data?.hero_equips))continue;
    if(Number(raw.status)!==1||!(raw.equip??raw.equip_data)?.equip_desc)throw Error('不是成功的藏宝阁详情');
    const dest=join(dirname(file),'ref-'+hash(bytes)+'.json');
    try{await stat(dest);continue;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    const form=new FormData();
    form.append('raw_file',new Blob([bytes],{type:'application/json'}),basename(file));
    const upload=await fetch(origin+'/s/up-to-std',{method:'POST',body:form,redirect:'error',signal:AbortSignal.timeout(90000)});
    if(!upload.ok)throw Error('HTTP '+upload.status);
    const response=await upload.json();
    if(response.c!==10200||!response.d?.yyxSimplifyDownload)throw Error(String(response.m||'魔方未返回参考文件'));
    const url=new URL(response.d.yyxSimplifyDownload,origin);
    if(!['https://yyshub.top',origin].includes(url.origin))throw Error('参考文件地址不属于魔方');
    const download=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(90000)});
    if(!download.ok)throw Error('参考文件下载失败 '+download.status);
    const content=await download.text();
    if(!Array.isArray(JSON.parse(content).data?.hero_equips))throw Error('参考文件缺少御魂列表');
    temp=dest+'.'+randomUUID()+'.part';
    await writeFile(temp,content);await rename(temp,dest);temp='';
    console.log('已保存 '+basename(dest));
  }catch(e){failures++;console.error(basename(file)+': '+(e instanceof Error?e.message:String(e)));}
  finally{if(temp)await rm(temp,{force:true});}
}
if(failures)process.exitCode=1;
