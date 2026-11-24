// Production bind pose: B.5, with separated wrist grafts and continuous hoof walls.
import * as T from '../vendor/three.module.js';
import {unzlibSync} from '../vendor/fflate.js';
import {bindLevels} from './centaur-bind.js';
import {Specimen,joint} from './form.js';
import {finishMaterial} from './centaur-finish.js';
import {groomCentaur} from './centaur-groom.js';
import {equineContacts} from './equine-gait.js';

const clay=0xa8a197;
const vec=(x,y,z)=>new T.Vector3(x,y,z);
const smooth=(lo,hi,v)=>T.MathUtils.smoothstep(v,lo,hi);
const restLevels=[];

function readSurface(level){
  if(restLevels[level])return restLevels[level];
  const bytes=unzlibSync(Uint8Array.from(atob(bindLevels[level]),c=>c.charCodeAt(0)));
  const view=new DataView(bytes.buffer,bytes.byteOffset),count=view.getUint32(0,true),faces=view.getUint32(4,true);
  let offset=8;
  const xyz=new Float32Array(3*count),indices=new Uint32Array(3*faces);
  for(let axis=0;axis<3;axis++){
    let sum=0;
    for(let i=0;i<count;i++,offset+=4){sum+=view.getInt32(offset,true);xyz[3*i+axis]=sum/1e6;}
  }
  let index=0;
  for(let i=0;i<indices.length;i++,offset+=4){index+=view.getInt32(offset,true);indices[i]=index;}
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(xyz,3));
  geometry.setIndex(new T.BufferAttribute(indices,1));geometry.computeVertexNormals();
  const regions=bytes.slice(offset); // 1 = tail, 2 = detached arm below the axilla.
  return restLevels[level]={geometry,regions};
}

const foreStations=[[1.15,.637],[.887,.474],[.499,.599],[.176,.563],[.079,.620]];
const hindStations=[[1.306,-.505],[.867,-.343],[.513,-.586],[.178,-.555],[.078,-.508]];

