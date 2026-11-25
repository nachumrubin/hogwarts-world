import * as T from '../vendor/three.module.js';
import {Hippogriff as Anatomy} from './hippogriff.js';
import {hindAngles} from './equine-gait.js';
import {V,clamp,smooth,legs,toes,boneIndex,bindSpecimen} from './hippogriff-rig.js';

export const actions={Idle:'Idle',Walk:'Walk',Trot:'Trot',Gallop:'Gallop',Unfold:'Unfold wings',Takeoff:'Ground-assisted takeoff',
 Fly:'Powered flight',Glide:'Glide',Bank:'Banked turn',Descend:'Controlled descent',Land:'Land and absorb impact',Fold:'Fold wings',
 Alert:'Alert and track',Ruffle:'Feather ruffle',Swish:'Tail swish',Blink:'Blink',Bow:'Respectful bow',Sequence:'Locomotion sequence'};
export const sequence=[['Idle',1.4],['Walk',2.2],['Trot',2.0],['Gallop',2.0],['Takeoff',2.0],['Fly',2.1],
 ['Glide',1.7],['Bank',2.2],['Descend',2.1],['Land',2.2],['Fold',1.7],['Idle',1.5]];
const gaits={Idle:[0,.9,.70,[0,.25,.5,.75]],Walk:[.86,.86,.68,[0,.25,.5,.75]],
 Trot:[2.05,1.31,.47,[0,.5,.5,0]],Gallop:[3.65,1.55,.34,[0,.41,.14,.55]]};
const tau=2*Math.PI,mod=x=>x-Math.floor(x),mix=(a,b,t)=>a+(b-a)*t;
const Q=()=>new T.Quaternion(),rot=(x,y=0,z=0)=>Q().setFromEuler(new T.Euler(x,y,z,'YXZ'));
const fixed=new T.Vector3(1,1,1),down=V(0,-1,0),headPivot=V(0,2.40,.98);
const damp=(value,target,rate,dt)=>mix(value,target,1-Math.exp(-dt*rate));
const around=(pivot,q,dest=pivot,scale=fixed)=>new T.Matrix4().compose(dest.clone().sub(pivot.clone().multiply(scale).applyQuaternion(q)),q,scale);
const aim=(a,b,c,d)=>around(a,Q().setFromUnitVectors(b.clone().sub(a).normalize(),d.clone().sub(c).normalize()),c);
const point=(m,p)=>p.clone().applyMatrix4(m);
const dir=a=>V(0,-Math.cos(a),Math.sin(a));

