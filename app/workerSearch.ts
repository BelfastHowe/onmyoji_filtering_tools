// Keep the pinned worker's panel and damage formulas. Each partition fixes all
// six suit IDs. Bound every unfinished slot by its component-wise extrema.
export function optimizeWorker(source:string){
  const start=source.indexOf('for(let ze of f){const St=Xa(');
  const end=source.indexOf('let le=[];',start);
  const objective=source.slice(source.indexOf('let we=0;switch(C.value)',start),source.indexOf('if(C!=null&&C.min&&we<C.min)',start));
  if(start<0||end<0||!objective.startsWith('let we=0;switch('))throw Error('计算线程与规则版本不匹配');
  return source.slice(0,start)+`
    const asc=C.sort==='asc',capacity=C.x2nd?100:1;
    const has=(name)=>!!(R?.[name]?.min||R?.[name]?.max);
    const fields=[];
    if(Y.name!=='季'&&(['Damage','DefenseDamage','Healing','CritRate'].includes(C.value)||has('CritRate')))fields.push('CritRate');
    if(['Damage','Attack'].includes(C.value)||has('Attack'))fields.push('Attack','AttackRate');
    if(C.value==='Speed'||has('Speed'))fields.push('Speed');
    if(['Damage','DefenseDamage','Healing','CritPower'].includes(C.value)||has('CritPower'))fields.push('CritPower');
    if(Y.name==='云外镜'||['Defense','DefenseDamage'].includes(C.value)||has('Defense'))fields.push('Defense','DefenseRate');
    if(['Hp','Healing'].includes(C.value)||has('Hp'))fields.push('Hp','HpRate');
    if(Y.name==='孔雀明王')fields.push('EffectHitRate');
    const names=fields.map(k=>'preComputed'+k);
    const limits=Object.entries(R||{}).filter(([k,v])=>v.min||v.max);
    const nonnegative=[Ee,ye,Ue,z].every(v=>v==null||v>=0);
    // Compile fixed property accesses once per search. The fields below come
    // exclusively from the roster of known stat names above.
    const sums=fields.map((field,j)=>'F.'+field+'='+[0,1,2,3,4,5].map(i=>'y['+i+'].'+names[j]).join('+')+'+(se.'+field+'||0);').join('');
    const checks=[];
    for(const key of ['CritRate','Speed','CritPower','Attack','Defense','Hp']){
      if(!has(key))continue;
      const v=({Attack:'_o(F,Y)',Defense:'hf(F,Y)',Hp:'Ao(F,Y)'})[key]||('F.'+key);
      if(R[key].min)checks.push('if(direction>=0&&'+v+'<R.'+key+'.min)return false;');
      if(R[key].max)checks.push('if(direction<=0&&'+v+'>R.'+key+'.max)return false;');
    }
    const F={};
    const evaluate=eval('(y,se,direction)=>{'+sums+checks.join('')+
      'if(direction&&(!nonnegative||direction!==(asc?-1:1)))return true;'+
      ${JSON.stringify(objective)}+
      'if(direction>=0&&C.min&&we<C.min)return false;'+
      'if(ee.size===capacity&&(asc?we>=ee.max().value:we<=ee.min().value))return false;'+
      'if(direction)return true;ee.insert({suit:y.slice(),yuhunGain:{...F},target:C.value,value:we});'+
      'if(ee.size>capacity)ee.remove(asc?ee.max():ee.min());return true}');
    const extrema=new WeakMap();
    function range(slot){
      let cached=extrema.get(slot);if(cached)return cached;
      const lo={suit_id:slot[0].suit_id},hi={suit_id:slot[0].suit_id};
      for(const key of names){
        lo[key]=hi[key]=slot[0][key];
        for(const v of slot){if(v[key]<lo[key])lo[key]=v[key];if(v[key]>hi[key])hi[key]=v[key];}
      }
      cached=[lo,hi];extrema.set(slot,cached);return cached;
    }
    for(const slots of f){
      const se=x?uo(slots.map(s=>s[0])):A,low=[],high=[],gear=[],sizes=[];let size=1;
      for(const slot of slots){const bounds=range(slot);low.push(bounds[0]);high.push(bounds[1]);size*=slot.length;sizes.push(size);}
      function visit(i){
        if(i<0){evaluate(gear,se,0);return;}
        if(sizes[i]>12&&(!evaluate(high,se,1)||!evaluate(low,se,-1)))return;
        const oldLow=low[i],oldHigh=high[i];
        for(const s of slots[i]){gear[i]=low[i]=high[i]=s;visit(i-1);}
        low[i]=oldLow;high[i]=oldHigh;
      }
      visit(5);
    }`+source.slice(end);
}
