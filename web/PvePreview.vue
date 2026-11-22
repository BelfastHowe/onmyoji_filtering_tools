<script lang="ts">
export interface PreviewMetric {
  key: string;
  label: string;
  value: number | null;
  ids: string[];
}
</script>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { bossSets, fourSets } from '../app/pve';
const props=defineProps<{metrics:PreviewMetric[]; selected:PreviewMetric|null}>();
const emit=defineEmits<{choose:[metric:PreviewMetric]}>();
const dialog=ref<HTMLDialogElement>();
const metricsByKey=computed(()=>new Map(props.metrics.map(m=>[m.key,m])));
const overall=computed(()=>metricsByKey.value.get('pve/mean/须佐之男')?.value);
const otherPresets=[
  {key:'pve/天照/狂骨/鬼灵歌伎',set:'狂骨 + 鬼灵歌伎',hero:'魂土天照',unit:'damage'},
  {key:'pve/玉藻前/破势/荒骷髅',set:'破势 + 荒骷髅',hero:'超星玉藻前',unit:'damage'},
  {key:'pve/inaba/loose',set:'散件',hero:'因幡辉夜姬',unit:'percent'},
  {key:'pve/inaba/fire',set:'火灵',hero:'因幡辉夜姬',unit:'percent'},
  {key:'pve/yue/defense',set:'散件',hero:'不见岳',unit:'defense'}
];
const rows=computed(()=>fourSets.map(set=>{
  const metrics=bossSets.map(boss=>metricsByKey.value.get(['pve','须佐之男',set,boss].join('/')));
  // A computed but infeasible preset contributes zero. An uncomputed snapshot has no mean.
  const mean=metrics.every(m=>m!==undefined)
    ? metrics.reduce((sum,m)=>sum+(m?.value??0),0)/metrics.length : null;
  return {set,metrics,mean};
}));
const others=computed(()=>otherPresets.map(p=>({...p,metric:metricsByKey.value.get(p.key)})));
function score(value:number|null|undefined,unit='damage') {
  if(value==null)return '暂无';
  if(unit==='percent')return value.toFixed(2)+'%';
  if(unit==='defense')return value.toFixed(2);
  return (Math.round(value*10000)/10000).toFixed(0);
}
function open(metric?:PreviewMetric){
  if(metric?.value==null)return;
  emit('choose',metric);
  dialog.value?.showModal();
}
</script>
<template>
  <section class="preview" aria-labelledby="preview-title">
    <h2 id="preview-title">PVE 预览
      <button class="help" popovertarget="preview-help" aria-label="指标说明">?</button>
    </h2>
    <div class="controls"><slot name="controls"/></div>
    <p id="preview-help" popover>每行比较同一四件套的三种首领搭配。行平均取这三项的均值，总体平均取当前模式全部 21 项的均值。无法配齐的组合计 0，缺少计算结果时暂不显示均分。点击有分数的搭配可查看六件御魂。</p>
    <p v-if="!metrics.length" class="empty">此快照暂无 PVE 预设结果。</p>
    <div v-else class="sheet">
      <div class="overall"><h3>须佐之男 · 21项平均分</h3><strong>{{overall==null?'待计算':overall.toFixed(2)}}</strong></div>
      <div class="matrix" aria-label="须佐之男首领御魂对比">
        <section v-for="(boss,col) in [...bossSets,'平均值']" :key="boss" class="column" :class="'col-'+col" :aria-label="boss">
          <h3>{{boss}}</h3>
          <div v-for="row in rows" :key="row.set" class="cell">
            <button v-if="col<3" class="card damage" :disabled="row.metrics[col]?.value==null"
              :aria-label="'须佐之男，'+row.set+'，'+boss+'，'+score(row.metrics[col]?.value)"
              :class="{chosen:selected?.key && selected.key===row.metrics[col]?.key}" @click="open(row.metrics[col])">
              <span><small>御魂</small>{{row.set}}</span>
              <span><small>指标</small><em>{{score(row.metrics[col]?.value)}}</em></span>
            </button>
            <div v-else class="card average" :class="{chosen:selected?.key==='pve/mean/'+row.set}">
              <span><small>御魂</small>{{row.set}}</span>
              <span><small>指标</small><em>{{score(row.mean)}}</em></span>
            </div>
          </div>
        </section>
      </div>
      <section class="others" aria-labelledby="others-title">
        <h3 id="others-title">其他</h3>
        <div class="other-grid">
          <button v-for="p in others" :key="p.key" class="card other" :disabled="p.metric?.value==null"
            :class="{chosen:selected?.key===p.key}" @click="open(p.metric)">
            <b>{{p.set}}</b>
            <span><small>式神</small>{{p.hero}}</span>
            <span><small>指标</small><em>{{score(p.metric?.value,p.unit)}}</em></span>
          </button>
        </div>
      </section>
    </div>
    <dialog ref="dialog" class="pve-loadout" aria-labelledby="loadout-title" @click.self="dialog?.close()">
      <div><header><h3 id="loadout-title">{{selected?.label}}</h3><button autofocus @click="dialog?.close()">关闭配装</button></header>
        <slot/>
      </div>
    </dialog>
  </section>
