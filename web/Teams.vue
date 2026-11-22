<script setup lang="ts">
import {computed,onMounted,onUnmounted,ref,watch} from 'vue';
import type {Template,TeamResult,MemberResult} from '../app/teamEngine';
import type {Soul} from '../app/domain';
import GearWheel from './GearWheel.vue';
import SoulDetail from './SoulDetail.vue';
const props=defineProps<{snapshot?:number;version?:string;initialScene?:string;initialIndex?:number;initialMode?:string;refreshToken?:number}>();
const emit=defineEmits<{refresh:[]}>();
type Entry={status:string;config:Template;result:(TeamResult&{missing:string[]})|null;error:string|null;elapsed:number|null};
const mode=ref(props.initialMode||'严格快速'),scene=ref(props.initialScene||'魂土'),state=ref('全部'),entries=ref<Entry[]>([]);
const progress=ref<{status:string;n:number}[]>([]),paused=ref(false),error=ref(''),working=ref(false),expanded=ref<number|undefined>(props.initialIndex);
const overall=ref<{total:number;done:number;active:number}>();
const cpu=ref<{physical:number|null;logical:number;available:number}>(),threads=ref(0),canCalculate=ref(false);
const filtered=computed(()=>entries.value.filter(r=>r.config.scene===scene.value && (state.value==='全部'||state.value===status(r))));
const scenes=computed(()=>Array.from(new Set(entries.value.map(r=>r.config.scene))));
const member=ref<MemberResult>(),gear=ref<Soul[]>([]),dialog=ref<HTMLDialogElement>(),piece=ref<Soul|null>(null),gearError=ref('');
let timer:ReturnType<typeof setTimeout>,generation=0,rev=0,previousDone=-1;
function status(r:Entry){return r.result?(r.result.pass?'达标':'未达标'):r.status;}
async function request(url:string,post=false){const res=await fetch(url,post?{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}:{});const result=await res.json();if(!res.ok)throw Error(result.error);return result;}
async function refresh(){
  const id=++generation;clearTimeout(timer);
  try{
    const q=new URLSearchParams({mode:mode.value});if(props.version)q.set('version',props.version);
    if(props.snapshot)q.set('snapshot',String(props.snapshot));else q.set('overall','1');
    const [p,items]=await Promise.all([request('/api/teams?'+q),props.snapshot?request('/api/snapshots/'+props.snapshot+'/teams?'+q):Promise.resolve([])]);
    if(id!==generation)return;
    progress.value=p.rows;paused.value=p.paused;error.value=p.error;entries.value=items;
    overall.value=p.overall;
    cpu.value=p.cpu;threads.value=p.threads;canCalculate.value=p.canCalculate;
    const done=Number(p.overall?.done??p.rows.find((r:{status:string})=>r.status==='完成')?.n??0);
    if(previousDone>=0 && previousDone!==done && !props.snapshot)emit('refresh');
    previousDone=done;
    if(p.overall?.active||p.rows.some((r:{status:string})=>r.status==='运行中'||(!p.paused && r.status==='待算')))timer=setTimeout(refresh,3500);
  }catch(e){if(id===generation)error.value=String(e);}
}
async function action(action:string){
  working.value=true;
  const q=new URLSearchParams({action,mode:mode.value});
  if(props.snapshot)q.set('snapshot',String(props.snapshot));
  if(props.version)q.set('version',props.version);
  try{await request('/api/teams?'+q,true);await refresh();}catch(e){error.value=String(e);}finally{working.value=false;}
}
async function showGear(m:MemberResult){
  const id=++rev;member.value=m;gear.value=[];gearError.value='';dialog.value?.showModal();
  try{const params=new URLSearchParams(m.ids.map(id=>['id',id]));
    const data=await request('/api/snapshots/'+props.snapshot+'/souls?'+params);
    if(rev===id){gear.value=data.rows;if(data.rows.length!==6)gearError.value='配装明细缺失';}
  }catch(e){if(id===rev)gearError.value=String(e);}
}
watch([mode,()=>props.snapshot,()=>props.version],()=>{expanded.value=undefined;void refresh();});
onMounted(refresh);
watch(()=>props.refreshToken,refresh);
onUnmounted(()=>{generation++;rev++;clearTimeout(timer);});
</script>
<template>
  <section class="teams">
    <div class="controls"><label>阵容计算模式<select v-model="mode"><option v-for="m in ['严格快速','宽容快速','严格精确','宽容精确']" :key="m">{{m}}</option></select></label>
      <button class="primary" :disabled="working||!canCalculate" @click="action('start')">{{snapshot?'计算当前账号':'计算全部当前账号'}}</button>
      <button v-if="!snapshot" :disabled="working||paused" @click="action('pause')">暂停此模式</button>
      <label v-else>模板状态<select v-model="state"><option v-for="s in ['全部','达标','未达标','待算','运行中','已暂停','出错']" :key="s">{{s}}</option></select></label>
      <button @click="refresh">刷新</button>
    </div>
    <small v-if="cpu && !snapshot">CPU · <template v-if="cpu.physical">{{cpu.physical}} 核 / </template>{{cpu.logical}} 线程 · 可用 {{cpu.available}} 线程<template v-if="threads"> · 当前模式使用 {{threads}} 个工作线程</template></small>
    <div v-if="snapshot && scenes.length" class="segments" aria-label="选择副本"><button v-for="s in scenes" :key="s" :aria-pressed="scene===s" @click="scene=s;expanded=undefined">{{s}}</button></div>
    <p v-if="error" role="alert" class="error">{{error}}</p>
    <p v-if="!snapshot" role="status"><template v-if="overall?.total">全部模式已完成 {{overall.done}} / {{overall.total}} · </template>{{mode}} · {{paused?'已暂停 · ':''}}{{progress.map(p=>p.status+' '+p.n).join(' · ')||'暂无任务'}}</p>
    <p v-else-if="!filtered.length">{{entries.length?'没有符合条件的模板。':canCalculate?'此账号尚无该模式的结果。选择模式后点击「计算当前账号」。':'该历史版本暂无阵容结果。'}}</p>
    <article v-for="r in filtered" :key="r.config.scene+r.config.index">
      <button class="row" :aria-expanded="expanded===r.config.index" @click="expanded=expanded===r.config.index?undefined:r.config.index">
        <span>#{{r.config.index+1}}　{{r.config.name}}</span><strong :class="r.result?(r.result.pass?'pass':'miss'):''">{{status(r)}}</strong>
      </button>
      <section v-if="expanded===r.config.index" class="content">
        <p>{{r.config.members.join(' → ')}} <span v-if="r.config.seconds"> · 模板 {{r.config.seconds}} 秒</span></p>
        <p v-if="r.config.requirements.length">{{r.config.requirements.join(' · ')}}</p><p v-if="r.error" role="alert">{{r.error}}</p>
        <template v-if="r.result"><p>{{r.result.missing.length?'缺少式神：'+r.result.missing.join('、'):'式神齐全'}} · 计算 {{((r.elapsed||0)/1000).toFixed(2)}} 秒</p>
          <div v-for="(m,i) in r.result.members" :key="i" class="member"><b>{{m.hero}}</b> · {{m.set==='空'?'无套装要求':m.set}} <span v-if="m.chosen"> · 选用</span>
            <span v-if="m.chosen && !m.ids.length"> · 模板挂件，无六件明细</span>
            <span v-if="m.values"> · 面板 {{m.values.数值?.toFixed(2)}}</span><span v-if="m.goal"> · 目标 {{m.goal.toFixed(2)}}</span>
            <span v-if="m.damage!=null"> · 伤害 {{m.damage.toFixed(2)}}</span><span v-if="m.remaining!=null"> · 剩余生命 {{m.remaining.toFixed(2)}}</span>
            <button v-if="m.ids.length" @click="showGear(m)">查看六件</button><p v-if="m.skill">{{m.skill}}</p>
            <p v-for="reason in m.reasons" :key="reason">{{reason}}</p><p v-for="note in m.notes" :key="note">{{note}}</p>
          </div>
        </template>
      </section>
    </article>
    <dialog ref="dialog" class="team-gear"><header><h3>{{member?.hero}} · {{member?.set}}</h3><button autofocus @click="dialog?.close()">关闭配装</button></header>
      <GearWheel v-if="gear.length===6 && member" :gear="gear" metric-key="team" :caption="member.hero" :value="member.values?.数值||0" @inspect="piece=$event"/>
      <p v-else>{{gearError||'正在读取御魂…'}}</p>
      <dl v-if="member?.panel"><div v-for="(v,k) in member.panel" :key="k"><dt>{{k}}</dt><dd>{{['暴击','暴击伤害','效果命中','效果抵抗'].includes(k)?(v*100).toFixed(2)+'%':v.toFixed(2)}}</dd></div></dl>
    </dialog>
    <SoulDetail v-if="piece" :soul="piece" :equipped-count="gear.filter(s=>s.suitId===piece?.suitId).length" @close="piece=null"/>
  </section>
</template>
<style scoped>
.row,header{display:flex;width:100%;justify-content:space-between;gap:10px;align-items:center}
.row{text-align:left;padding:12px}.row strong{white-space:nowrap;color:#246ca7}
.row strong{font-size:13px;border-radius:4px;padding:2px 9px;background:#edf3f8}.row .pass{background:#ecf6ee;color:#34754b}.row .miss{background:#fcf0eb;color:#9c523c}article{margin:7px 0}.content{padding:6px 14px;border:1px solid #dce2e9;border-top:0}.member{padding:8px 0;border-top:1px solid #e8ecf0}.member button{margin-left:8px}.member p{margin:3px 0;color:#65717c}
.team-gear{width:min(600px,94vw);max-height:92dvh}.team-gear dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 20px}.team-gear dl div{display:flex;justify-content:space-between}
</style>
