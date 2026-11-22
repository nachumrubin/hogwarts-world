import {equineBody} from './equine-body.js';
import {joint} from './form.js';

// Barrel, croup and withers share a continuous surface. Limbs are parented
// at the scapula or hip, with distinct carpus/hock and fetlock pivots.
export function equine(a,{coat,hair,hoof,kind,foreColor=coat,pivot,front=true,slender=1,length=1}){
  const b=joint(a.body);b.scale.set(slender,1,length);
  const neck=equineBody(a,b,kind,coat,foreColor,pivot);
  const legs=[];
  for(const s of [-1,1])for(const fore of [false,true]){
    if(fore&&!front)continue;
    const upper=joint(b,s*(fore?.285:.27),1.52,fore?.62:-.72);
    const bend=fore?-.035:.18, hock=fore?.018:-.26;
    a.loft(upper,coat,[[-s*.07,.21,0,.055,.09],[-s*.035,.11,0,.145,.20],[-s*.026,-.08,0,.146,fore?.204:.238],[-s*.009,-.28,bend*.72,.128,fore?.16:.194],[0,-.39,bend,.101,.133],[0,-.50,bend,.086,.103],[0,-.56,bend,.032,.047]]);
    const lower=joint(upper,0,-.49,bend);
    a.loft(lower,coat,[[0,.08,0,.037,.046],[0,.004,0,.087,.099],[0,-.08,hock*.32,.092,.112],[0,-.23,hock*.69,.065,.091],[0,-.33,hock,.073,fore?.077:.106],[0,-.40,hock,.060,.072],[0,-.438,hock,.025,.032]]);
    const cannon=joint(lower,0,-.36,hock);
    a.loft(cannon,coat,[[0,.060,0,.032,.042],[0,-.006,0,.07,.08],[0,-.09,.015,.056,.063],[0,-.31,.030,.044,.055],[0,-.44,.043,.066,.073],[0,-.53,.09,.053,.06]]);
    a.loft(cannon,hoof,[[0,-.49,.08,.058,.067],[0,-.55,.105,.081,.10],[0,-.642,.138,.089,.121],[0,-.665,.14,.086,.12]]);
    legs.push({upper,lower,cannon,bend,hock,phase:(fore?.24:0)+(s>0?.5:0),fore});
  }
  const tail=joint(b,0,1.65,-.98);
  a.loft(tail,hair,[[0,0,.06,.10,.11],[0,-.10,-.12,.13,.14],[.02,-.34,-.24,.15,.15],[.04,-.63,-.30,.13,.12],[.04,-.95,-.35,.09,.08],[.02,-1.16,-.42,.008,.01]]);
  return {base:b,neck,advance(dt,action,context){
    if(action!=='Walk')return;
    const yaw=a.body.rotation.y+=.19*dt;
    a.root.position.x+=.54*dt*Math.sin(yaw);a.root.position.z+=.54*dt*Math.cos(yaw);
    a.root.position.y=a.origin.y+(context?.terrainHeight?.(a.root.position.x,a.root.position.z)||0);
  },animate(t,walk,tuck=0){
    tail.rotation.z=.12*Math.sin(1.8*t);
    const bob=walk*(-.047+.012*Math.cos(t*.8*4*Math.PI));
    b.position.y=bob;
    for(const {upper,lower,cannon,phase,fore,bend,hock} of legs){
      if(!walk){upper.rotation.x=.38*tuck;lower.rotation.x=-.54*tuck;cannon.rotation.x=.77*tuck;continue}
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
