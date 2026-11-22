<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import AccountWorkspace from './AccountWorkspace.vue';
import Teams from './Teams.vue';
import TemplatePicker from './TemplatePicker.vue';
import type {PreviewMetric as Metric} from './PvePreview.vue';
type Row={snapshot_id:number;name:string;server_name:string;price:number|null;url:string;souls:number;full_souls:number;value:number|null;state:string};
type Filter={key:string;min:string;max:string};
type Catalog={counts:{accounts:number;souls:number;full:number};metrics:Metric[];readyModes:string[];batches:{id:number;created:string;accounts:number;version:string}[]};
const catalogue=ref<Catalog>({counts:{accounts:0,souls:0,full:0},metrics:[],readyModes:[],batches:[]});
type SortLevel={key:string;dir:string};
let saved:Partial<{metric:string;dir:string;filters:Filter[];sorts:SortLevel[];templates:string[];match:string;pass:string}>={};
try{saved=JSON.parse(localStorage.getItem('cbg-library/filter-v1')||'{}')??{};}catch{}
const retiredMetrics=new Set(['inventory/points','inventory/matched-points','inventory/rated','inventory/zmax']);
if(saved.metric && retiredMetrics.has(saved.metric))delete saved.metric;
if(Array.isArray(saved.filters))saved.filters=saved.filters.filter(f=>!retiredMetrics.has(f.key));
if(Array.isArray(saved.sorts))saved.sorts=saved.sorts.filter(s=>!retiredMetrics.has(s.key));
const metric=ref(saved.metric||'speed/loose/1'),dir=ref(saved.dir||'desc'),filters=ref<Filter[]>(Array.isArray(saved.filters)?saved.filters:[]);
const search=ref(''),batch=ref(0),rows=ref<Row[]>([]),selected=ref<Row|null>(null),error=ref(''),message=ref(''),busy=ref(false);
const sorts=ref<SortLevel[]>(saved.sorts||[]),templates=ref<string[]>(saved.templates||[]),match=ref(saved.match||'all'),pass=ref(saved.pass||'1');
const teamOptions=computed(()=>catalogue.value.metrics.filter(m=>/\/\d+$/.test(m.key)&&catalogue.value.readyModes.some(prefix=>m.key.startsWith(prefix))));
const resetDialog=ref<HTMLDialogElement|null>(null),resetting=ref(false);
const teamRefresh=ref(0);
const activeLabel=computed(()=>catalogue.value.metrics.find(m=>m.key===metric.value)?.label||'散件一速');
const number=(v:number)=>v.toLocaleString('zh-CN');
const score=(v:number|null)=>v==null?'—':v.toFixed(2);
let rowsRev=0,timer:ReturnType<typeof setTimeout>|undefined;
async function get<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await fetch(url,init);const data=await res.json();if(!res.ok)throw Error(data.error||'请求失败');return data;
}
function fail(e:unknown){error.value=e instanceof Error?e.message:String(e);}
async function refreshRows(){
  const rev=++rowsRev;
  const q=new URLSearchParams({metric:metric.value,dir:dir.value,batch:String(batch.value),q:search.value});
  for(const s of sorts.value)q.append('then',JSON.stringify([s.key,s.dir]));
  for(const t of templates.value)q.append('template',t);
  q.set('match',match.value);q.set('pass',pass.value);
  for(const f of filters.value)if(f.min!==''||f.max!=='')q.append('filter',JSON.stringify([f.key,f.min===''?null:Number(f.min),f.max===''?null:Number(f.max)]));
  try{const data=await get<Row[]>('/api/accounts?'+q);if(rev===rowsRev){rows.value=data;error.value='';}}
  catch(e){if(rev===rowsRev)fail(e);}
}
let catalogueRev=0;
async function reload(){
  const rev=++catalogueRev,scope=batch.value;
  const data=await get<Catalog>('/api/catalogue?batch='+scope);
  if(rev!==catalogueRev||scope!==batch.value)return;
  catalogue.value=data;
  const allowed=new Set(teamOptions.value.map(m=>m.key));
  if(templates.value.some(key=>!allowed.has(key)))templates.value=templates.value.filter(key=>allowed.has(key));
  await refreshRows();
}
async function poll(){
  try{
    const j=await get<{running:boolean;message:string;report?:{added:number;updated:number;duplicates:number;calculated:number;errors:{file:string;message:string}[]}}>('/api/job');
    busy.value=j.running;
    if(j.running){message.value=j.message;timer=setTimeout(poll,700);}
    else if(j.report){const r=j.report;message.value=`新增 ${r.added}，更新 ${r.updated}，重复 ${r.duplicates}，新算基础分析 ${r.calculated}。`;teamRefresh.value++;await reload();
      if(r.errors.length)error.value=r.errors.map(e=>e.file+' · '+e.message).join('；');}
    else if(j.message){message.value=j.message;}
  }catch(e){busy.value=false;fail(e);}
}
async function rescan(){try{busy.value=true;error.value='';await get('/api/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await poll();}catch(e){busy.value=false;fail(e);}}
async function confirmReset(){
  if(busy.value || resetting.value)return;
  resetting.value=true;
  error.value='';
  try {
    const result=await get<{message:string}>('/api/reset',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    close();
    rowsRev++;
    rows.value=[];
    catalogue.value={counts:{accounts:0,souls:0,full:0},metrics:[],readyModes:[],batches:[]};
    search.value='';batch.value=0;metric.value='speed/loose/1';dir.value='desc';filters.value=[];
    sorts.value=[];templates.value=[];
    message.value=result.message;
    teamRefresh.value++;
    await reload();
  }catch(e){fail(e);}
  finally{resetDialog.value?.close();resetting.value=false;}
}
watch([search,metric,dir,filters,sorts,templates,match,pass],()=>{void refreshRows();localStorage.setItem('cbg-library/filter-v1',JSON.stringify({metric:metric.value,dir:dir.value,filters:filters.value,sorts:sorts.value,templates:templates.value,match:match.value,pass:pass.value}));},{deep:true});
let listScroll=0;
let trigger:HTMLElement|null=null;
function selectAccount(row:Row,event:MouseEvent){
  listScroll=window.scrollY;trigger=event.currentTarget as HTMLElement;selected.value=row;
  window.scrollTo(0,0);
}
function close(){
  if(selected.value){teamRefresh.value++;void reload().catch(fail);}
  selected.value=null;
  requestAnimationFrame(()=>{trigger?.focus({preventScroll:true});window.scrollTo(0,listScroll);});
}
watch(batch,()=>{selected.value=null;void reload().catch(fail);});
onMounted(async()=>{try{await reload();await poll();}catch(e){fail(e);}});
onUnmounted(()=>clearTimeout(timer));
</script>
<template>
<header class="mast"><div class="frame"><div class="brand"><i aria-hidden="true">◈</i><strong>御魂账号库</strong></div><span class="mast-route">账号库 <template v-if="selected"> / 账号详情</template></span></div></header>
<main v-show="!selected" class="frame library">
  <div class="title"><h1>账号总览</h1><div class="actions">
    <button class="reset-link" :disabled="busy || resetting" @click="resetDialog?.showModal()">清空数据库</button>
    <button class="primary" :disabled="busy || resetting" @click="rescan">{{busy?'正在处理…':'添加账号并计算'}}</button>
  </div></div>
  <dialog ref="resetDialog" aria-labelledby="reset-title" aria-describedby="reset-scope" @cancel="resetting && $event.preventDefault()">
    <h2 id="reset-title">清空整个账号库？</h2>
    <p id="reset-scope">将永久删除全部 {{number(catalogue.counts.accounts)}} 个账号的库存、配装和分析结果，以及 {{number(catalogue.batches.length)}} 个历史批次。清空范围包含所有筛选条件之外的账号。</p>
    <p>原始 JSON 会保留在 <code>account_data</code> 目录中，可重新扫描并计算。</p>
    <div class="actions"><button autofocus :disabled="resetting" @click="resetDialog?.close()">取消</button>
      <button class="danger" :disabled="busy || resetting" @click="confirmReset">{{resetting?'正在清空…':'确认清空'}}</button></div>
  </dialog>
  <p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert" class="error">{{error}}</p>
  <section class="totals" aria-label="当前库统计"><div><span>当前账号</span><strong>{{number(catalogue.counts.accounts)}}</strong></div><div><span>御魂总数</span><strong>{{number(catalogue.counts.souls)}}</strong></div><div><span>六星 +15</span><strong>{{number(catalogue.counts.full)}}</strong></div></section>
  <details class="ranking"><summary>一键预设 · 手动批量计算</summary><Teams :refresh-token="teamRefresh" @refresh="reload"/></details>
  <section class="ranking"><div class="title"><h2>账号排行</h2><small>{{rows.length}} 个结果</small></div>
  <section class="controls"><label>搜索<input v-model="search" placeholder="账号、区服或商品编号"></label>
    <label>数据范围<select v-model.number="batch"><option :value="0">当前账号库</option><option v-for="b in catalogue.batches" :key="b.id" :value="b.id">批次 {{b.id}} · {{b.accounts}} 个账号</option></select></label>
    <label>排行指标<select v-model="metric"><option v-if="!catalogue.metrics.length" value="speed/loose/1">散件一速</option><option v-for="m in catalogue.metrics" :key="m.key" :value="m.key">{{m.label}}</option></select></label>
    <label>排序<select v-model="dir"><option value="desc">从高到低</option><option value="asc">从低到高</option></select></label>
    <button @click="filters.push({key:metric,min:'',max:''})">添加条件</button></section>
  <div v-for="(f,i) in filters" :key="i" class="conditions"><select aria-label="筛选指标" v-model="f.key"><option v-for="m in catalogue.metrics" :key="m.key" :value="m.key">{{m.label}}</option></select><input aria-label="最低值" type="number" step="any" v-model="f.min" placeholder="最低值"><span>至</span><input aria-label="最高值" type="number" step="any" v-model="f.max" placeholder="最高值"><button @click="filters.splice(i,1)">移除</button></div>
  <details><summary>阵容筛选与多级排序</summary><div class="controls"><TemplatePicker v-model="templates" :options="teamOptions"/>
    <label>匹配<select v-model="match"><option value="all">全部选中模板</option><option value="any">任一选中模板</option></select></label>
    <label>结论<select v-model="pass"><option value="1">配装达标</option><option value="0">未达标</option></select></label><button @click="templates=[]">清除阵容条件</button></div>
    <div v-for="(s,i) in sorts" :key="i" class="conditions"><label>第 {{i+2}} 排序指标<select v-model="s.key"><option v-for="m in catalogue.metrics" :value="m.key">{{m.label}}</option></select></label>
      <select v-model="s.dir" aria-label="排序方向"><option value="asc">从低到高</option><option value="desc">从高到低</option></select><button @click="sorts.splice(i,1)">移除</button></div>
    <button :disabled="sorts.length>=2" @click="sorts.push({key:metric,dir:'desc'})">添加次级排序</button>
  </details>
  <div class="tablewrap"><table><thead><tr><th>账号 / 区服</th><th>挂牌价</th><th>御魂</th><th>六星 +15</th><th>{{activeLabel}}</th><th></th></tr></thead><tbody>
  <tr v-for="r in rows" :key="r.snapshot_id"><td><b>{{r.name}}</b><small>{{r.server_name}}</small></td><td>{{r.price===null?'—':'¥'+number(r.price/100)}}</td><td>{{number(r.souls)}}</td><td>{{number(r.full_souls)}}</td><td class="numeric">{{r.value===null?r.state:score(r.value)}}</td><td><button @click="selectAccount(r,$event)">查看账号 →</button></td></tr></tbody></table></div>
  <p v-if="!rows.length">{{catalogue.counts.accounts?'没有符合条件的账号。':'将 JSON 放入 account_data 后，点击「添加账号并计算」。'}}</p>
  </section>
</main>
<AccountWorkspace v-if="selected" :key="selected.snapshot_id" :account="selected" :metric-key="metric"
  :version="catalogue.batches.find(b=>b.id===batch)?.version" @close="close"/>
</template>