export class Centaur extends Specimen {
  constructor(){
    super();
    const base=joint(this.body);
    this.bones=[];this.bindPoints=[];this.bisectors=[];
    const bone=(name,parent,point)=>{
      const b=new T.Bone();b.name=name;b.userData.index=this.bones.length;
      this.bones.push(b);this.bindPoints.push(point);
      (parent||base).add(b);b.position.copy(point);
      if(parent)b.position.sub(this.bindPoints[parent.userData.index]);
      return b;
    };
    this.core=bone('barrel',null,vec(0,0,0));
    this.pelvis=bone('equine pelvis',this.core,vec(0,1.18,-.48));
    this.tail=bone('dock',this.pelvis,vec(0,1.34,-.69));
    this.tailChain=[this.tail];
    for(const [h,z] of [[1.11,-.892],[.82,-.91],[.53,-.96],[.30,-1.035]]){
      this.tailChain.push(bone('tail at '+h,this.tailChain.at(-1),vec(0,h,z)));
    }
    this.tailRates=this.tailChain.map(()=>vec(0,0,0));
    this.tailAngles=this.tailChain.map(()=>vec(0,0,0));
    this.armRecoil=0;
    this.waist=bone('abdominal attachment',this.core,vec(0,1.39,.569));
    this.chest=bone('thorax',this.waist,vec(0,1.64,.675));
    this.ribs=bone('rib excursion',this.chest,vec(0,1.65,.678));
    this.neck=bone('neck',this.chest,vec(0,1.935,.691));
    this.head=bone('head',this.neck,vec(0,2.003,.712));
    this.arms=[-1,1].map(s=>{
      const arm=bone('shoulder '+s,this.chest,vec(s*.252,1.843,.674));
      const elbow=bone('elbow '+s,arm,vec(s*.338,1.585,.660));
      const wrist=bone('wrist '+s,elbow,vec(s*.344,1.343,.731));
      const fingers=bone('knuckles '+s,wrist,vec(s*.343,1.255,.765));
      const thumb=bone('thumb saddle '+s,wrist,vec(s*.323,1.299,.802));
      return {arm,elbow,wrist,fingers,thumb};
    });
    const legs=[];
    for(const side of [-1,1])for(const fore of [false,true]){
      const dz=side*(fore?-.037:.053),x=side*(fore?.215:.220);
      const names=fore?['shoulder','elbow','carpus','fetlock','hoof']:['hip','stifle','hock','fetlock','hoof'];
      const ref=(fore?foreStations:hindStations).map(([y,z])=>vec(x,y,z+dz*(1-smooth(.69,1.19,y))));
      const bones=[],helpers=[];
      ref.forEach((p,i)=>bones.push(bone(names[i]+' '+side,bones[i-1]||this.core,p)));
      for(let i=1;i<4;i++){
        const half=bone(names[i]+' volume '+side,bones[i-1],ref[i]);
        helpers[i]=half;this.bisectors.push([half,bones[i]]);
      }
      const home=vec(x,0,(fore?.662:-.484)+dz);
      const sole=joint(bones[4],...home.clone().sub(ref[4]).toArray());
      const offsets=ref.slice(1).map((p,i)=>p.clone().sub(ref[i]));
      const angles=offsets.map(p=>Math.atan2(p.z,-p.y));
      legs.push({fore,side,bones,helpers,ref,sole,home,offsets,lengths:offsets.map(p=>p.length()),
        joints:Object.fromEntries(names.map((n,i)=>[n,bones[i]])),pasternAngle:angles[3],pasternYield:.098,
        carpalFlex:angles[1]-angles[2],hockRatio:(angles[2]-angles[1])/(angles[0]-angles[1]),
        anchor:vec(),target:vec(),liftOff:vec(),landing:vec(),yaw:0,startYaw:0,endYaw:0,
        phase:((fore?.75:0)+(side>0?.5:0))%1,stance:true,initialized:false,swing:0});
    }
    this.horse=equineContacts(this,base,this.tail,base,legs,{kind:'centaur',fitted:true});
    const levels=[];
    const level=i=>levels[i]??=this.skinLevel(i,legs);
    const skin=this.mesh(base,clay,i=>level(i).body,T.SkinnedMesh);
    this.root.updateMatrixWorld(true);
    this.skeleton=new T.Skeleton(this.bones);skin.bind(this.skeleton);
    skin.frustumCulled=false;
    // The pigmented skin and unpigmented hoof walls have the same base clay.
    this.materials.delete(clay);this.materials.set('pigmented skin',skin.material);
    skin.material.vertexColors=true;
    this.gaze=new T.Vector2();this.lids=[];this.brows=[];
    this.finishReady=finishMaterial(skin.material,'hide',this.gaze);
    legs.forEach((leg,k)=>{
      leg.skin=skin;
      leg.hoofMesh=this.mesh(leg.bones[4],clay,i=>level(i).feet[k]);
    });
    finishMaterial(legs[0].hoofMesh.material,'hoof',this.gaze);
    groomCentaur(this,base);
    this.update(0,0,'Idle');
  }

