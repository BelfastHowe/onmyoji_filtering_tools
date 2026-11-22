<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
import type {SetStats} from '../app/analysis';
import type {Soul} from '../app/domain';
import {effectGain} from '../app/inventoryReport';
import Teams from './Teams.vue';
import SoulList from './SoulList.vue';
import SetCharts from './SetCharts.vue';
import SpeedPreview from './SpeedPreview.vue';
import PvePreview,{type PreviewMetric as Metric} from './PvePreview.vue';
import GearWheel from './GearWheel.vue';
import SoulDetail from './SoulDetail.vue';
const props=defineProps<{account:{snapshot_id:number;name:string;server_name:string;souls:number;full_souls:number;url:string};metricKey:string;version?:string}>();
const emit=defineEmits<{close:[]}>();
const pages=['一键预设','御魂列表','一速预览','PVE 预览','套装多维度雷达图','套装满速分布情况'] as const;
type Page=typeof pages[number];
const key=props.metricKey;
const page=ref<Page>(key.startsWith('team/')?'一键预设':key.startsWith('pve')?'PVE 预览':key.startsWith('inventory/fullspeed/')?'套装满速分布情况':key.startsWith('inventory/')?'御魂列表':'一速预览');
const mode=ref<'quick'|'optimal'>(key.startsWith('pve/')?'optimal':'quick');
const dense=ref(localStorage.getItem('cbg-library/density')==='compact');
function toggleDensity(){dense.value=!dense.value;localStorage.setItem('cbg-library/density',dense.value?'compact':'comfortable');}
const stats=ref<SetStats[]>([]),metrics=ref<Metric[]>([]),loading=ref(true),error=ref('');
const gear=ref<Soul[]>([]),pick=ref<Metric|null>(null),piece=ref<Soul|null>(null),message=ref('');
const hasQuick=computed(()=>metrics.value.some(m=>m.key.startsWith('pve-fast/')));
const previews=computed(()=>{
  const quick=hasQuick.value&&mode.value==='quick';
  return metrics.value.filter(m=>m.key.startsWith(quick?'pve-fast/':'pve/')).map(m=>({...m,key:m.key.replace(/^pve-fast\/[^/]+\//,'pve/')}));
});
const speeds=computed(()=>metrics.value.filter(m=>m.key.startsWith('speed/')));
const secondary=computed(()=>pick.value?.key.startsWith('speed/resist/')?'效果抵抗':/^speed\/(hit|hit-set)\//.test(pick.value?.key||'')?'效果命中':null);
let gearRequest=0;
const speedDialog=ref<HTMLDialogElement>(),heading=ref<HTMLElement>();
function clearGear(){gearRequest++;pick.value=null;gear.value=[];piece.value=null;}
function navigate(next:Page){if(page.value!==next){clearGear();page.value=next;}}
const base='/api/snapshots/'+props.account.snapshot_id;
async function get(path:string){const response=await fetch(base+path);const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
async function choose(m:Metric){
  const request=++gearRequest;pick.value=m;gear.value=[];message.value='正在读取配装…';
  if(page.value==='一速预览')speedDialog.value?.showModal();
  try{const data=await get('/souls?'+new URLSearchParams(m.ids.map(id=>['id',id])));
    if(request!==gearRequest)return;
    if(data.rows.length===6)gear.value=data.rows;else message.value='该快照缺少完整的六件御魂。';
  }catch(e){if(request===gearRequest)message.value=String(e);}
}
async function load(){
  loading.value=true;error.value='';
  try{const data=await get('/detail'+(props.version?'?'+new URLSearchParams({version:props.version}):''));stats.value=data.stats;metrics.value=data.metrics;
    if(page.value==='PVE 预览')pick.value=previews.value.find(m=>m.key===key.replace(/^pve-fast\/[^/]+\//,'pve/'))??null;}
  catch(e){error.value=String(e);}finally{loading.value=false;}
}
function escape(e:KeyboardEvent){if(e.key==='Escape'&&!document.querySelector('dialog[open], [popover]:popover-open'))emit('close');}
onMounted(()=>{heading.value?.focus({preventScroll:true});void load();window.addEventListener('keydown',escape);});
onUnmounted(()=>{gearRequest++;window.removeEventListener('keydown',escape);});
</script>
<template>
<main class="frame workspace" :class="{compact:dense}">
  <header class="account-head">
    <div class="account-id"><button class="back" aria-label="返回账号排行" @click="emit('close')">← 账号排行</button><h1 ref="heading" tabindex="-1">{{account.name}}</h1><span>{{account.server_name}}</span></div>
    <div class="account-meta"><span><b>{{account.souls.toLocaleString()}}</b> 件御魂</span><span><b>{{account.full_souls.toLocaleString()}}</b> 六星 +15</span><a :href="account.url" target="_blank" rel="noopener noreferrer">藏宝阁 ↗</a></div>
  </header>
  <div class="module-bar"><nav aria-label="账号分析页面"><button v-for="p in pages" :key="p" :aria-current="page===p?'page':undefined" @click="navigate(p)">{{p}}</button></nav>
    <button class="density" :aria-pressed="dense" @click="toggleDensity">紧凑显示</button></div>
  <section class="module-panel" :aria-label="page">
    <h2 v-if="page!=='PVE 预览'" class="module-title">{{page}}</h2>
    <p v-if="error" role="alert" class="error">{{error}} <button @click="load">重试</button></p>
    <p v-else-if="loading" role="status">正在读取账号数据…</p>
    <Teams v-else-if="page==='一键预设'" :snapshot="account.snapshot_id" :version="version" :initial-mode="key.startsWith('team/')?key.split('/')[2]:undefined" :initial-scene="key.startsWith('team/')?key.split('/')[3]:undefined" :initial-index="key.startsWith('team/')?Number(key.split('/')[4]):undefined"/>
    <SoulList v-else-if="page==='御魂列表'" :snapshot="account.snapshot_id" :stats="stats"/>
    <SpeedPreview v-else-if="page==='一速预览'" :metrics="speeds" :initial-key="key.replace(/^secondary\//,'')" @choose="choose"/>
    <PvePreview v-else-if="page==='PVE 预览'" :metrics="previews" :selected="pick" @choose="choose">
      <template #controls><label v-if="hasQuick">预览算法<select v-model="mode" @change="clearGear"><option value="quick">魔方快速</option><option value="optimal">本地最优</option></select></label></template>
      <GearWheel v-if="pick?.value!=null && gear.length===6" :gear="gear" :metric-key="pick.key" :value="pick.value" @inspect="piece=$event"/>
      <p v-else role="status">{{message}}</p>
    </PvePreview>
    <SetCharts v-else :stats="stats" :radar="page==='套装多维度雷达图'"/>
  </section>
  <dialog ref="speedDialog" class="gear-dialog" @close="clearGear" @click.self="speedDialog?.close()"><header><h3>{{pick?.label}}</h3><button autofocus @click="speedDialog?.close()">关闭配装</button></header>
    <GearWheel v-if="gear.length===6 && pick?.value!=null" :gear="gear" :metric-key="pick.key" :value="pick.value" @inspect="piece=$event"/>
    <p v-else role="status">{{message}}</p>
    <p v-if="gear.length===6 && secondary">{{secondary}}加成 <strong>{{effectGain(gear,secondary).toFixed(2)}}%</strong></p>
  </dialog>
  <SoulDetail v-if="piece" :soul="piece" :equipped-count="gear.filter(s=>s.suitId===piece?.suitId).length" @close="piece=null"/>
</main>
</template>
