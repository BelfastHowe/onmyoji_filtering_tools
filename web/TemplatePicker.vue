<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref} from 'vue';
const props=defineProps<{options:{key:string;label:string}[]}>();
const selected=defineModel<string[]>({required:true});
const root=ref<HTMLElement>(),trigger=ref<HTMLButtonElement>(),opened=ref(false),query=ref('');
const visible=computed(()=>props.options.filter(o=>o.label.includes(query.value.trim())));
function outside(event:PointerEvent){if(!root.value?.contains(event.target as Node))opened.value=false;}
function escape(){opened.value=false;trigger.value?.focus();}
onMounted(()=>document.addEventListener('pointerdown',outside));
onUnmounted(()=>document.removeEventListener('pointerdown',outside));
</script>
<template>
  <div ref="root" class="picker" @keydown.esc.stop="escape" @focusout="!root?.contains($event.relatedTarget as Node) && (opened=false)">
    <label for="team-picker-trigger">阵容模板（可多选）</label>
    <button ref="trigger" id="team-picker-trigger" class="trigger" :aria-expanded="opened" aria-controls="team-options"
      :disabled="!options.length" @click="opened=!opened">
      {{!options.length?'当前范围内，所有账号完成任一模式后可筛选':selected.length?'已选 '+selected.length+' 个阵容模板':'选择阵容模板'}} <span aria-hidden="true">▾</span>
    </button>
    <div v-if="opened && options.length" id="team-options" class="panel" role="group" aria-label="阵容模板">
      <input v-model="query" type="search" aria-label="搜索阵容模板" placeholder="搜索模式、副本或式神">
      <div class="choices">
        <label v-for="o in visible" :key="o.key"><input v-model="selected" type="checkbox" :value="o.key"><span>{{o.label}}</span></label>
        <p v-if="!visible.length">没有匹配的阵容模板</p>
      </div>
    </div>
  </div>
</template>
<style scoped>
.picker{position:relative;flex:1 1 min(100%,38rem);min-width:0;max-width:62rem}
.trigger{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:42px;text-align:left;margin-top:5px}
.panel{position:absolute;z-index:5;top:100%;inset-inline:0;margin-top:4px;padding:10px;background:white;border:1px solid #c6d4e2;border-radius:6px;box-shadow:0 6px 22px #29485e26}
.panel>input{width:100%}.choices{max-height:min(40vh,340px);overflow:auto;margin-top:6px}
.choices label{display:flex;align-items:baseline;gap:10px;padding:7px 6px;color:#324a62;cursor:pointer;overflow-wrap:anywhere}
.choices label:hover,.choices label:focus-within{background:#edf6ff}.choices input[type=checkbox]{flex:none;width:16px;height:16px;margin:0;accent-color:#267dc7}
</style>
