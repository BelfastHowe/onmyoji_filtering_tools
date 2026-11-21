<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Soul } from '../app/domain';
import type { SetStats } from '../app/analysis';
import { indicators } from '../app/analysis';
type Row={snapshot_id:number;name:string;server_name:string;price:number|null;url:string;souls:number;full_souls:number;value:number|null;state:string};
type Metric={key:string;label:string;value:number|null;ids:string[]};
type Filter={key:string;min:string;max:string};
type Catalog={counts:{accounts:number;souls:number;full:number};metrics:Metric[];batches:{id:number;created:string;accounts:number;version:string}[]};
const catalogue=ref<Catalog>({counts:{accounts:0,souls:0,full:0},metrics:[],batches:[]});
let saved:Partial<{metric:string;dir:string;filters:Filter[]}>={};
try{saved=JSON.parse(localStorage.getItem('cbg-library/filter-v1')||'{}')??{};}catch{}
const metric=ref(saved.metric||'speed/loose/1'),dir=ref(saved.dir||'desc'),filters=ref<Filter[]>(Array.isArray(saved.filters)?saved.filters:[]);
const search=ref(''),batch=ref(0),rows=ref<Row[]>([]),selected=ref<Row|null>(null),error=ref(''),message=ref(''),busy=ref(false);
const resetDialog=ref<HTMLDialogElement|null>(null),resetting=ref(false);
const detail=ref<{metrics:Metric[];stats:SetStats[]}>({metrics:[],stats:[]});
const tab=ref('一速方案'),pick=ref<Metric|null>(null),gear=ref<Soul[]>([]),items=ref<Soul[]>([]),total=ref(0),offset=ref(0),suit=ref(''),pos=ref(''),dim=ref('速度');
const activeLabel=computed(()=>catalogue.value.metrics.find(m=>m.key===metric.value)?.label||'散件一速');
const visibleMetrics=computed(()=>detail.value.metrics.filter(m=>m.key.startsWith(tab.value==='PVE 预览'?'pve/':'speed/')));
const bossTypes=['土蜘蛛','荒骷髅','鬼灵歌伎'];
const damageGroups=computed(()=>{
  const groups=new Map<string,(Metric|undefined)[]>();
  for(const m of visibleMetrics.value){
    const [,hero,set,boss]=m.key.split('/');
    if(hero!=='须佐之男'||!bossTypes.includes(boss))continue;
    const group=groups.get(set)??[];group[bossTypes.indexOf(boss)]=m;groups.set(set,group);
  }
  return [...groups].map(([name,cells])=>({name,cells,
    mean:cells.reduce((sum,m)=>sum+(m?.value??0),0)/bossTypes.length}));
});
const number=(v:number)=>v.toLocaleString('zh-CN');
const score=(v:number|null)=>v==null?'—':v.toFixed(2);
let rowsRev=0,detailRev=0,gearRev=0,itemRev=0,timer:ReturnType<typeof setTimeout>|undefined;
async function get<T>(url:string,init?:RequestInit):Promise<T>{
  const res=await fetch(url,init);const data=await res.json();if(!res.ok)throw Error(data.error||'请求失败');return data;
}
function fail(e:unknown){error.value=e instanceof Error?e.message:String(e);}
async function refreshRows(){
  const rev=++rowsRev;
  const q=new URLSearchParams({metric:metric.value,dir:dir.value,batch:String(batch.value),q:search.value});
  for(const f of filters.value)if(f.min!==''||f.max!=='')q.append('filter',JSON.stringify([f.key,f.min===''?null:Number(f.min),f.max===''?null:Number(f.max)]));
  try{const data=await get<Row[]>('/api/accounts?'+q);if(rev===rowsRev){rows.value=data;error.value='';}}
  catch(e){if(rev===rowsRev)fail(e);}
}
async function reload(){catalogue.value=await get<Catalog>('/api/catalogue');await refreshRows();}
async function poll(){
  try{
    const j=await get<{running:boolean;message:string;report?:{added:number;updated:number;duplicates:number;calculated:number;errors:{file:string;message:string}[]}}>('/api/job');
    busy.value=j.running;
    if(j.running){message.value=j.message;timer=setTimeout(poll,700);}
    else if(j.report){const r=j.report;message.value=`新增 ${r.added}，更新 ${r.updated}，重复 ${r.duplicates}，完成计算 ${r.calculated}`;await reload();
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
    catalogue.value={counts:{accounts:0,souls:0,full:0},metrics:[],batches:[]};
    search.value='';batch.value=0;metric.value='speed/loose/1';dir.value='desc';filters.value=[];
    message.value=result.message;
    await reload();
  }catch(e){fail(e);}
  finally{resetDialog.value?.close();resetting.value=false;}
}
watch([search,metric,dir,batch,filters],()=>{void refreshRows();localStorage.setItem('cbg-library/filter-v1',JSON.stringify({metric:metric.value,dir:dir.value,filters:filters.value}));},{deep:true});
watch(batch,()=>{selected.value=null;detailRev++;});
async function selectAccount(row:Row){
  const rev=++detailRev;selected.value=row;detail.value={metrics:[],stats:[]};pick.value=null;gear.value=[];gearRev++;suit.value='';pos.value='';offset.value=0;tab.value='一速方案';
  try{const version=catalogue.value.batches.find(b=>b.id===batch.value)?.version;
    const d=await get<typeof detail.value>(`/api/snapshots/${row.snapshot_id}/detail`+(version?'?version='+encodeURIComponent(version):''));
    if(rev!==detailRev)return;detail.value=d;
    const m=d.metrics.find(m=>m.key===metric.value);if(m){tab.value=m.key.startsWith('pve/')?'PVE 预览':'一速方案';await selectGear(m);}
  }catch(e){if(rev===detailRev)fail(e);}
}
async function selectGear(m:Metric){
  const rev=++gearRev;pick.value=m;gear.value=[];if(!m.ids.length||!selected.value)return;
  const q=new URLSearchParams();for(const id of m.ids)q.append('id',id);
  try{const data=await get<{rows:Soul[]}>(`/api/snapshots/${selected.value.snapshot_id}/souls?${q}`);if(rev===gearRev)gear.value=data.rows;}catch(e){if(rev===gearRev)fail(e);}
}
async function loadItems(){
  const rev=++itemRev;if(!selected.value||tab.value!=='御魂库存')return;
  try{const q=new URLSearchParams({suit:suit.value,pos:pos.value,offset:String(offset.value)});
    const d=await get<{rows:Soul[];total:number}>(`/api/snapshots/${selected.value.snapshot_id}/souls?${q}`);
    if(rev===itemRev){items.value=d.rows;total.value=d.total;}}catch(e){if(rev===itemRev)fail(e);}
}
watch([suit,pos],()=>{offset.value=0;});
watch([tab,suit,pos,offset,selected],loadItems);
function close(){selected.value=null;detailRev++;gearRev++;itemRev++;}
function openTab(t:string){
  tab.value=t;
  if(['一速方案','PVE 预览'].includes(t)){
    pick.value=null;gear.value=[];gearRev++;
    if(visibleMetrics.value.length)void selectGear(visibleMetrics.value[0]);
  }
}
function escape(e:KeyboardEvent){if(e.key==='Escape')close();}
onMounted(async()=>{window.addEventListener('keydown',escape);try{await reload();await poll();}catch(e){fail(e);}});
onUnmounted(()=>{clearTimeout(timer);window.removeEventListener('keydown',escape);});
</script>
<template>
<header class="mast"><div class="frame"><strong>御魂账号库</strong><span>本地工作台</span></div></header>
<main class="frame">
  <div class="title"><h1>账号总览</h1><div class="actions">
    <button class="reset-link" :disabled="busy || resetting" @click="resetDialog?.showModal()">清空数据库</button>
    <button class="primary" :disabled="busy || resetting" @click="rescan">{{busy?'正在处理…':'重新扫描账号目录'}}</button>
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
  <div class="title"><h2>账号排行</h2><small>{{rows.length}} 个结果</small></div>
  <section class="controls"><label>搜索<input v-model="search" placeholder="账号、区服或商品编号"></label>
    <label>数据范围<select v-model.number="batch"><option :value="0">当前账号库</option><option v-for="b in catalogue.batches" :key="b.id" :value="b.id">批次 {{b.id}} · {{b.accounts}} 个账号</option></select></label>
    <label>排行指标<select v-model="metric"><option v-if="!catalogue.metrics.length" value="speed/loose/1">散件一速</option><option v-for="m in catalogue.metrics" :key="m.key" :value="m.key">{{m.label}}</option></select></label>
    <label>排序<select v-model="dir"><option value="desc">从高到低</option><option value="asc">从低到高</option></select></label>
    <button @click="filters.push({key:metric,min:'',max:''})">添加条件</button></section>
  <div v-for="(f,i) in filters" :key="i" class="conditions"><select aria-label="筛选指标" v-model="f.key"><option v-for="m in catalogue.metrics" :key="m.key" :value="m.key">{{m.label}}</option></select><input aria-label="最低值" type="number" step="any" v-model="f.min" placeholder="最低值"><span>至</span><input aria-label="最高值" type="number" step="any" v-model="f.max" placeholder="最高值"><button @click="filters.splice(i,1)">移除</button></div>
  <div class="tablewrap"><table><thead><tr><th>账号 / 区服</th><th>挂牌价</th><th>御魂</th><th>六星 +15</th><th>{{activeLabel}}</th><th></th></tr></thead><tbody>
  <tr v-for="r in rows" :key="r.snapshot_id"><td><b>{{r.name}}</b><small>{{r.server_name}}</small></td><td>{{r.price===null?'—':'¥'+number(r.price/100)}}</td><td>{{number(r.souls)}}</td><td>{{number(r.full_souls)}}</td><td class="numeric">{{r.value===null?r.state:score(r.value)}}</td><td><button @click="selectAccount(r)">查看</button></td></tr></tbody></table></div>
  <p v-if="!rows.length">{{catalogue.counts.accounts?'没有符合条件的账号。':'将 JSON 放入 account_data 后，点击重新扫描。'}}</p>
</main>
<div v-if="selected" class="veil" @click.self="close"><section class="drawer" role="dialog" aria-modal="true" :aria-label="selected.name">
  <div class="title"><div><small>{{selected.server_name}}</small><h2>{{selected.name}}</h2></div><button @click="close">关闭</button></div>
  <a :href="selected.url" target="_blank" rel="noopener noreferrer">打开藏宝阁详情 ↗</a>
  <nav><button v-for="t in ['一速方案','PVE 预览','套装统计','御魂库存']" :key="t" :class="{active:tab===t}" @click="openTab(t)">{{t}}</button></nav>
  <div v-if="tab==='PVE 预览' && damageGroups.length" class="tablewrap"><table><thead><tr><th>须佐之男</th><th v-for="b in bossTypes">{{b}}</th><th>平均指标</th></tr></thead><tbody><tr v-for="g in damageGroups" :key="g.name"><td>{{g.name}}</td><td v-for="m in g.cells"><button v-if="m" @click="selectGear(m)">{{score(m.value)}}</button></td><td>{{score(g.mean)}}</td></tr></tbody></table></div>
  <template v-if="['一速方案','PVE 预览'].includes(tab)"><label>查看六件配装<select :value="pick?.key" @change="selectGear(visibleMetrics.find(m=>m.key===($event.target as HTMLSelectElement).value)!)"><option v-for="m in visibleMetrics" :value="m.key" :key="m.key">{{m.label}} · {{score(m.value)}}</option></select></label>
    <p v-if="pick?.value!=null">{{tab==='一速方案'?'御魂速度加成':'预设指标'}} <b class="numeric">{{score(pick.value)}}</b></p><p v-else>该项暂无可用组合。</p>
    <div class="gear" v-for="s in gear" :key="s.id"><b>{{s.pos}} 号位 · {{s.suit}}</b><span>{{s.main.join(' +')}} · 速度副属性 +{{score(s.sub['速度']||0)}}</span><small>{{s.id}}</small></div>
  </template>
  <template v-if="tab==='套装统计'"><label>各位置最高副属性<select v-model="dim"><option v-for="d in ['速度','效果命中','效果抵抗','攻击加成','生命加成','防御加成','暴击','暴击伤害']">{{d}}</option></select></label>
    <div class="tablewrap"><table><thead><tr><th>套装</th><th>件数</th><th>满速件数</th><th v-for="i in 6">{{i}} 号</th></tr></thead><tbody><tr v-for="g in detail.stats" :key="g.name"><td>{{g.name}}</td><td>{{g.count}}</td><td :title="g.fullSpeed.join(' / ')">{{g.fullSpeed.reduce((a,b)=>a+b,0)}}</td><td v-for="v in g.max[dim]">{{score(v)}}</td></tr></tbody></table></div>
  </template>
  <template v-if="tab==='御魂库存'"><div class="controls"><label>套装<select v-model="suit"><option value="">全部套装</option><option v-for="g in detail.stats">{{g.name}}</option></select></label><label>位置<select v-model="pos"><option value="">全部位置</option><option v-for="p in 6" :value="String(p)">{{p}} 号位</option></select></label></div>
    <div class="gear" v-for="s in items" :key="s.id"><b>{{s.pos}} 号位 · {{s.suit}} · {{s.quality}} 星 +{{s.level}}</b><span>主属性 {{s.main.join(' +')}}<template v-if="s.fixed"> · 固有 {{s.fixed.join(' +')}}</template></span><span>{{Object.entries(s.sub).map(([k,v])=>k+' '+score(v)).join(' · ')}}</span><details><summary>单件指标</summary>{{Object.entries(indicators(s)).map(([k,v])=>k+' '+v).join(' · ')}}</details><small>{{s.id}}</small></div>
    <footer><button :disabled="offset<50" @click="offset-=50">上一页</button><span>{{total?offset+1:0}}–{{Math.min(offset+50,total)}} / {{number(total)}}</span><button :disabled="offset+50>=total" @click="offset+=50">下一页</button></footer>
  </template>
</section></div>
</template>
