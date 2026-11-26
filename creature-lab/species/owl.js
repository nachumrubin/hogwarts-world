import * as T from '../vendor/three.module.js';
import {Specimen,joint,sweep} from './form.js';
import {feather,plumage} from './avian.js';
import {owlWing} from './owl-wing.js';
import {guideMap,releaseGuideMap,owlFace} from './owl-head.js';
import {batchArticulatedParts} from './owl-batch.js';
import {breastPlumage} from './owl-plumage.js';

const clamp=T.MathUtils.clamp;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const cream=0xf1e5d1;
export const actions={Perch:'Perched idle',Look:'Track target',Unfold:'Unfold wings',Fold:'Fold wings',Takeoff:'Leave perch',Fly:'Powered flight',Glide:'Glide',Bank:'Bank and turn',Land:'Land and grip'};

function foot(owl,s){
  const carrier=joint(owl.root),ankle=joint(carrier,s*.021,.0795,-.001);
  owl.loft(ankle,cream,[[0,.049,-.024,.012,.015],[0,.013,-.012,.016,.021],[0,-.018,-.006,.012,.014],[0,-.042,.004,.008,.010],[0,-.064,.012,.0045,.005]]);
  const legPlumes=[];
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8,x=Math.cos(a),z=Math.sin(a);
    legPlumes.push([[x*.014,-.008,-.005+z*.015],[x*.006,-.053+.004*Math.cos(a*3),.006+z*.007],.004,[x,0,z]]);
  }
  for(let i=0;i<31;i++){
    const a=i*2.40,x=Math.cos(a),z=Math.sin(a),r=.009+.0014*Math.sin(i*3);
    const upper=i%3===0;
    const start=upper?[x*.015,.010,-.010+z*.017]:[x*.012,-.026,-.002+z*.014];
    const end=upper?[x*.012,-.027+.004*Math.cos(i),-.001+z*.013]:[x*r,-.052-.012*(.5+.5*Math.sin(i*9)),.007+z*r];
    legPlumes.push([start,end,upper?.0044:.0032,[x,0,z]]);
  }
  plumage(owl,ankle,0xe7dbca,legPlumes);
  const digit=(parent,color,rows)=>owl.mesh(parent,color,l=>sweep(rows,[14,10,7][l]));
  const pad=joint(ankle,0,-.064,.012),toes=[];
  owl.oval(pad,0xbba89c,0,0,0,.007,.004,.009);
  for(const [yaw,length] of [[-.38,.033],[.31,.038],[2.58,.032],[-2.87,.028]]){
    const toe=joint(pad);toe.rotation.y=yaw*s;toe.position.x=.0028*Math.sin(yaw)*s;
    const knuckle=joint(toe);
    // Transverse scutes rise along the phalanx and flatten into the pad.
    const scutes=[[0,0,-.002,.0034,.0026]];
    for(let n=0;n<4;n++){
      const u=.04+.10*n,r=.0030-.0008*u;
      scutes.push([0,-u*.002,length*u,r,.0022],
        [0,.00016-u*.002,length*(u+.035),r+.00022,.00265]);
    }
    scutes.push([0,-.001,length*.43,.0031,.0026],[0,-.001,length*.50,.0021,.0019]);
    owl.mesh(knuckle,0xb8a496,lod=>{
      const rings=lod===0?scutes:lod===1?[scutes[0],...scutes.slice(3,5),...scutes.slice(7)]:[scutes[0],scutes[3],...scutes.slice(-2)];
      return sweep(rings,[14,10,7][lod]);
    });
    const tip=joint(knuckle,0,-.001,length*.43);
    digit(tip,0xa58f80,[[0,0,-.001,.0025,.0022],[0,-.0003,length*.13,.0022,.0018],[0,-.001,length*.24,.0025,.0022],[0,-.002,length*.38,.0019,.0016]]);
    digit(tip,0x4b4038,[[0,-.001,length*.32,.0023,.0019],[0,-.002,length*.46,.0022,.0020],[0,-.004,length*.56,.0017,.0018],[0,-.008,length*.60,.0011,.0013],[0,-.012,length*.52,.00071,.00061],[0,-.014,length*.40,.00010,.00014]]);
    toes.push([knuckle,tip,length]);
  }
  return (air,grip,reach)=>{
    carrier.position.copy(owl.body.position).multiplyScalar(air);
    carrier.quaternion.identity().slerp(owl.body.quaternion,air);
    ankle.rotation.x=air*(.91-1.28*reach);
    for(const [a,b,length] of toes){
      const curl=clamp(grip+(length-.033)*16*grip*(1-grip),0,1);
      a.rotation.x=.04+.18*curl+.12*air*(1-reach);
      b.rotation.x=.05+.51*curl+.28*air*(1-reach);
    }
  };
}

