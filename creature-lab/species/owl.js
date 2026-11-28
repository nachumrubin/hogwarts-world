import * as T from '../vendor/three.module.js';
import {Specimen,joint,sweep} from './form.js';
import {feather,plumage} from './avian.js';
import {owlWing} from './owl-wing.js';
import {owlFace} from './owl-head.js';
import {guideMap,releaseGuideMap,owlFinish} from './owl-finish.js';
import {batchArticulatedParts} from './owl-batch.js';
import {breastPlumage} from './owl-plumage.js';

import {OwlMotion, owlBlink, owlStroke, clamp, ease, mix} from './owl-motion.js';

const yawAxis=new T.Vector3(0,1,0);
const cream=0xf1e5d1;
export const actions={Perch:'Perched idle',Look:'Track target',Unfold:'Unfold wings',Fold:'Fold wings',Takeoff:'Leave perch',Fly:'Powered flight',Glide:'Glide',Bank:'Bank and turn',Land:'Land and grip'};

function foot(owl,s){
  const carrier=joint(owl.root),ankle=joint(carrier,s*.021,.0795,-.001);
  const mark=(region,index)=>{owl.parts[index].mesh.userData.owlContact={region,side:s<0?0:1}};
  const hock=owl.loft(ankle,cream,[[0,.049,-.017,.015,.019],[0,.010,-.022,.020,.024],[0,-.015,-.021,.016,.019],[0,-.033,-.007,.012,.014],[0,-.049,.004,.007,.009],[0,-.064,.012,.0045,.005]]);
  hock.userData.owlFinish='hock';
  const legPlumes=[];
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8,x=Math.cos(a),z=Math.sin(a);
    legPlumes.push([[x*.017,.006,-.022+z*.022],[x*.009,-.047+.006*Math.cos(a*3),.001+z*.011],.005,[x,0,z]]);
  }
  for(let i=0;i<31;i++){
    const a=i*2.40,x=Math.cos(a),z=Math.sin(a),r=.009+.0014*Math.sin(i*3);
    const upper=i%3===0;
    const start=upper?[x*.020,.012,-.022+z*.023]:[x*.016,-.015,-.018+z*.019];
    const end=upper?[x*.015,-.039+.005*Math.cos(i),-.007+z*.017]:[x*r,-.052-.012*(.5+.5*Math.sin(i*9)),.007+z*r];
    legPlumes.push([start,end,upper?.0056:.0037,[x,0,z]]);
  }
  plumage(owl,ankle,0xe7dbca,legPlumes).userData.owlFinish='leg';
  const digit=(parent,color,rows)=>owl.mesh(parent,color,l=>sweep(rows,[14,10,7][l]));
  const pad=joint(ankle,0,-.064,.012),toes=[];
  owl.oval(pad,0xbba89c,0,0,0,.007,.004,.009);mark('pad',owl.parts.length-1);
  for(const [yaw,length] of [[-.38,.033],[.31,.038],[2.58,.032],[-2.87,.028]]){
    const first=owl.parts.length;
    const toe=joint(pad);toe.rotation.y=yaw*s;toe.position.x=.0028*Math.sin(yaw)*s;
    const knuckle=joint(toe);
    // Transverse scutes rise along the phalanx and flatten into the pad.
    const scutes=[[0,0,-.002,.0034,.0026]];
    for(let n=0;n<4;n++){
      const u=.04+.10*n,r=.0032-.0016*u;
      scutes.push([0,-u*.002,length*u,r,.0022],
        [0,.00016-u*.002,length*(u+.035),r+.00016,.00245]);
    }
    scutes.push([0,-.001,length*.43,.0031,.0026],[0,-.001,length*.50,.0021,.0019]);
    owl.mesh(knuckle,0xb8a496,lod=>{
      const rings=lod===0?scutes:lod===1?[scutes[0],...scutes.slice(3,5),...scutes.slice(7)]:[scutes[0],scutes[3],...scutes.slice(-2)];
      return sweep(rings,[14,10,7][lod]);
    });
    const tip=joint(knuckle,0,-.001,length*.43);
    digit(tip,0xa58f80,[[0,0,-.001,.0025,.0022],[0,-.0003,length*.13,.0022,.0018],[0,-.001,length*.24,.0025,.0022],[0,-.002,length*.38,.0019,.0016]]);
    // Fit the horn centreline around the lab's 36 mm perch in the planted
    // pose. Bake that curve into digit space so release still uses the rig.
    const horn=[[0,-.001,length*.32,.0023,.0019],[0,-.002,length*.46,.0022,.0020],[0,-.004,length*.56,.0017,.0018],[0,-.008,length*.60,.0011,.0013],[0,-.0116,length*.53,.00071,.00061],[0,-.0142,length*.39,.00010,.00014]];
    knuckle.rotation.x=.22;tip.rotation.x=.56;tip.updateWorldMatrix(true,false);
    const point=new T.Vector3(),forward=Math.sign(Math.cos(yaw));
    for(const section of horn){
      point.set(...section.slice(0,3)).applyMatrix4(tip.matrixWorld);
      const r=.018+section[4]*.8;
      const tangent=Math.sqrt(Math.max(0,r*r-(point.y+.006)**2));
      point.z=.011+forward*Math.max(forward*(point.z-.011),tangent);
      tip.worldToLocal(point);section.splice(0,3,point.x,point.y,point.z);
    }
    knuckle.rotation.x=0;tip.rotation.x=0;
    digit(tip,0x4b4038,horn);
    mark('toeBase',first);mark('toeTip',first+1);mark('claw',first+2);
    toes.push({knuckle,tip,length,toe,restYaw:toe.rotation.y});
  }
  const support=new T.Vector3(),flight=new T.Vector3(),orientation=new T.Quaternion();
  return {pad,carrier,pose(p){
    const lag=s<0?0:.026;
    const lift=p.launch?ease((p.age-.365-lag)/.51):p.air;
    const exit=p.launch?ease((p.age-.36-lag)/.26):1;
    const brakeReach=p.land?ease((p.approach-.45)/.36):0;
    const approach=p.land?ease((p.approach-.85)/.15):0;
    const closing=p.land?ease((p.touchdownAge+.10)/.17):0;
    // In the last part of the approach the foot follows the perch frame.
    // The carrier locks before the pectoral girdle settles.
    const release=p.launch?ease((p.age-.29-lag)/.115):1;
    const extend=p.launch?1-ease((p.age-.46-lag)/.30):brakeReach;
    const grip=p.launch?1-release+.40*ease((p.age-.61)/.28):p.land?mix(.40*(1-brakeReach),1,closing):p.air>.01?.40:1;
    const open=p.launch?release*(1-ease((p.age-.57)/.21)):p.land?brakeReach*(1-closing):0;
    orientation.copy(owl.root.quaternion).invert();
    support.copy(owl.origin).sub(owl.root.position);
    support.y+=p.launch?.046*ease((p.age-.32-lag)/.22):p.land?.045*(1-closing):0;
    support.applyQuaternion(orientation);
    flight.copy(owl.body.position);
    if(p.launch){
      carrier.position.copy(support).lerp(flight,exit);
    }else if(p.land){
      carrier.position.copy(flight).lerp(support,approach);
    }else if(p.air>.01){
      carrier.position.copy(flight).multiplyScalar(p.air);
    }else{
      carrier.position.copy(support);
    }
    carrier.quaternion.copy(orientation).slerp(owl.body.quaternion,lift*(1-approach)*exit);
    ankle.rotation.x=lift*(.87-1.34*extend)*(1-approach)*exit;
    for(const {knuckle,tip,length,toe,restYaw} of toes){
      const curl=clamp(grip+(length-.033)*16*grip*(1-grip));
      knuckle.rotation.x=.04+.18*curl+.11*lift*(1-extend)*(1-approach)*exit;
      tip.rotation.x=.05+.51*curl+.20*lift*(1-extend)*(1-approach)*exit;
      toe.rotation.y=restYaw+Math.sin(restYaw)*.18*open;
    }
  }};

}