  influences(x,h,z,region,legs){
    const a=Math.abs(x),side=x>0?1:0;
    const one=b=>[[b,1]];
    const blend=(a,b,t)=>[[a,1-t],[b,t]];
    if(region===1)return blend(this.pelvis,this.tail,1-smooth(1.15,1.39,h));
    if(region===2 || (h>=1.744 && z>.49 && a>.142 && h<1.981)){
      const {arm,elbow,wrist,fingers,thumb}=this.arms[side];
      if(h<1.314){
        const opposition=smooth(.782,.817,z)*(1-smooth(.315,.345,a));
        const tip=1-smooth(1.231,1.284,h),pollex=opposition*(1-smooth(1.282,1.32,h));
        return [[wrist,(1-pollex)*(1-tip)],[fingers,(1-pollex)*tip],[thumb,pollex]];
      }
      if(h<1.50)return blend(wrist,elbow,smooth(1.314,1.372,h));
      if(h<1.70)return blend(elbow,arm,smooth(1.528,1.641,h));
      const attach=region===2?1:smooth(.147,.251,a)*(1-smooth(1.908,1.984,h));
      return blend(this.chest,arm,attach);
    }
    if(h>1.35 && z>.26){
      if(h>1.996)return blend(this.neck,this.head,smooth(1.996,2.047,h));
      if(h>1.91)return blend(this.chest,this.neck,smooth(1.91,1.979,h));
      if(h>1.55)return blend(this.waist,this.ribs,smooth(1.55,1.745,h));
      const lumbar=smooth(1.35,1.53,h)*smooth(.26,.54,z);
      return blend(this.core,this.waist,lumbar);
    }
    const fore=z>.12,leg=legs[2*side+Number(fore)];
    const reach=fore?smooth(.205,.465,z):1-smooth(-.37,-.115,z);
    const proximal=1-smooth(leg.ref[0].y-.045,leg.ref[0].y+.18,h);
    const medial=1-smooth(.755,1.10,h)*(1-smooth(.055,.195,a));
    const limb=proximal*reach*medial;
    const pelvis=(1-smooth(-.58,-.08,z))*smooth(.76,1.21,h);
    if(limb<=0)return blend(this.core,this.pelvis,pelvis);
    let pairs=one(leg.bones[0]);
    for(let k=1;k<5;k++){
      const rad=[0,.117,.065,.046,.020][k];
      const t=1-smooth(leg.ref[k].y-rad,leg.ref[k].y+rad,h);
      if(!t)break;
      if(k===4)pairs=blend(leg.bones[3],leg.bones[4],1-smooth(.081,.105,h));
      else pairs=t<.5?blend(leg.bones[k-1],leg.helpers[k],2*t):
        blend(leg.helpers[k],leg.bones[k],2*t-1);
    }
    return [...pairs.map(([b,w])=>[b,w*limb]),[this.core,(1-limb)*(1-pelvis)],[this.pelvis,(1-limb)*pelvis]];
  }

