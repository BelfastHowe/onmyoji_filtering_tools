<script setup lang="ts">
import {computed,ref} from 'vue';
import {dimensions,type SetStats} from '../app/analysis';
import RadarPlot from './RadarPlot.vue';
import {soulSets} from '../app/soulSets';
const props=defineProps<{stats:SetStats[];radar:boolean}>();
const dimension=ref('速度'),suit=ref(''),view=ref('图表');
const icons=new Map(Object.values(soulSets).map(s=>[s.name,s.icon]));
const palette=['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272'];
const baseline:Record<string,number>={速度:18,效果命中:24,效果抵抗:24,攻击加成:18,生命加成:18,防御加成:18,暴击:18,暴击伤害:24};
const scale=computed(()=>Math.max(baseline[dimension.value],...props.stats.flatMap(s=>s.max[dimension.value])));
const rows=computed(()=>props.stats.filter(s=>!suit.value||s.name===suit.value).map(s=>({name:s.name,values:props.radar?s.max[dimension.value]:s.fullSpeed,total:s.fullSpeed.reduce((a,b)=>a+b,0)})).sort((a,b)=>props.radar?Math.max(...b.values)-Math.max(...a.values)||a.name.localeCompare(b.name,'zh'):b.total-a.total||a.name.localeCompare(b.name,'zh')));
const maxTotal=computed(()=>Math.max(1,...rows.value.map(r=>r.total)));
const unit=computed(()=>dimension.value==='速度'?'':'%');
</script>
<template><div class="chart-tools controls"><label v-if="radar">指标<select v-model="dimension" aria-label="指标"><option v-for="d in dimensions" :key="d">{{d}}</option></select></label>
<label>套装<select v-model="suit"><option value="">全部套装</option><option v-for="s in stats" :key="s.name">{{s.name}}</option></select></label>
<div class="segments"><button v-for="v in ['图表','明细表']" :key="v" :aria-pressed="view===v" @click="view=v">{{v}}</button></div></div>
<p v-if="!rows.length" class="empty-state">此快照暂无套装数据。</p>
<div v-else-if="view==='明细表'" class="tablewrap"><table><thead><tr><th>套装</th><th v-if="!radar">满速总数</th><th v-for="p in 6" :key="p">{{p}}号位</th></tr></thead><tbody><tr v-for="r in rows" :key="r.name"><th>{{r.name}}</th><td v-if="!radar">{{r.total}}</td><td v-for="(v,i) in r.values" :key="i">{{radar?v.toFixed(2)+unit:v}}</td></tr></tbody></table></div>
<div v-else-if="radar" class="radar-grid"><article v-for="r in rows" :key="r.name"><header><img v-if="icons.has(r.name)" :src="icons.get(r.name)" alt="" loading="lazy"><h3>{{r.name}}</h3></header>
<RadarPlot :name="r.name+' · '+dimension" :values="r.values" :scale="scale" :unit="unit"/></article></div>
<div v-else class="distribution"><div class="legend"><span v-for="(color,i) in palette" :key="color"><i :style="{background:color}"></i>{{i+1}}号位</span></div>
<div v-for="r in rows" :key="r.name" class="dist-row" :title="r.values.map((v,i)=>(i+1)+'号位 '+v+' 件').join(' · ')"><span>{{r.name}}</span><div class="track"><i v-for="(v,i) in r.values" :key="i" :style="{width:(100*v/maxTotal)+'%',background:palette[i]}" :aria-label="(i+1)+'号位 '+v+' 件'"></i></div><b>{{r.total}}</b></div></div></template>