export class Owl extends Specimen{
  constructor(){
    super();this.maps=[guideMap('body'),guideMap('head'),guideMap('wing'),guideMap('detail')];
    // The rump lies aft of the hock and the breast projects ahead of it.
    // The narrowed upper pole continues inside the cervical plumage.
    // Pitch the pectoral girdle about the hip; feet keep their perch frame.
    this.trunk=joint(this.body,0,.011,-.021);
    this.trunk.rotation.x=.16;
    this.breast=this.mesh(this.trunk,0xfffffe,breastPlumage);
    this.breast.material.map=this.maps[0];this.breast.material.roughness=.96;
    owlFinish(this.breast.material,'body',.000145);
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
    this.headFrame=new T.Quaternion();
    this.resetMotion();
  }
  resetMotion(){
    this.motion=new OwlMotion();
    this.motion.step('Perch',{},this.origin);
    this.motion.age=0;
    this.applyPose(this.motion.pose);
  }
  update(dt,t,action,context={}){
    this.applyPose(this.motion.advance(dt,action,context,this.origin));
  }
  applyPose(p){
    const {t,air,open,bank,route,brake,breath,shift,power,trim}=p;
    this.air=air;this.open=open;this.bank=bank;this.route=route;
    const radial=2.4;
    this.root.position.copy(this.origin);
    this.root.position.x+=radial*(1-Math.cos(route));
    this.root.position.z+=radial*Math.sin(route);
    this.root.position.y+=.24*Math.sin(route*.5)**2;
    this.root.quaternion.setFromAxisAngle(yawAxis,route);
    this.breast.scale.set(1+.008*breath,1+.005*breath,1+.006*breath);
    this.neck.position.y=.202+.0009*breath;
    this.neck.position.z=.028;
    this.body.rotation.set(.96*air-.27*brake+.031*p.bounce,-.07*bank,bank+.025*shift,'YXZ');
    this.body.position.set(.012*shift,air*.31-p.crouch-p.settle+.011*p.bounce,air*.12);
    // Share yaw across the cervical chain and remove the torso's roll
    // and pitching from the head frame as the body banks or beats.
    const trackPitch=p.pitch+.07*brake-.01*p.bounce;
    const trackRoll=p.tilt-.035*p.yaw-.20*bank;
    this.headFrame.copy(this.body.quaternion).multiply(this.trunk.quaternion).invert();
    for(const [node,share] of [[this.neck,.34],[this.atlas,.38],[this.head,.28]]){
      node.rotation.set(trackPitch*share,p.yaw*share,trackRoll*share,'YXZ');
    }
    // Retain the accepted A6 forward rest angle and make the flight
    // direction the orientation reference for the chain.
    this.headFrame.multiply(this.trunk.quaternion);
    this.neck.quaternion.premultiply(this.headFrame);
    this.blink(owlBlink(t,0),owlBlink(t,1));
    this.wings.forEach((wing,i)=>{
      const side=i?1:-1;
      const wave=owlStroke(p.phase+side*(.018+.009*Math.sin(t*1.9)));
      const anticipation=p.launch?.34*ease((p.age-.17)/.19)*(1-ease((p.age-.37)/.22)):0;
      const stroke=open*(wave.stroke*power+anticipation+.25*brake+side*.31*bank+trim*air);
      const trimFlex=p.glide*air*(.085+.8*trim+side*.18*bank);
      const lag=owlStroke(p.phase-.10+side*.023).load*power+trimFlex;
      wing(open,stroke,wave.recovery*power+.42*brake,this.body.rotation.x,lag,
        power*(.36*wave.recovery+.24*wave.load)+.36*brake+side*.27*bank+open*.055*shift);
    });
    this.tail.rotation.set(-.15*air+.39*brake+.050*p.bounce,bank*.54+.20*trim*air,-.35*bank+.04*shift);
    for(const {shaft,t:spread} of this.rectrices)shaft.rotation.y=-spread*(.16+.23*air+.34*brake+.21*Math.abs(bank));
    this.feet.forEach(foot=>foot.pose(p));
  }
  setLOD(level){
    super.setLOD(level);
    const detail=Number(level<2);
    for(const material of this.materials.values()){
      if(material.defines?.OWL_FINISH_DETAIL===undefined||material.defines.OWL_FINISH_DETAIL===detail)continue;
      material.defines.OWL_FINISH_DETAIL=detail;
      material.needsUpdate=true;
    }
  }
  dispose(){this.maps.splice(0).forEach(releaseGuideMap);super.dispose()}
}
