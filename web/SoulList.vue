<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {Soul} from '../app/domain';
import type {SetStats} from '../app/analysis';
import {inventoryFields,inventoryLabels,type InventoryField} from '../app/inventoryReport';
import {formatStat} from '../app/gearPanel';
import {soulSets} from '../app/soulSets';
import SoulDetail from './SoulDetail.vue';
const props=defineProps<{snapshot:number;stats:SetStats[]}>();
type Report={rows:{soul:Soul;value:number}[];bins:{pos:number;value:number;n:number}[];totals:{points:number}[];total:number};
const field=ref<InventoryField>('yield'),suit=ref(''),pos=ref(''),main=ref(''),special=ref(''),min=ref(''),max=ref(''),dir=ref('desc'),offset=ref(0);
const data=ref<Report|null>(null),error=ref(''),loading=ref(false),piece=ref<Soul|null>(null);
const attrs=['攻击','防御','生命','速度','攻击加成','防御加成','生命加成','暴击','暴击伤害','效果命中','效果抵抗'];
const groups=computed(()=>{const bins=new Map<number,number>();for(const b of data.value?.bins||[])bins.set(b.value,(bins.get(b.value)||0)+b.n);return [...bins].sort(([a],[b])=>b-a);});
watch([field,suit,pos,main,special,min,max,dir],()=>{offset.value=0;},{flush:'sync'});
watch([()=>props.snapshot,field,suit,pos,main,special,min,max,dir,offset],async(_,__,onCleanup)=>{
  const controller=new AbortController();onCleanup(()=>controller.abort());loading.value=true;error.value='';data.value=null;
  try{const q=new URLSearchParams({field:field.value,suit:suit.value,pos:pos.value,main:main.value,special:special.value,min:min.value,max:max.value,dir:dir.value,offset:String(offset.value)});
    const res=await fetch('/api/snapshots/'+props.snapshot+'/report?'+q,{signal:controller.signal});const result=await res.json();
    if(!res.ok)throw Error(result.error);if(!controller.signal.aborted)data.value=result;
  }catch(e){if(!controller.signal.aborted)error.value=String(e);}finally{if(!controller.signal.aborted)loading.value=false;}
},{immediate:true});
</script>
<template><div class="controls"><label>套装<select v-model="suit"><option value="">全部套装</option><option v-for="s in stats" :key="s.name">{{s.name}}</option></select></label>
<label>位置<select v-model="pos"><option value="">全部位置</option><option v-for="p in 6" :key="p" :value="p">{{p}}号位</option></select></label>
<label>主属性<select v-model="main"><option value="">全部属性</option><option v-for="a in attrs" :key="a">{{a}}</option></select></label>
<label>指标<select v-model="field"><option v-for="f in inventoryFields" :key="f" :value="f">{{inventoryLabels[f]}}</option></select></label>
<label>排序<select v-model="dir"><option value="desc">从高到低</option><option value="asc">从低到高</option></select></label></div>
<details class="more"><summary>更多筛选</summary><div class="controls"><label>固有属性<select v-model="special"><option value="">不限</option><option value="1">含固有属性</option><option value="0">无固有属性</option></select></label><label>指标下限<input v-model="min" type="number"></label><label>指标上限<input v-model="max" type="number"></label></div></details>
<p v-if="error" role="alert">{{error}}</p><p v-else-if="loading" role="status">正在读取御魂…</p>
<template v-if="data"><div class="list-summary"><span>共 <b>{{data.total.toLocaleString()}}</b> 件御魂</span><details v-if="field==='yield'"><summary>收益统计</summary><p>收益 ≥ 5 次的御魂合计 {{data.totals.reduce((n,r)=>n+r.points,0)}} 次</p><div class="yield-bins"><span v-for="[v,n] in groups" :key="v">{{v}} 次 · {{n}} 件</span></div></details></div>
<div class="tablewrap"><table class="soul-table"><thead><tr><th>御魂</th><th>位置</th><th>主属性</th><th>副属性</th><th>{{inventoryLabels[field]}}</th></tr></thead><tbody>
<tr v-for="{soul:s,value} in data.rows" :key="s.id"><td><button class="soul-identity" @click="piece=s"><img v-if="soulSets[s.suitId]" :src="soulSets[s.suitId].icon" alt="" loading="lazy"><span><b>{{s.suit}}</b><small>{{s.quality}}星 · +{{s.level}}</small></span></button></td>
<td>{{s.pos}}号</td><td>{{s.main[0]}} {{formatStat(...s.main)}}<small v-if="s.fixed">固有 · {{s.fixed[0]}} {{formatStat(...s.fixed)}}</small></td>
<td><div class="sub-grid"><span v-for="(v,k) in s.sub" :key="k">{{k}} {{formatStat(k,v)}}</span></div></td><td class="numeric">{{value}}</td></tr></tbody></table></div>
<p v-if="!data.total" class="empty-state">没有符合条件的御魂。</p><footer><button :disabled="!offset" @click="offset-=50">上一页</button><span>{{data.total?offset+1:0}}–{{Math.min(offset+50,data.total)}} / {{data.total}}</span><button :disabled="offset+50>=data.total" @click="offset+=50">下一页</button></footer></template>
<SoulDetail v-if="piece" :soul="piece" @close="piece=null"/></template>
