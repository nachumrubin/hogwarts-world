import {joint} from './form.js';

// Barrel, croup and withers share a continuous surface. Limbs are parented
// at the scapula or hip, with distinct carpus/hock and fetlock pivots.
export function equine(a,{coat,hair,hoof,front=true,slender=1,length=1}){
  const b=joint(a.body);b.scale.set(slender,1,length);
  a.loft(b,coat,[[0,1.35,-1.1,.1,.22],[0,1.36,-.98,.33,.41],[0,1.4,-.74,.43,.49],[0,1.39,-.37,.41,.46],[0,1.34,.03,.43,.47],[0,1.39,.39,.45,.52],[0,1.44,.65,.40,.54],[0,1.44,.87,.29,.42],[0,1.5,.94,.16,.22]]);
  const legs=[];
  for(const s of [-1,1])for(const fore of [false,true]){
    if(fore&&!front)continue;
    const upper=joint(b,s*(fore?.285:.27),1.52,fore?.62:-.72);
    const bend=fore?-.035:.18, hock=fore?.018:-.26;
    a.loft(upper,coat,[[0,.14,0,.115,.18],[0,-.08,0,.16,.24],[0,-.36,bend,.12,.16],[0,-.52,bend,.085,.11]]);
    const lower=joint(upper,0,-.49,bend);
    a.loft(lower,coat,[[0,.09,0,.10,.12],[0,-.08,hock*.32,.10,.12],[0,-.33,hock,.071,.084],[0,-.40,hock,.064,.078]]);
    const cannon=joint(lower,0,-.36,hock);
    a.loft(cannon,coat,[[0,.075,0,.073,.08],[0,-.09,.015,.056,.063],[0,-.34,.04,.049,.052],[0,-.44,.043,.066,.073],[0,-.53,.09,.053,.06]]);
    a.loft(cannon,hoof,[[0,-.49,.08,.058,.067],[0,-.55,.105,.081,.10],[0,-.65,.13,.094,.124],[0,-.665,.134,.093,.12]]);
    legs.push({upper,lower,cannon,phase:(fore?.24:0)+(s>0?.5:0),fore});
  }
  const tail=joint(b,0,1.65,-.98);
  a.loft(tail,hair,[[0,0,.06,.10,.11],[0,-.10,-.12,.13,.14],[.02,-.34,-.24,.15,.15],[.04,-.63,-.30,.13,.12],[.04,-.95,-.35,.09,.08],[.02,-1.16,-.42,.008,.01]]);
  return {base:b,animate(t,walk){
    tail.rotation.z=.12*Math.sin(1.8*t);
    for(const {upper,lower,cannon,phase,fore} of legs){
      const p=2*Math.PI*(t*.8+phase),lift=Math.max(0,Math.sin(p));
      upper.rotation.x=walk*.27*Math.cos(p);
      lower.rotation.x=walk*(fore?-.48:.48)*lift;
      cannon.rotation.x=walk*(fore?.77:-.83)*lift;
    }
    b.position.y=walk*.023*Math.cos(t*.8*4*Math.PI);
  }};
}