</template>
<style scoped>
.preview{padding-bottom:12px}
.preview>h2{text-align:center;font-size:23px;padding:14px 0 24px;border-bottom:1px solid #dcdfe6;margin-bottom:22px;color:#303133}
.help{display:inline-grid;place-items:center;vertical-align:middle;margin-left:3px;border:0;border-radius:50%;width:16px;height:16px;padding:0;font:bold 12px/1 system-ui;background:#606266;color:white}
#preview-help{max-width:min(360px,88vw);padding:16px;border:1px solid #dcdfe6;border-radius:7px;box-shadow:0 4px 20px #24334a20;color:#37465b}
.sheet{background:#fff;border:1px solid #f1f2f4;border-radius:9px;box-shadow:0 2px 12px #00000012;padding:clamp(12px,1.5vw,20px)}
.overall{display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:18px;padding:12px 16px;background:#fef5f4;border-radius:7px;color:#9b4148}.overall h3{font-size:16px;margin:0}.overall strong{font-size:24px;font-variant-numeric:tabular-nums}
.matrix,.other-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(10px,1.5vw,20px)}
.column{display:grid;gap:clamp(10px,1.5vw,20px);min-width:0}
.column h3{padding:16px 4px;text-align:center;font-size:16px;border:1px solid var(--edge);border-radius:7px 7px 0 0;background:var(--tint);color:var(--ink);box-shadow:0 2px 4px #0000000c}
.col-0{--tint:#ecf5ff;--edge:#cde5ff;--ink:#247fcf}.col-1{--tint:#f0f9eb;--edge:#d9efcd;--ink:#49872c}.col-2{--tint:#fdf6ec;--edge:#fae8ca;--ink:#ac6a18}.col-3{--tint:#fef0f0;--edge:#fbc4c4;--ink:#cc4a50}
.card{display:flex;flex-direction:column;align-items:stretch;justify-content:center;width:100%;height:100%;min-height:90px;gap:2px;padding:16px clamp(10px,2vw,27px);text-align:left;color:#434a54;background:#fff;border:1px solid #e4eaf3;border-radius:8px;box-shadow:0 2px 5px #0000000d}
.card>span{display:flex;align-items:baseline;gap:10px;line-height:1.4}
.card small{color:#717b89;font-size:13px}.card em{font-size:17px;font-weight:650;color:#2783dc}
.card.average{border-color:#fbc4c4}.average em{color:#d9545c}
button.card:hover:enabled,button.card.chosen{border-color:#86bdf1;background:#f7fbff}
.average.chosen{outline:2px solid #e4a3a5}button.card:disabled{opacity:1;color:#737d87}.card:disabled em{font-style:normal;font-size:14px;color:#808892}
.others{border-top:2px solid #ebeef5;margin-top:36px;padding-top:18px}
.others h3{border-bottom:2px solid #79bbff;padding:0 0 12px;margin-bottom:18px}
.others h3::before{content:'';display:inline-block;background:#409eff;border-radius:4px;width:6px;height:18px;vertical-align:-3px;margin-right:8px}
.other{padding:16px 16px 20px;min-height:150px}.other>b{text-align:center;font-weight:550;background:#f8f9fa;border-bottom:1px solid #e5e9f0;padding:12px 3px;margin-bottom:14px}
.empty{text-align:center;color:#677382}
.pve-loadout{width:min(590px,94vw);max-height:92dvh;padding:0;overscroll-behavior:contain}
.pve-loadout>div{padding:16px}.pve-loadout header{display:flex;align-items:center;justify-content:space-between;gap:10px}.pve-loadout header button{flex-shrink:0}
@media(max-width:680px){
  .matrix{display:flex;flex-direction:column;gap:20px}
  .column,.other-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .column h3{grid-column:1/-1;padding:9px 4px}
  .card{min-height:72px;padding:10px}.other{min-height:128px}.other>b{margin-bottom:7px}
  .preview>h2{font-size:20px;padding:8px 0 16px;margin-bottom:12px}
}
</style>