export class Owl extends Specimen{
  constructor(){
    super();this.maps=[guideMap('body'),guideMap('head'),guideMap('wing')];
    // The rump lies aft of the hock and the breast projects ahead of it.
    // The narrowed upper pole continues inside the cervical plumage.
    // Pitch the pectoral girdle about the hip; feet keep their perch frame.
    this.trunk=joint(this.body,0,.011,-.021);
    this.trunk.rotation.x=.16;
    this.breast=this.mesh(this.trunk,0xfffffe,breastPlumage);
    this.breast.material.map=this.maps[0];this.breast.material.roughness=.96;
    const articulated=[];
    let start=this.parts.length;
    this.tail=joint(this.trunk,0,.103,-.081);this.rectrices=[];
    for(let i=0;i<12;i++){
      const t=(i-5.5)/5.5,shaft=joint(this.tail,t*.012,-.002*Math.abs(t),0);
      const blade=feather(this,shaft,0xd4b48b,[0,0,0],[0,-.046,-.108+.009*t*t],.011,[0,1,-.6]);
      blade.userData.rectrix=i;this.rectrices.push({shaft,t});blade.rotation.z=.03*t;
    }
    articulated.push(...this.parts.slice(start));
    this.neck=joint(this.trunk,0,.202,.028);this.atlas=joint(this.neck,0,.022,.006);
    this.head=joint(this.atlas,0,.009,.017);this.head.scale.set(.96,.96,.94);this.blink=owlFace(this);
    this.wings=[-1,1].map(s=>owlWing(this,s,this.maps[2]));
    start=this.parts.length;this.feet=[-1,1].map(s=>foot(this,s));
    articulated.push(...this.parts.slice(start));batchArticulatedParts(this,articulated);
    this.open=0;this.air=0;this.bank=0;this.yaw=0;this.pitch=0;this.phase=0;this.route=0;
    this.update(0,0,'Perch');
  }
  update(dt,t,action,context={}){
    if(action!==this.action){this.action=action;this.elapsed=0;this.startAir=this.air;this.startOpen=this.open;
      this.approachStart=this.route;this.approachDuration=clamp((2*Math.PI-this.route)/1.18,1.30,2.12);
    }
    this.elapsed+=dt;
    const e=this.elapsed,launch=action==='Takeoff';
    const land=action==='Land'||(['Perch','Fold','Look','Unfold'].includes(action)&&this.startAir>.03);
    const progress=clamp(e/this.approachDuration,0,1);
    const flying=['Fly','Glide','Bank'].includes(action),tracking=action==='Look';
    const targetAir=land?this.startAir*(1-smooth((progress-.34)/.66)):launch?this.startAir+(1-this.startAir)*smooth((e-.25)/.98):Number(flying);
    const targetOpen=launch?this.startOpen+(1-this.startOpen)*smooth(e/.56):land?this.startOpen+(Number(action==='Unfold')-this.startOpen)*smooth((e-this.approachDuration+.06)/.79):Number(flying||action==='Unfold');
    const blend=1-Math.exp(-dt*5);
    this.air+=(targetAir-this.air)*(launch||land?1:blend);
    this.open+=(targetOpen-this.open)*(launch||land?1:blend);
    this.bank+=((action==='Bank'?.48*Math.sin(.86*e):0)-this.bank)*blend;
    // A level circuit carries the specimen through the roost. Landing
    // completes the current arc and decelerates into the original perch.
    if(land&&this.approachStart>0){
      const u=progress*(2-progress);
      this.route=progress===1?0:this.approachStart+(2*Math.PI-this.approachStart)*u;
    }else if(launch||flying)this.route=(this.route+dt*this.air*(action==='Bank'?1.18:.94))%(2*Math.PI);
    else this.route=0;
    this.root.rotation.y=this.route;
    this.root.position.copy(this.origin);
    this.root.position.x+=2.4*(1-Math.cos(this.route));
    this.root.position.z+=2.4*Math.sin(this.route);
    this.root.position.y+=this.air*.42*Math.sin(this.route*.5);
    this.phase+=dt*Math.PI*2*(2.55+.09*Math.sin(t*.9));
    const powered=action==='Fly'||launch||land;
    const trim=.028*Math.sin(1.17*t)+.013*Math.sin(2.09*t+.7);
    const stroke=powered?.48*Math.sin(this.phase)+.042*Math.sin(2*this.phase-.35):this.bank*.055+this.air*trim;
    const recovery=powered?(1+Math.cos(this.phase))/2:0;
    const compression=land?.010*Math.sin(Math.PI*clamp((e-this.approachDuration)/.27,0,1)):0;
    const drive=launch?.021*Math.sin(Math.PI*clamp((e-.19)/.29,0,1)):0;
    const squat=launch?.014*Math.sin(Math.PI*clamp(e/.28,0,1))-drive:compression;
    const flare=land?Math.sin(Math.PI*smooth((progress-.38)/.62)):0;
    const breath=(1-this.air)*Math.sin(t*2.06+.14*Math.sin(t*.61));
    this.breast.scale.set(1+.007*breath,1+.006*breath,1+.005*breath);
    this.neck.position.y=.202+.0016*breath;
    this.neck.position.z=.028+.002*Math.sin(t*.84)*(1-this.air);

    const heave=this.air*(powered?.033*Math.sin(this.phase-.70):.009*Math.sin(1.17*t));
    this.body.rotation.set(this.air*.96-.32*flare+heave,this.bank*.66,this.bank,'YXZ');
    this.body.position.set(this.bank*.08,this.air*.31-squat+this.air*(powered?.008*Math.cos(this.phase-.43):trim*.035),this.air*.12);

    let yaw=.075*Math.sin(t*.75),pitch=.025*Math.sin(t*.93);
    if(tracking){
      const target=context.stimulus||context.playerPosition;
      if(target){const dx=target.x-this.root.position.x,dz=target.z-this.root.position.z;
        const bearing=Math.atan2(dx,dz)-this.route;
        yaw=clamp(Math.atan2(Math.sin(bearing),Math.cos(bearing)),-2.05,2.05);pitch=-clamp(Math.atan2(target.y-this.root.position.y-.25,Math.hypot(dx,dz)),-.45,.45);
      }else yaw=1.05*Math.tanh(2*Math.sin(t*1.12));
    }
    this.yaw+=(yaw-this.yaw)*blend;this.pitch+=(pitch-this.pitch)*blend;
    const tilt=(tracking?.14:.028)*Math.sin(1.27*t)-.055*this.yaw;
    for(const [node,share] of [[this.neck,.35],[this.atlas,.38],[this.head,.27]])
      node.rotation.set((this.pitch-this.air*.88-heave*.84+.19*flare)*share,this.yaw*share,tilt*share-this.bank*.69*share,'YXZ');
    const blink=Math.min(1,Math.abs((t+1.37)%3.89-.15)/.085);
    this.blink(1-smooth(blink));
    this.wings.forEach((pose,i)=>pose(this.open,this.open*(stroke+(i?1:-1)*this.bank*.24),recovery,this.body.rotation.x,powered?Math.cos(this.phase)*this.open:0));
    this.tail.rotation.set(-.18*this.air-.28*flare+.034*this.air*Math.sin(this.phase-.64),this.bank*.42+.038*this.air*Math.sin(t*2.2),-.15*this.bank);
    for(const {shaft,t:spread} of this.rectrices)shaft.rotation.y=-spread*(.16+this.air*(.22+.31*flare)+Math.abs(this.bank)*.3);
    const grip=land?smooth((progress-.93)/.07):launch?1-smooth((e-.16)/.16):1-this.air;
    this.feet.forEach(pose=>pose(this.air,grip,land?smooth((progress-.30)/.44):launch?1-smooth((e-.24)/.40):0));
  }
  dispose(){this.maps.splice(0).forEach(releaseGuideMap);super.dispose()}
}
