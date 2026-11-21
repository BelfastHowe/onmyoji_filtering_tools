<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { Soul } from '../app/domain';
import { soulSets } from '../app/soulSets';
import { extraRolls,formatStat } from '../app/gearPanel';
const props=defineProps<{soul:Soul;equippedCount?:number}>();
const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement>();
const suit=computed(()=>soulSets[props.soul.suitId]);
const numerals=['','一','二','三','四','五','六'];
onMounted(()=>dialog.value?.showModal());
</script>
<template>
  <dialog ref="dialog" class="soul-detail" aria-labelledby="soul-title" @close="emit('close')" @click.self="dialog?.close()">
    <article>
      <header><strong>{{numerals[soul.pos]}}号位</strong><small>{{soul.locked?'已锁定':''}}{{soul.discarded?' · 已弃置':''}}</small><button autofocus aria-label="关闭御魂详情" @click="dialog?.close()">×</button></header>
      <div class="identity"><img v-if="suit" :src="suit.icon" alt=""><div><h2 id="soul-title">{{soul.suit}}</h2><span class="stars" :aria-label="soul.quality+'星'">{{'★'.repeat(soul.quality)}}</span></div><b class="level">+{{soul.level}}</b></div>
      <dl class="properties">
        <div class="main-stat"><dt>{{soul.main[0]}} <small>主属性</small></dt><dd>{{formatStat(...soul.main)}}</dd></div>
        <div v-for="(value,label) in soul.sub" :key="label"><dt>{{label}}</dt><dd>{{formatStat(label,value)}} <sup v-if="extraRolls(soul,label)" :title="'强化命中 '+extraRolls(soul,label)+' 次'">{{extraRolls(soul,label)}}</sup></dd></div>
        <div v-if="soul.fixed"><dt>{{soul.fixed[0]}} <small>固有</small></dt><dd>{{formatStat(...soul.fixed)}}</dd></div>
      </dl>
      <section v-if="suit?.two || suit?.four" class="set-effects">
        <p v-if="suit.two"><b>两件套</b> {{suit.two}} <small v-if="equippedCount!==undefined">{{equippedCount>=2?'已配齐':'未配齐'}}</small></p>
        <p v-if="suit.four"><b>四件套</b> {{suit.four}} <small v-if="equippedCount!==undefined">{{equippedCount>=4?'已配齐':'未配齐'}}</small></p>
      </section>
      <details><summary>御魂编号</summary><code>{{soul.id}}</code></details>
    </article>
  </dialog>
</template>
<style scoped>
.soul-detail{width:min(390px,92vw);max-height:90dvh;padding:0;color:#453629;background:#f7efdf;border:1px solid #aa8959;border-radius:8px;box-shadow:0 16px 64px #17202f45}
.soul-detail article{padding:18px 20px}.soul-detail header,.identity,.properties div{display:flex;align-items:center;gap:10px}
.soul-detail header{border-bottom:1px solid #d8c5a4;padding-bottom:9px}.soul-detail header small{margin-left:auto}.soul-detail header button{font-size:22px;line-height:1;padding:3px 7px;color:#715c40;background:transparent;border:0}
.identity{padding:14px 0}.identity img{width:58px;height:58px;object-fit:contain}.identity h2{font-size:22px;color:#4d3724}.stars{font-size:11px;letter-spacing:2px;color:#976322}.level{margin-left:auto;background:#985335;color:#fff6de;padding:1px 8px;border-radius:3px}
.properties{margin:0}.properties div{justify-content:space-between;padding:5px 7px}.main-stat{background:#e9dbc1;color:#86421e;font-weight:600}.properties dd{margin:0}.properties sup{padding:1px 4px;border-radius:50%;background:#a37a4e;color:white;font-size:10px}.set-effects{border-top:1px solid #d8c5a4;margin-top:10px;color:#426343}.set-effects p{margin:8px 0}.set-effects small{white-space:nowrap;color:#657b5a}.soul-detail details{margin-top:12px;color:#756750;font-size:12px}.soul-detail code{overflow-wrap:anywhere}
</style>