  skinLevel(level,legs){
    const {geometry,regions}=readSurface(level);
    const pos=geometry.attributes.position.clone(),norm=geometry.attributes.normal;
    const coverage=new Float32Array(pos.count);
    const tint=new Float32Array(pos.count*3).fill(1);
    const ids=new Uint16Array(pos.count*4),weights=new Float32Array(pos.count*4);
    const footOf=new Int8Array(pos.count).fill(-1);
    for(let i=0;i<pos.count;i++){
      const x=pos.getX(i),h=pos.getY(i),z=pos.getZ(i);
      if(h>1.993&&h<2.14&&z>.717){
        const a=Math.abs(x);
        // Seat the optical surface in the existing socket under the lid margin.
        const seat=(1-smooth(.014,.022,Math.abs(a-.033)))*(1-smooth(.006,.013,Math.abs(h-2.119)));
        pos.setZ(i,z-.008*seat*smooth(.78,.81,z));
        const jaw=(1-smooth(2.037+.56*a,2.049+.56*a,h))*smooth(1.993,2.015,h);
        const lip=1-smooth(.002,.007,Math.abs(h-2.046));
        const muzzle=(1-smooth(.018,.033,a))*Math.exp(-((h-2.056)**2)/.000022);
        const whisker=Math.min(1,(jaw*(1-lip*(1-smooth(.020,.038,a)))+muzzle)*smooth(.718,.770,z));
        const grain=.88+.12*Math.sin(1800*h+320*x)*Math.cos(1200*z);
        tint.set([1-.36*whisker*grain,1-.39*whisker*grain,1-.40*whisker*grain],3*i);
      }
      const seam=1.44-.22*(z-.61)+.028*Math.cos(x*15);
      coverage[i]=regions[i]===2?1:smooth(seam-.054,seam+.073,h)*smooth(.24,.51,z);
      const pairs=this.influences(x,h,z,regions[i],legs);
      pairs.forEach(([bone,w],k)=>{ids[4*i+k]=bone.userData.index;weights[4*i+k]=w;});
      if(h<=.080 && regions[i]===0)footOf[i]=2*Number(x>0)+Number(z>.12);
    }
    const trunk=[],feet=legs.map(()=>({map:new Map(),xyz:[],normal:[],tri:[]}));
    const tri=geometry.index.array;
    for(let f=0;f<tri.length;f+=3){
      const a=tri[f],b=tri[f+1],c=tri[f+2],k=footOf[a];
      if(regions[a]===1)continue; // The groom replaces the old one-piece tail.
      if(k<0||k!==footOf[b]||k!==footOf[c]){trunk.push(a,b,c);continue;}
      const part=feet[k],pivot=legs[k].ref[4];
      for(const i of [a,b,c]){
        if(!part.map.has(i)){
          part.map.set(i,part.xyz.length/3);
          part.xyz.push(pos.getX(i)-pivot.x,pos.getY(i)-pivot.y,pos.getZ(i)-pivot.z);
          part.normal.push(norm.getX(i),norm.getY(i),norm.getZ(i));
        }
        part.tri.push(part.map.get(i));
      }
    }
    const body=new T.BufferGeometry();
    body.setAttribute('position',pos);body.setAttribute('normal',norm);body.setIndex(trunk);
    body.setAttribute('skinCoverage',new T.BufferAttribute(coverage,1));
    body.setAttribute('color',new T.BufferAttribute(tint,3));
    body.setAttribute('skinIndex',new T.BufferAttribute(ids,4));body.setAttribute('skinWeight',new T.BufferAttribute(weights,4));
    return {body,feet:feet.map(part=>{
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(part.xyz,3));
      g.setAttribute('normal',new T.Float32BufferAttribute(part.normal,3));g.setIndex(part.tri);return g;
    })};
  }

  followTail(dt,time){
    const gait=this.horse;
    const swish=(1-smooth(0,1.4,Math.abs(time%9.7-3.6)))*Math.sin((time-3.6)*2.6);
    const {pitch,roll,gallop,acceleration,brake,push,impact}=gait.support;
    // Integrate tangent angles in the travel frame. Subtracting the actual
    // parent angle lets the tip keep its heading while the dock reverses.
    let parentX=pitch+this.pelvis.rotation.x,parentZ=roll+this.pelvis.rotation.z;
    const stream=.095*gait.speed+.052*acceleration-.060*brake;
    let targetX=parentX+stream+.095*gallop*(push-impact);
    let targetZ=parentZ+.12*swish+.085*gait.support.hind-.16*gait.turn;
    for(let i=0;i<this.tailChain.length;i++){
      const node=this.tailChain[i],angle=this.tailAngles[i],rate=this.tailRates[i];
      const frequency=19-1.45*i,damping=i===0?1.72:1.30;
      rate.x+=dt*(frequency**2*(targetX-angle.x)-damping*frequency*rate.x);
      rate.z+=dt*(frequency**2*(targetZ-angle.z)-damping*frequency*rate.z);
      angle.x+=dt*rate.x;angle.z+=dt*rate.z;
      node.rotation.set(angle.x-parentX,0,angle.z-parentZ);
      parentX=angle.x;parentZ=angle.z;
      targetX=.89*angle.x+.49*stream;targetZ=.90*angle.z-.025*gait.turn;
    }
  }

  update(dt,t,action,context){
    // Small steps keep strike and lift-off events ordered during time scaling.
    const steps=Math.max(1,Math.ceil(dt*60));
    for(let i=0;i<steps;i++){
      this.horse.advance(dt/steps,action,context);
      const time=t-dt+(i+1)*dt/steps;
      this.horse.animate(time);
      const support=this.horse.support;
      const stretch=support.gallop*(.12*support.gather-.065*support.push);
      const weight=Math.min(1,this.horse.speed/.66+Math.abs(this.horse.turn)*.48);
      this.pelvis.rotation.set(.012*weight*(support.drive-support.impact)+stretch,
        -.029*weight*support.hind-.045*this.horse.turn,.024*weight*support.hind);
      this.armRecoil+=(support.impact-support.push-this.armRecoil)*(1-Math.exp(-dt/steps*8));
      this.followTail(dt/steps,time);
    }
    for(const [half,child] of this.bisectors)half.quaternion.identity().slerp(child.quaternion,.5);
    const gait=this.horse;
    const effort=Math.min(1,gait.speed/.66+Math.abs(gait.turn)*.48);
    const {fore,hind,roll,pitch,brake,run,gallop,drive,impact,acceleration}=gait.support;
    const thrust=gallop*(drive-impact),brace=run*impact;
    const speedFraction=T.MathUtils.clamp(gait.speed/3.52,0,1);
    const lean=.28*speedFraction**1.4+.038*T.MathUtils.clamp(acceleration,-2,2);
    const breath=Math.sin(1.36*t+.17*Math.sin(.53*t)),idle=1-effort;
    const window=(u,duration)=>smooth(0,.24*duration,u)*(1-smooth(.60*duration,duration,u));
    const gaze=window((t+.4)%11.3,4.4)-.55*window((t+5.2)%13.7,3.3);
    this.waist.rotation.set(.66*lean-.024*effort-.55*pitch-.018*brake,
      -.035*fore*effort+.065*gait.turn,-.65*roll);
    this.chest.rotation.set(.34*lean+.012*breath-.22*pitch-.045*brace+.035*thrust,
      .044*hind*effort+.065*gait.turn,.011*fore*effort);
    this.ribs.scale.set(1+.013*breath,1,1+.019*breath);
    const blinkTime=(t+.23*Math.sin(t*.72))%4.93;
    const blink=smooth(1.72,1.798,blinkTime)*(1-smooth(1.808,1.958,blinkTime));
    for(const mesh of this.lids)mesh.morphTargetInfluences[0]=blink;
    this.gaze.set(.0013*gaze+.00075*Math.tanh(8*Math.sin(.71*t)),.00046*Math.sin(1.03*t));
    for(const [i,brow] of this.brows.entries())brow.position.y=.00065*gaze*(i>=2?1:.45);
    const attention=.32+.68*idle;
    this.neck.rotation.set(.007*breath-.25*pitch-.37*lean,.11*gait.turn+.055*gaze*attention,-.25*roll);
    this.head.rotation.set(.014*breath-.019*gaze*attention,.16*gaze*attention+.16*gait.turn-.017*hind*effort,-.010*gaze*attention);
    this.arms.forEach(({arm,elbow,wrist,fingers,thumb},i)=>{
      const s=i?1:-1, swing=s*effort*(.69*hind-.31*fore);
      const gesture=(.26+.74*idle)*window((t+(i?1.1:7.2))%(i?10.9:13.2),3.25);
      const recoil=this.armRecoil*run,catchLoad=this.horse.legs[i*2+1].load;
      const absorb=run*(.055*catchLoad+.05*acceleration);
      arm.rotation.set(.145*swing-.085*gesture+.22*thrust-.10*recoil-absorb,-s*(.038*gesture+.023*fore*effort),s*(.030+.032*gesture));
      elbow.rotation.set(-.065-.23*run-.16*gallop-.17*brace-.085*recoil-absorb-.075*Math.max(0,-swing)-.21*gesture,0,0);
      wrist.rotation.set(.015*breath+.025*swing+.090*recoil+.043*thrust,s*.13*gesture,-s*.082*gesture);
      fingers.rotation.z=-s*(.045+.19*gesture);
      thumb.rotation.y=s*(.018+.11*gesture);
    });
  }
}
