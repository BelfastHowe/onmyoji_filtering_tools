<script setup lang="ts">
import { computed } from 'vue';
import type { Soul } from '../app/domain';
import { formatStat, gearBonuses, heroForMetric } from '../app/gearPanel';
import { soulSets } from '../app/soulSets';
const props=defineProps<{gear:Soul[];metricKey:string;value:number}>();
defineEmits<{inspect:[soul:Soul]}>();
const hero=computed(()=>heroForMetric(props.metricKey));
const bonuses=computed(()=>gearBonuses(props.gear,hero.value));
const slots=computed(()=>[...props.gear].sort((a,b)=>a.pos-b.pos));
</script>
<template>
  <section class="loadout" aria-label="六件配装">
    <div class="wheel">
      <div class="wheel-rim" aria-hidden="true"></div>
      <div class="wheel-score"><span>{{hero?.name || '速度加成'}}</span><strong>{{value.toFixed(2)}}</strong></div>
      <button v-for="s in slots" :key="s.id" class="soul-slot" :class="'slot-'+s.pos"
        :aria-label="s.pos+'号位 '+s.suit+'，查看御魂详情'" @click="$emit('inspect',s)">
        <span class="emblem">
          <span class="arrow-frame" aria-hidden="true"></span>
          <img v-if="soulSets[s.suitId]" :src="soulSets[s.suitId].icon" alt=""><span v-else class="unknown-icon">{{s.suit.slice(0,1)}}</span>
          <span class="enhancement">+{{s.level}}</span>
        </span>
        <span class="slot-name"><b>{{s.pos}}</b>{{s.suit}}</span>
      </button>
    </div>
    <section v-if="bonuses" class="bonus-panel" aria-label="六件御魂属性加成">
      <h3>属性加成 <small>{{hero?.name}} · 预设基础面板</small></h3>
      <dl><div v-for="stat in bonuses" :key="stat.label"><dt>{{stat.label}}</dt><dd>{{formatStat(stat.label,stat.value)}}</dd></div></dl>
    </section>
  </section>
</template>
<style scoped>
.loadout{width:min(100%,520px);margin:16px auto 0;border:1px solid #ddcfad;border-radius:8px;overflow:hidden;background:#fbf8ef}
.wheel{position:relative;isolation:isolate;width:100%;aspect-ratio:1.42;background:radial-gradient(ellipse at center,#f4e7cb,#fffcf5 72%)}
.wheel-rim{position:absolute;left:50%;top:49%;width:59%;aspect-ratio:1;transform:translate(-50%,-50%);border:5px double #c5a56c;border-radius:50%;background:repeating-conic-gradient(from 29deg,transparent 0 58deg,#cfb683 59deg,transparent 60deg),radial-gradient(circle,#fffbf0 0 34%,#cfb683 34.5% 35%,#f2e6cc 35.5% 61%,#dfcaa0 61.6% 62%,#f9eed8 63%);box-shadow:0 0 0 4px #fbf5e7,0 0 0 5px #dfcca7}
.wheel-score{position:absolute;inset:50% auto auto 50%;transform:translate(-50%,-50%);display:grid;place-items:center;color:#6e5131;line-height:1.25}
.wheel-score span{font-size:clamp(11px,2vw,14px)}.wheel-score strong{font:600 clamp(14px,3vw,23px)/1.4 Georgia,serif}
.soul-slot{position:absolute;width:24%;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:2px;border:0;background:transparent;padding:0;color:#4d3c27}
.soul-slot:hover{background:transparent;color:#86581b}.soul-slot:hover .arrow-frame{box-shadow:0 0 0 3px #d39a48}
.slot-1{left:31%;top:20%;--angle:0deg}.slot-2{left:14%;top:50%;--angle:-45deg}.slot-3{left:31%;top:80%;--angle:-90deg}.slot-4{left:69%;top:80%;--angle:180deg}.slot-5{left:86%;top:50%;--angle:135deg}.slot-6{left:69%;top:20%;--angle:90deg}
.emblem{display:grid;place-items:center;position:relative;isolation:isolate;width:59%;aspect-ratio:1}
.arrow-frame{position:absolute;inset:0;z-index:-1;border:2px solid #70512d;border-radius:1px 50% 50% 50%;transform:rotate(var(--angle));background:linear-gradient(145deg,#fff4b4,#c5994d 35%,#79562c 63%,#edd08a);box-shadow:inset 0 0 0 2px #f6dfaa}
.emblem img,.unknown-icon{width:83%;height:83%;object-fit:contain;border-radius:50%;background:#463b36}.unknown-icon{display:grid;place-items:center;color:white}.enhancement{position:absolute;bottom:0;right:-3px;border:1px solid #d0b37e;border-radius:3px;background:#493923;color:white;font:600 11px/1.3 system-ui;padding:0 3px}
.slot-name{display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:12px}.slot-name b{color:#87622c;font:600 11px/1.1 system-ui}
.bonus-panel{background:#fffdf8;border-top:1px solid #ddcfad;padding:12px 16px}.bonus-panel h3{display:flex;align-items:baseline;justify-content:space-between;margin:0 0 8px}.bonus-panel dl{display:grid;grid-template-columns:1fr 1fr;column-gap:18px;margin:0}.bonus-panel dl div{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px solid #eee6d8}.bonus-panel dd{margin:0;color:#86581b;font-weight:600}.bonus-panel dt{white-space:nowrap}
@media(max-width:480px){.wheel{aspect-ratio:1.26}.emblem{width:67%}.slot-name{font-size:11px}.bonus-panel{padding:10px}.bonus-panel dl{column-gap:12px;font-size:13px}}
</style>
