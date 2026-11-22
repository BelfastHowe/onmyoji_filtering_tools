<script setup lang="ts">
import {onMounted,onUnmounted,ref,watch} from 'vue';
const props=defineProps<{values:number[];scale:number;unit:string;name:string}>();
const el=ref<HTMLCanvasElement>();let observer:ResizeObserver;
function draw(){
  const canvas=el.value;if(!canvas)return;
  const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  const dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  ctx.scale(dpr,dpr);
  const r=Math.min(w*.29,h*.35),cx=w/2,cy=h/2;
  function point(i:number,f:number){const a=(-120-i*60)*Math.PI/180;return [cx+r*f*Math.cos(a),cy+r*f*Math.sin(a)] as const;}
  function polygon(f:number[]){ctx!.beginPath();f.forEach((v,i)=>{const [x,y]=point(i,v);if(i)ctx!.lineTo(x,y);else ctx!.moveTo(x,y);});ctx!.closePath();}
  ctx.strokeStyle='#d6e1e8';for(const f of [.25,.5,.75,1]){polygon(Array(6).fill(f));ctx.stroke();}
  for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(...point(i,1));ctx.stroke();}
  polygon(props.values.map(v=>v/props.scale));ctx.fillStyle='#fa927f55';ctx.fill();ctx.strokeStyle='#db7765';ctx.lineWidth=1.7;ctx.stroke();
  props.values.forEach((v,i)=>{ctx.beginPath();ctx.arc(...point(i,v/props.scale),2.6,0,Math.PI*2);ctx.fillStyle='#bc5a49';ctx.fill();
    const [x,y]=point(i,1.29);ctx.font='12px "Microsoft YaHei UI",sans-serif';ctx.fillStyle='#566578';ctx.textAlign='center';ctx.fillText((i+1)+'号',x,y-1);ctx.fillStyle='#293c50';ctx.fillText(v.toFixed(2)+props.unit,x,y+13);});
}
onMounted(()=>{observer=new ResizeObserver(draw);observer.observe(el.value!);draw();});onUnmounted(()=>observer?.disconnect());watch(()=>[props.values,props.scale,props.unit],draw,{flush:'post'});
</script>
<template><canvas ref="el" role="img" :aria-label="name+'，'+values.map((v,i)=>(i+1)+'号位 '+v.toFixed(2)+unit).join('，')"></canvas></template>
<style scoped>canvas{display:block;width:100%;height:var(--plot-height,195px)}</style>
