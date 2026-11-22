import {joint} from './form.js';

// Barrel, croup and withers share a continuous surface. Limbs are parented
// at the scapula or hip, with distinct carpus/hock and fetlock pivots.
export function equine(a,{coat,hair,hoof,front=true,slender=1,length=1}){
  const b=joint(a.body);b.scale.set(slender,1,length);
  a.loft(b,coat,[[0,1.35,-1.1,.1,.22],[0,1.36,-.98,.33,.41],[0,1.4,-.74,.43,.49],[0,1.39,-.37,.41,.46],[0,1.34,.03,.43,.47],[0,1.39,.39,.45,.52],[0,1.44,.65,.40,.54],[0,1.44,.87,.29,.42],[0,1.5,.94,.16,.22],[0,1.5,.98,.035,.08]]);
  const legs=[];
  for(const s of [-1,1])for(const fore of [false,true]){
    if(fore&&!front)continue;
    const upper=joint(b,s*(fore?.285:.27),1.52,fore?.62:-.72);
    const bend=fore?-.035:.18, hock=fore?.018:-.26;
    a.loft(upper,coat,[[-s*.07,.21,0,.055,.09],[-s*.035,.11,0,.132,.194],[0,-.08,0,.16,.24],[0,-.36,bend,.12,.16],[0,-.50,bend,.086,.103],[0,-.56,bend,.032,.047]]);
    const lower=joint(upper,0,-.49,bend);
    a.loft(lower,coat,[[0,.08,0,.037,.046],[0,.004,0,.087,.099],[0,-.08,hock*.32,.092,.112],[0,-.33,hock,.071,.084],[0,-.40,hock,.060,.072],[0,-.438,hock,.025,.032]]);
    const cannon=joint(lower,0,-.36,hock);
    a.loft(cannon,coat,[[0,.060,0,.032,.042],[0,-.006,0,.07,.08],[0,-.09,.015,.056,.063],[0,-.34,.04,.049,.052],[0,-.44,.043,.066,.073],[0,-.53,.09,.053,.06]]);
    a.loft(cannon,hoof,[[0,-.49,.08,.058,.067],[0,-.55,.105,.081,.10],[0,-.65,.13,.094,.124],[0,-.665,.13,.093,.12]]);
    legs.push({upper,lower,cannon,bend,hock,phase:(fore?.24:0)+(s>0?.5:0),fore});
  }
  const tail=joint(b,0,1.65,-.98);
  a.loft(tail,hair,[[0,0,.06,.10,.11],[0,-.10,-.12,.13,.14],[.02,-.34,-.24,.15,.15],[.04,-.63,-.30,.13,.12],[.04,-.95,-.35,.09,.08],[.02,-1.16,-.42,.008,.01]]);
  return {base:b,animate(t,walk){
    tail.rotation.z=.12*Math.sin(1.8*t);
    const bob=walk*(-.047+.012*Math.cos(t*.8*4*Math.PI));
    b.position.y=bob;
    for(const {upper,lower,cannon,phase,fore,bend,hock} of legs){
      if(!walk){upper.rotation.x=lower.rotation.x=cannon.rotation.x=0;continue}
      const cycle=(t*.8+phase)%1;
      const swing=Math.max(0,(cycle-.62)/.38);
      const stride=cycle<.62?.21-.42*cycle/.62:-.21+.42*swing*swing*(3-2*swing);
      const lift=.15*Math.sin(Math.PI*swing)**2;
      const roll=.27*Math.sin(2*Math.PI*swing);
      // Solve shoulder/elbow or hip/stifle against the moving fetlock.
      const y=1.515+bob-lift-(.665*Math.cos(roll)-.13*Math.sin(roll));
      const z=bend+hock+.13+stride-(.665*Math.sin(roll)+.13*Math.cos(roll));
      const a=Math.hypot(.49,bend),d=Math.hypot(.36,hock);
      const cosKnee=Math.max(-1,Math.min(1,(y*y+z*z-a*a-d*d)/(2*a*d)));
      const knee=(fore?1:-1)*Math.acos(cosKnee);
      const hip=Math.atan2(z,y)-Math.atan2(d*Math.sin(knee),a+d*Math.cos(knee));
      upper.rotation.x=Math.atan2(bend,.49)-hip;
      lower.rotation.x=Math.atan2(hock,.36)-hip-knee-upper.rotation.x;
      cannon.rotation.x=-roll-upper.rotation.x-lower.rotation.x;
    }
  }};
}