export class Hippogriff extends Anatomy{
 constructor(){
   super();this.age=0;this.elapsed=0;this.sequenceTime=0;this.phase=.06;this.speed=0;this.yaw=0;this.height=0;
   this.vertical=0;this.open=0;this.flap=0;this.wingPhase=0;this.secondary=0;this.bank=0;this.bow=0;this.alert=0;
   this.cadence=.9;this.duty=.68;this.run=0;this.tuck=0;this.impact=0;this.gaze=0;this.gazePitch=0;
   this.contacts=legs.map((leg,k)=>({offset:gaits.Walk[3][k],stance:true,anchor:null,start:V(),end:V(),target:V(),yaw:0,leg}));
 }
 prepare(){
   if(this.rig)return;
   this.rig=bindSpecimen(this);
   this.body.matrixAutoUpdate=true;
   this.step(0,'Idle',{});this.setWings(0);this.solve(0,{});
 }
 setWings(open){
   for(const r of this.rig.groups.folded)r.mesh.visible=open<.0001;
   for(const r of this.rig.groups.wing){
     r.mesh.visible=open>=.0001;
     r.mesh.morphTargetInfluences[0]=1-open;r.mesh.morphTargetInfluences[1]=Math.sin(Math.PI*open);
   }
 }
 setLOD(l){
   super.setLOD(l);
   if(this.rig)for(const r of this.rig.groups.wing)r.mesh.updateMorphTargets();
   if(this.rig)this.setWings(this.open);
 }
 setPosition(p){super.setPosition(p);if(this.contacts)this.contacts.forEach(c=>c.anchor=null);}
 update(dt,t,action,context={}){
   if(!this.contacts){super.update(dt,t,action);return;}
   if(!this.rig && !dt && action==='Idle')return;
   this.prepare();
   if(action!==this.command){this.command=action;this.sequenceTime=0;}
   // Small fixed upper bound keeps stance edges and impact reproducible at low FPS.
   const steps=Math.max(1,Math.ceil(dt*90)),step=dt/steps;
   for(let i=0;i<steps;i++){
     let state=action;
     if(action==='Sequence'){
       let cursor=this.sequenceTime;
       state='Idle';for(const [name,length] of sequence){if(cursor<length){state=name;break;}cursor-=length;}
       this.sequenceTime+=step;
     }
     if(state!==this.state){this.state=state;this.elapsed=0;}
     this.step(step,state,context);this.elapsed+=step;
   }
   this.solve(dt,context);
 }
 step(dt,state,ctx){
   this.age+=dt;const e=this.elapsed;
   const inAir=['Takeoff','Fly','Glide','Bank','Descend'].includes(state);
   const landing=state==='Land'||(!inAir&&this.height>.01);
   const gait=gaits[state]??(state==='Takeoff'?gaits.Gallop:gaits.Idle);
   const airSpeed=state==='Takeoff'?3.65:state==='Descend'?2.25:3.1;
   const speed=inAir?airSpeed:landing?1.20*Math.exp(-e*1.8):gait[0];
   this.speed=damp(this.speed,speed,3.5,dt);
   this.cadence=damp(this.cadence,gait[1],4,dt);this.duty=damp(this.duty,gait[2],4,dt);
   this.run=damp(this.run,clamp(gait[0]/3.65),4,dt);this.phase+=this.cadence*dt;
   const desiredHeight=state==='Descend'?.48:inAir?(state==='Takeoff'?2.35*smooth((e-.32)/1.55):2.35):0;
   const old=this.height;
   this.vertical+=(13*(desiredHeight-this.height)-5.4*this.vertical)*dt;
   this.height=Math.max(0,this.height+this.vertical*dt);
   if(landing && this.height<.035 && this.vertical<0){this.height=0;this.vertical=0;}
   this.impact=damp(this.impact,0,4.3,dt);
   if(landing&&old>.04&&this.height<=.04)this.impact=.16;
   this.tuck=damp(this.tuck,inAir&&state!=='Descend'?smooth((this.height-.09)/.67):0,4.8,dt);
   this.bank=damp(this.bank,state==='Bank'?.42:0,2.5,dt);
   let turn=-this.bank*.88;
   if(ctx.habitatRadius&&!ctx.studio && this.speed>.3){
     const p=this.root.position.clone().sub(this.origin),radius=ctx.habitatRadius*.90;
     const inward=Math.atan2(-p.x,-p.z);
     turn+=clamp(Math.atan2(Math.sin(inward-this.yaw),Math.cos(inward-this.yaw)),-1,1)*smooth((p.length()-radius)/2.2);
   }
   this.yaw+=turn*dt;
   this.root.rotation.y=this.yaw;
   this.root.position.x+=Math.sin(this.yaw)*this.speed*dt;this.root.position.z+=Math.cos(this.yaw)*this.speed*dt;
   this.ground=ctx.terrainHeight?.(this.root.position.x,this.root.position.z)??0;
   this.root.position.y=this.origin.y+this.ground+this.height;
   let wingGoal=inAir||state==='Unfold'||(state==='Land'&&e<2.2)?1:0;
   this.open=clamp(this.open+Math.sign(wingGoal-this.open)*Math.min(Math.abs(wingGoal-this.open),dt*(wingGoal?1.02:.81)));
   this.flap=damp(this.flap,state==='Fly'||state==='Takeoff'?1:state==='Land'&&e<1?.48:0,3.2,dt);
   this.wingPhase+=dt*(state==='Takeoff'?1.28:1.04)*tau;
   this.secondary=damp(this.secondary,Math.sin(this.wingPhase),7.4,dt);
   this.bow=damp(this.bow,state==='Bow'?smooth(e/.65)*(1-smooth((e-2.0)/.9)):0,6,dt);
   this.alert=damp(this.alert,state==='Alert'?1:0,5,dt);
   const look=ctx.stimulus??ctx.playerPosition;
   const yaw=look?Math.atan2(look.x-this.root.position.x,look.z-this.root.position.z)-this.yaw:0;
   this.gaze=damp(this.gaze,clamp(Math.atan2(Math.sin(yaw),Math.cos(yaw)),-.50,.50)*(.12+.77*this.alert),3.2,dt);
   this.gazePitch=damp(this.gazePitch,look?clamp((look.y-this.root.position.y-2.6)*.12,-.18,.18)*this.alert:0,3,dt);
   const targetOffsets=gait[3],stamp=this.phase;
   this.contacts.forEach((c,k)=>{
     const diff=mod(targetOffsets[k]-c.offset+.5)-.5;c.offset+=diff*(1-Math.exp(-4*dt));
     const ph=mod(stamp-c.offset),anchorHome=this.home(c),height=ctx.terrainHeight??(()=>0);
     const air=this.height>.04;
     const moving=this.speed>.045 && !air;
     const stance=(!moving || ph<this.duty)&&!air;
     if(!c.anchor){c.anchor=anchorHome.clone();c.anchor.y=height(c.anchor.x,c.anchor.z)+this.origin.y;c.yaw=this.yaw;}
     if(!stance && (c.stance||(!air&&c.airborne))){
       c.start=(!air&&c.airborne?anchorHome:c.anchor).clone();c.start.y=height(c.start.x,c.start.z)+this.origin.y;
       const lead=this.speed*(1-this.duty*.5)/this.cadence;
       c.end=anchorHome.clone().add(V(Math.sin(this.yaw)*lead,0,Math.cos(this.yaw)*lead));
       c.end.y=height(c.end.x,c.end.z)+this.origin.y;
     }
     if(stance&&!c.stance){
       c.anchor=c.airborne?anchorHome.clone():c.end.clone();
       if(c.anchor.distanceTo(anchorHome)>1.15)c.anchor.copy(anchorHome);
       c.anchor.y=height(c.anchor.x,c.anchor.z)+this.origin.y;c.yaw=this.yaw;
     }
     if(air&&!c.airborne){c.release=c.target.clone().sub(anchorHome);c.release.y=0;}
     c.airborne=air;
     c.spread=damp(c.spread??1,Number(stance),18,dt);
     c.stance=stance;c.swing=air?1:stance?0:clamp((ph-this.duty)/(1-this.duty));
     if(stance)c.target.copy(c.anchor);
     else if(air){c.target.copy(anchorHome).addScaledVector(c.release,1-smooth((this.height-.04)/.48));c.target.y=height(anchorHome.x,anchorHome.z)+this.origin.y;}
     else {c.target.lerpVectors(c.start,c.end,smooth(c.swing));c.target.y+=(.095+.21*this.run)*Math.sin(Math.PI*c.swing)**1.4;}
   });
 }
 home(c){
   const p=c.leg.points.at(-1);
   return V(p.x,0,p.z).applyAxisAngle(V(0,1,0),this.yaw).add(this.root.position);
 }
 write(name,m){
   const b=this.rig.bones[boneIndex[name]];b.matrixAutoUpdate=false;b.matrix.copy(m);b.matrixWorldNeedsUpdate=true;
 }
 solve(dt,ctx){
   const t=this.age,p=this.phase*tau,air=smooth(this.height/.7),wave=Math.sin(this.wingPhase),load=this.run;
   const crouch=this.state==='Takeoff'?.16*Math.sin(Math.PI*clamp(this.elapsed/.53)):0;
   const breathing=.008*Math.sin(t*1.93),bob=(.024+.071*load)*Math.cos(2*p)*load*(1-air);
   const pitch=.068*load*Math.sin(p)*(1-air)-.10*this.vertical+.14*this.bow;
   const roll=.032*load*Math.sin(p)*(1-air)+this.bank;
   const mid=V(0,1.43,-.04),spine=around(mid,rot(pitch,0,roll),mid.clone().add(V(.028*load*Math.sin(p),bob+breathing-crouch-this.impact+.060*air*this.flap*wave,0)),V(1+breathing*.36,1+breathing*.27,1));
   // Lower the shoulder girdle when stride reach approaches full extension.
   // A grounded foot keeps its anchor while the trunk yields to the load.
   this.root.updateMatrixWorld(true);
   let compression=0;
   for(const c of this.contacts){
     if(!c.leg.fore||this.height>.6)continue;
     const r=c.leg.points,base=point(spine,r[0]),foot=this.root.worldToLocal(c.target.clone());
     const swing=c.stance?0:Math.sin(Math.PI*c.swing),bend=.13+.95*swing+this.tuck;
     const a=r[0].distanceTo(r[1]),b=r[1].distanceTo(r[2]),d=r[2].distanceTo(r[3]);
     const reach=a+Math.sqrt(b*b+d*d+2*b*d*Math.cos(bend))-.008;
     const dx=base.x-foot.x,dz=base.z-foot.z;
     const limit=Math.sqrt(Math.max(.01,reach*reach-dx*dx-dz*dz));
     compression=Math.max(compression,(base.y-foot.y-r.at(-1).y-limit)*(1-smooth((this.height-.04)/.56)));
   }
   spine.elements[13]-=compression;
   this.write('spine',spine);
   const neckBase=V(0,1.77,.48);
   const neck=spine.clone().multiply(around(neckBase,rot(.80*this.bow-.58*pitch-.09*this.alert,.45*this.gaze,-.47*roll)));
   const head=neck.clone().multiply(around(headPivot,rot(.20*this.bow-.37*pitch-.5*this.gazePitch,.55*this.gaze,-.44*roll)));
   this.write('neck',neck);this.write('skull',head);
   const ruff=this.state==='Ruffle'?.055*Math.sin(this.elapsed*18)*Math.sin(Math.PI*clamp(this.elapsed/1.8))**2:0;
   this.write('ruff',neck.clone().multiply(around(neckBase,rot(ruff*.3),neckBase,V(1+ruff,1,1+ruff*.6))));
   const blinkPhase=this.state==='Blink'?this.elapsed%1.4:mod(t/4.65)*4.65;
   const blink=Math.sin(Math.PI*clamp((blinkPhase-.32)/.18))**2;
   for(let i=0;i<2;i++){
     const eye=V((i?1:-1)*.192,2.634,1.386);
     this.write('eye'+i,head.clone().multiply(around(eye,rot(-this.gazePitch*.4,this.gaze*.38),eye,V(1,1-.96*blink,1))));
     this.write('lid'+i,head.clone().multiply(around(eye,Q(),eye,V(1,1-.80*blink,1))));
   }
   const swish=(this.state==='Swish'?.41:.075)*Math.sin(t*(this.state==='Swish'?3.9:1.52));
   const tail=spine.clone().multiply(around(V(0,1.69,-1.18),rot(.33*air+.10*load*Math.cos(p),0,swish*.55)));
   this.write('tailRoot',tail);this.write('tailTip',tail.clone().multiply(around(V(0,1.13,-1.42),rot(.22*air,0,swish+.06*Math.sin(t*1.52-.5)))));
   const open=smooth(this.open);this.setWings(open);
   for(let k=0;k<2;k++){
     const s=k?1:-1,stroke=this.flap*open,shoulder=V(s*.31,1.91,.32),elbow=V(s*1.11,2.24,-.07),wrist=V(s*1.96,2.22,.29);
     let m=spine.clone().multiply(around(shoulder,rot(.07*wave*stroke,.035*s*stroke,s*(.78*wave*stroke+.08*open-.26*this.bank*s))));
     this.write('shoulder'+k,m);
     m=m.clone().multiply(around(elbow,rot(.09*stroke*Math.cos(this.wingPhase),s*.12*stroke*Math.max(0,wave),s*.21*stroke*Math.sin(this.wingPhase-.45))));
     this.write('elbow'+k,m);
     this.write('secondary'+k,m.clone().multiply(around(elbow,rot(.18*stroke*this.secondary,0,s*.13*stroke*this.secondary))));
     m=m.clone().multiply(around(wrist,rot(.13*stroke*Math.cos(this.wingPhase-.45),s*.23*stroke*Math.max(0,wave),s*.29*stroke*Math.sin(this.wingPhase-.78))));
     this.write('wrist'+k,m);this.write('primary'+k,m.clone().multiply(around(wrist,rot(.14*stroke*this.secondary,s*.11*stroke*wave,s*.13*stroke*this.secondary))));
   }
   this.root.updateMatrixWorld(true);
   for(let k=0;k<4;k++)this.legPose(k,spine,ctx);
 }
 legPose(k,spine,ctx){
   const c=this.contacts[k],{fore,s,points:rest}=c.leg,end=rest.at(-1),base=point(spine,rest[0]);
   let foot=this.root.worldToLocal(c.target.clone());foot.y+=end.y;
   const swing=c.stance?0:Math.sin(Math.PI*c.swing);
   const gather=c.stance?0:smooth((this.height-.04)/.61);
   const folded=fore?V(s*.35,.84,-.20):V(s*.35,.92,-1.50);
   foot.lerp(folded,gather);
   const footRot=rot(.30*swing+(fore?1.03:.76)*this.tuck,(c.yaw-this.yaw)*(1-gather),0);
   if(c.stance&&ctx.terrainHeight){
     const h=ctx.terrainHeight,{x,z}=c.target,d=.035;
     const normal=V(h(x-d,z)-h(x+d,z),2*d,h(x,z-d)-h(x,z+d)).normalize().applyAxisAngle(V(0,1,0),-this.yaw);
     footRot.premultiply(Q().setFromUnitVectors(V(0,1,0),normal));
   }
   const footMatrix=around(end,footRot,foot);
   const lengths=rest.slice(1).map((v,i)=>v.distanceTo(rest[i]));
   const ankle=fore?foot:foot.clone().sub(dir(.65+.11*swing).multiplyScalar(lengths[3]));
   const dz=ankle.z-base.z,dy=ankle.y-base.y,distance=Math.hypot(dy,dz),axis=Math.atan2(dz,-dy);
   let upper,lower;
   if(!fore)[upper,lower]=hindAngles(...lengths.slice(0,3),distance,axis);
   else{
     // Rear-pointing elbow, flexing distal joint; talons keep an
     // independent contact frame throughout support.
     const [a,b,c]=lengths,bend=.13+.95*swing+1.0*this.tuck;
     const distal=Math.sqrt(b*b+c*c+2*b*c*Math.cos(bend));
     upper=axis-Math.acos(clamp((a*a+distance*distance-distal*distal)/(2*a*Math.max(.01,distance)),-1,1));
     const rem=ankle.clone().sub(base).addScaledVector(dir(upper),-a);
     lower=Math.atan2(rem.z,-rem.y)+Math.atan2(c*Math.sin(bend),b+c*Math.cos(bend));
   }
   const elbow=base.clone().addScaledVector(dir(upper),lengths[0]);
   const middle=elbow.clone().addScaledVector(dir(lower),lengths[1]);
   elbow.x=mix(base.x,foot.x,.32);middle.x=mix(base.x,foot.x,.65);
   const joints=fore?[base,elbow,middle,foot]:[base,elbow,middle,ankle,foot];
   c.joints=joints;c.footWorld=this.root.localToWorld(foot.clone());c.footWorld.y-=end.y;
   for(let i=0;i<rest.length-1;i++)this.write('leg'+k+'_'+i,aim(rest[i],rest[i+1],joints[i],joints[i+1]));
   this.write('leg'+k+'_'+(rest.length-1),footMatrix);
   if(fore)toes.forEach((v,i)=>{
     const heading=Math.atan2(s*v.x,v.z),sideAxis=V(Math.cos(heading),0,-Math.sin(heading));
     const curl=.85*swing+1.00*this.tuck;
     const pivot=end.clone().add(V(s*v.x*.22,-.016,v.z*.22));
     const q=Q().setFromAxisAngle(V(0,1,0),s*Math.sign(v.x)*(.068*c.spread-.12*this.tuck))
       .multiply(Q().setFromAxisAngle(sideAxis,curl));
     this.write('toe'+k+'_'+i,footMatrix.clone().multiply(around(pivot,q)));
   });
 }
}
