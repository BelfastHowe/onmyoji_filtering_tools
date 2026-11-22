<script setup lang="ts">
import {computed,ref} from 'vue';
import type {PreviewMetric} from './PvePreview.vue';
import {soulSets} from '../app/soulSets';
const props=defineProps<{metrics:PreviewMetric[];initialKey:string}>();
defineEmits<{choose:[metric:PreviewMetric]}>();
const groups=[['loose','散件速度'],['hit','散件命中'],['resist','散件抵抗'],['set','套装一速'],['hit-set','套装命中']];
const group=ref(props.initialKey.startsWith('speed/')?props.initialKey.split('/')[1]:'loose');
const rows=computed(()=>props.metrics.filter(m=>m.key.split('/')[1]===group.value).sort((a,b)=>(b.value??-Infinity)-(a.value??-Infinity)||a.key.localeCompare(b.key)));
const icons=new Map(Object.values(soulSets).map(s=>[s.name,s.icon]));
</script>
<template><div class="segments" aria-label="一速类型"><button v-for="[id,label] in groups" :key="id" :aria-pressed="group===id" @click="group=id">{{label}}</button></div>
<div class="speed-grid"><button v-for="m in rows" :key="m.key" class="speed-card" :class="{ranked:m.key===initialKey}" :disabled="m.value===null" @click="$emit('choose',m)">
  <span><img v-if="icons.has(m.key.split('/')[2])" :src="icons.get(m.key.split('/')[2])" alt="">{{m.label}}</span>
  <strong>{{m.value===null?'未配出':'+'+m.value.toFixed(2)}}</strong><small v-if="m.value!==null">速度加成</small>
</button></div><p v-if="!rows.length" class="empty-state">此快照暂无该类型一速结果。</p></template>
