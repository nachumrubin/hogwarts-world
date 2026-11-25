// Anatomical stations in metres: Y up, +Z toward the nose. The elbow
// points caudally; the stifle points cranially and the hock caudally.
import * as T from '../vendor/three.module.js';
import {joint,sweep} from './form.js';

const vec=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const Y=vec(0,1,0),Z=vec(0,0,1),DOWN=vec(0,-1,0);
const foreStations=[[1.42,.72],[1.035,.399],[.615,.595],[.209,.595],[.103,.666]];
const hindStations=[[1.56,-.71],[1.09,-.42],[.63,-.83],[.212,-.771],[.103,-.695]];
// Width, sagittal depth and sweep centre change independently. The
// scapular upper edge, olecranon, gastrocnemius, point of hock and
// sesamoids all contribute to the silhouette above the thin metapodials.
const foreProfile=[
  [1.83,.37,.020,.076,-.185],[1.75,.42,.087,.169,-.146],[1.62,.535,.123,.190,-.122],
  [1.47,.605,.135,.169,-.106],[1.37,.595,.135,.164,-.090],[1.23,.51,.127,.145,-.062],
  [1.115,.439,.112,.134,-.034],[1.035,.410,.095,.118,-.015],[.955,.442,.095,.119,-.005],
  [.853,.494,.087,.10,0],[.722,.555,.061,.075,0],[.647,.591,.056,.064,0],
  [.607,.597,.064,.071,0],[.565,.597,.053,.062,0],[.481,.592,.043,.055,0],
  [.31,.592,.039,.051,0],[.245,.589,.045,.060,0],[.204,.582,.058,.071,0],
  [.17,.611,.052,.061,0],[.125,.65,.047,.056,0],[.094,.669,.054,.063,0]
];
export const hindProfile=[
  [1.84,-.72,.038,.095,-.12],[1.76,-.74,.117,.195,-.072],[1.62,-.71,.166,.222,-.026],
  [1.50,-.68,.161,.217,0],[1.36,-.622,.148,.203,0],[1.235,-.54,.127,.161,0],
  [1.12,-.458,.106,.123,0],[1.055,-.454,.107,.12,0],[.97,-.53,.105,.133,0],
  [.866,-.61,.089,.123,0],[.765,-.716,.067,.098,0],[.685,-.807,.059,.096,0],
  [.646,-.846,.064,.099,0],[.606,-.833,.063,.078,0],[.556,-.817,.052,.060,0],
  [.45,-.808,.043,.055,0],[.31,-.787,.039,.05,0],[.252,-.783,.046,.059,0],
  [.211,-.786,.057,.071,0],[.166,-.748,.05,.059,0],[.12,-.71,.048,.056,0],[.094,-.69,.054,.063,0]
];

function makeLeg(actor,rig,side,fore,{kind,coat,hoof,slender,length}){
  const unicorn=kind==='unicorn';
  const x=side*(fore?.296:.279)*slender;
  const names=fore?['shoulder','elbow','carpus','fetlock','hoof']:['hip','stifle','hock','fetlock','hoof'];
  const stations=fore?foreStations:hindStations;
  const ref=stations.map(([y,z])=>vec(x,y,z*length));
  // The unicorn has a taller cannon than the more heavily built centaur.
  if(unicorn)ref[2].y+=.026;
  const radii=(unicorn?.91:1.055);
  const rows=(fore?foreProfile:hindProfile).map(([y,z,w,d,offset])=>[
    x+side*offset*slender,y+(unicorn?.026*Math.max(0,1-Math.abs(y-stations[2][0])/.35):0),
    z*length,w*radii,d*radii
  ]);
  const skin=actor.mesh(rig,coat,lod=>{
    const g=sweep(rows,[20,12,8][lod],DOWN);
    const ids=[],weights=[];
    for(let i=0;i<g.attributes.position.count;i++){
      const y=g.attributes.position.getY(i);
      let above=0,lower=0,w=0;
      for(let k=0;k<ref.length;k++){
        const radius=[.22,.14,.105,.087,.036][k];
        if(y>ref[k].y+radius)break;
        above=k;lower=k+1;
        w=1-T.MathUtils.smoothstep(y,ref[k].y-radius,ref[k].y+radius);
      }
      ids.push(above,lower,0,0);weights.push(1-w,w,0,0);
    }
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));
    g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    return g;
  },T.SkinnedMesh);
  const socket=new T.Bone();skin.add(socket);
  const bones=ref.map(()=>new T.Bone());
  bones.forEach((b,i)=>{
    b.name=names[i];(i?bones[i-1]:socket).add(b);
    b.position.copy(ref[i]);if(i)b.position.sub(ref[i-1]);
  });
  skin.updateWorldMatrix(true,true);skin.bind(new T.Skeleton([socket,...bones]));skin.frustumCulled=false;
  const toe=fore?.028:.031;
  // Short, oblique pastern meets the coronet. Flat sole and swept back
  // heel have different profiles from the longer anterior toe wall.
  const hoofMesh=actor.loft(bones[4],hoof,[
    [0,.016,-.003,.052*radii,.061*radii],[0,-.005,.002,.060*radii,.071*radii],
    [0,-.043,.009,.067*radii,.08*radii],[0,-.093,toe,.077*radii,.102*radii],
    [0,-ref[4].y,toe,.075*radii,.101*radii]
  ],[0,-1,0]);
  const sole=joint(bones[4],0,-ref[4].y,toe);
  const offsets=ref.slice(1).map((p,i)=>p.clone().sub(ref[i]));
  return {fore,side,stance:true,skin,hoofMesh,sole,joints:Object.fromEntries(names.map((n,i)=>[n,bones[i]])),
    bones,ref,offsets,lengths:offsets.map(p=>p.length()),swing:0,
    home:ref[4].clone().add(sole.position),anchor:vec(),target:vec(),liftOff:vec(),landing:vec(),
    yaw:0,startYaw:0,endYaw:0,phase:((fore?.75:0)+(side>0?.5:0))%1,initialized:false};
}

// Solve the humerus/radius or femur/tibia analytically above the known
// carpus/hock. The fetlock drops under load; swing folds the fore cannon
// back or the hind cannon forward, following the distinct joint poles.
function groundNormal(height,x,z){
  if(!height)return vec(0,1,0);
  const d=.045;
  return vec(height(x-d,z)-height(x+d,z),2*d,height(x,z-d)-height(x,z+d)).normalize();
}

export function hindAngles(a,b,c,distance,axis){
    const ratio=.68;
    let low=0,high=2.85;
    for(let i=0;i<45;i++){
      const k=(low+high)*.5;
      const reach2=a*a+b*b+c*c+2*(a*b*Math.cos(k)+b*c*Math.cos(ratio*k)+a*c*Math.cos((1-ratio)*k));
      if(reach2>distance*distance)low=k;else high=k;
    }
    const k=(low+high)*.5;
    const upperAngle=axis-Math.atan2(-b*Math.sin(k)-c*Math.sin((1-ratio)*k),
      a+b*Math.cos(k)+c*Math.cos((1-ratio)*k));
    return [upperAngle,upperAngle-k];
}

function poseLeg(leg,rig,terrain,weight){
  const {fore,ref,offsets,lengths,bones}=leg;
  const swing=Math.sin(Math.PI*leg.swing);
  const sole=rig.worldToLocal(leg.target.clone());
  const worldFoot=new T.Quaternion().setFromAxisAngle(Y,leg.yaw);
  if(terrain)worldFoot.premultiply(new T.Quaternion().setFromUnitVectors(Y,groundNormal(terrain,leg.target.x,leg.target.z)));
  worldFoot.multiply(new T.Quaternion().setFromAxisAngle(vec(1,0,0),-.17*swing*swing));
  const foot=rig.getWorldQuaternion(new T.Quaternion()).invert().multiply(worldFoot);
  const coronet=sole.sub(leg.sole.position.clone().applyQuaternion(foot));
  const root=ref[0].clone();
  const down=vec(coronet.x-root.x,coronet.y-root.y,0).normalize();
  const direction=angle=>down.clone().multiplyScalar(Math.cos(angle)).addScaledVector(Z,Math.sin(angle));
  const pasternAngle=(fore?.60:.64)+weight*.075-.10*swing;
  const fetlock=coronet.clone().addScaledVector(direction(pasternAngle),-lengths[3]);
  const delta=fetlock.clone().sub(root),distance=delta.length();
  const axis=Math.atan2(delta.z,delta.dot(down));
  const [a,b,c]=lengths;
  let upperAngle,lowerAngle;
  if(fore){
    // In stance the radius and cannon form a nearly straight column.
    // Flexing the carpus in swing shortens their combined effective link.
    const flex=.055+1.16*swing*swing;
    const distal=Math.sqrt(b*b+c*c+2*b*c*Math.cos(flex));
    const opening=Math.acos(T.MathUtils.clamp((a*a+distance*distance-distal*distal)/(2*a*distance),-1,1));
    upperAngle=axis-opening;
    const remaining=delta.clone().addScaledVector(direction(upperAngle),-a);
    lowerAngle=Math.atan2(remaining.z,remaining.dot(down))+Math.atan2(c*Math.sin(flex),b+c*Math.cos(flex));
  }else{
    // The reciprocal apparatus couples stifle and hock flexion. Solve
    // the coupled chain's reach, keeping each rigid lever at bind length.
    [upperAngle,lowerAngle]=hindAngles(a,b,c,distance,axis);
  }
  const elbow=root.clone().addScaledVector(direction(upperAngle),a);
  const middle=elbow.clone().addScaledVector(direction(lowerAngle),b);
  const points=[root,elbow,middle,fetlock,coronet];
  let previous=new T.Quaternion();
  for(let i=0;i<bones.length;i++){
    const orientation=i===4?foot:new T.Quaternion().setFromUnitVectors(
      offsets[i].clone().normalize(),points[i+1].clone().sub(points[i]).normalize());
    bones[i].quaternion.copy(previous.invert()).multiply(orientation);
    previous=orientation;
  }
}

export function equineGait(actor,base,tail,config){
  const rig=joint(base);rig.scale.set(1/config.slender,1,1/config.length);
  const legs=[];
  for(const side of [-1,1])for(const fore of [false,true])legs.push(makeLeg(actor,rig,side,fore,config));
  let phase=0,speed=0,turn=0,desiredSpeed=0,desiredTurn=0,cadence=0,moving=false,terrain;
  const duty=.68,isUnicorn=config.kind==='unicorn';
  const home=(leg,ahead=0)=>{
    const transient=(1-Math.exp(-6*ahead))/6;
    const travel=desiredSpeed*ahead+(speed-desiredSpeed)*transient;
    const heading=desiredTurn*ahead+(turn-desiredTurn)*transient;
    const yaw=actor.body.rotation.y+heading;
    const p=leg.home.clone();
    if(!ahead||!moving)p.z+=isUnicorn?leg.side*(leg.fore?.13:-.052):leg.side*(leg.fore?.035:-.025);
    p.applyAxisAngle(Y,yaw).add(actor.root.position);
    const midYaw=yaw-heading*.5;
    p.x+=travel*Math.sin(midYaw);p.z+=travel*Math.cos(midYaw);
    p.y=actor.origin.y+(terrain?.(p.x,p.z)||0);return p;
  };
  const lastOrigin=vec(Infinity,Infinity,Infinity);
  return {legs,advance(dt,action,context){
    terrain=context?.terrainHeight;
    if(!actor.origin.equals(lastOrigin)){
      lastOrigin.copy(actor.origin);legs.forEach(leg=>leg.initialized=false);
    }
    const walk=action==='Walk',pivot=action==='Turn';
    const blend=1-Math.exp(-dt*6);
    desiredSpeed=walk?(isUnicorn?.72:.66):0;
    speed+=(desiredSpeed-speed)*blend;
    desiredTurn=walk?.17:pivot?.42:0;
    turn+=(desiredTurn-turn)*blend;
    const yaw=actor.body.rotation.y+turn*dt*.5;
    actor.root.position.x+=speed*dt*Math.sin(yaw);actor.root.position.z+=speed*dt*Math.cos(yaw);
    actor.body.rotation.y+=turn*dt;
    actor.root.position.y=actor.origin.y+(terrain?.(actor.root.position.x,actor.root.position.z)||0);
    moving=walk||pivot||speed>.035||Math.abs(turn)>.035;
    cadence=.73+.19*speed;
    if(moving||legs.some(leg=>!leg.stance))phase+=cadence*dt;
  },animate(t,walk,tuck=0,graze=0){
    tail.rotation.z=.12*Math.sin(1.8*t);
    const effort=Math.min(1,speed/.68+Math.abs(turn)*.30);
    base.position.set(.014*effort*Math.sin(phase*2*Math.PI),
      -(isUnicorn?.028:.019)-.08*graze-.009*effort*Math.cos(phase*4*Math.PI),
      .078*graze);
    if(terrain){
      // Match the local support plane under the whole trunk. Rotating
      // about barrel height keeps its lateral projection above the feet.
      const normal=groundNormal(terrain,actor.root.position.x,actor.root.position.z)
        .applyAxisAngle(Y,-actor.body.rotation.y);
      base.quaternion.setFromUnitVectors(Y,normal);
      base.position.addScaledVector(Y,1.1).addScaledVector(normal,-1.1);
    }else base.quaternion.identity();
    for(const leg of legs){
      const cycle=(phase+leg.phase)%1;
      if(!leg.initialized){leg.anchor.copy(home(leg));leg.yaw=actor.body.rotation.y;leg.initialized=true}
      if(leg.stance&&moving&&cycle>=duty){
        leg.swingStart=cycle;leg.stance=false;leg.liftOff.copy(leg.anchor);leg.startYaw=leg.yaw;
        const ahead=(1-cycle+duty*.5)/cadence;
        leg.landing.copy(home(leg,ahead));leg.endYaw=actor.body.rotation.y+turn*ahead;
      }
      if(!leg.stance&&cycle<duty){
        leg.stance=true;leg.anchor.copy(leg.landing);leg.yaw=leg.endYaw;
      }
      leg.swing=0;
      if(leg.stance)leg.target.copy(leg.anchor);
      else{
        const u=(cycle-leg.swingStart)/(1-leg.swingStart),ease=u*u*u*(10+u*(-15+6*u));
        leg.swing=u;leg.target.lerpVectors(leg.liftOff,leg.landing,ease);
        leg.target.y+=(leg.fore?.139:.122)*Math.sin(Math.PI*u)**2;
        leg.yaw=T.MathUtils.lerp(leg.startYaw,leg.endYaw,ease);
      }
      leg.load=leg.stance?Math.sin(Math.PI*cycle/duty)**2:0;
    }
    if(terrain){
      const origin=actor.root.position,normal=Y.clone().applyQuaternion(base.quaternion).applyAxisAngle(Y,actor.body.rotation.y);
      let clearance=0;
      for(const leg of legs){
        const {x,z}=leg.target;
        const plane=origin.y-((x-origin.x)*normal.x+(z-origin.z)*normal.z)/normal.y;
        clearance=Math.min(clearance,actor.origin.y+terrain(x,z)-plane);
      }
      base.position.y+=clearance;
    }
    for(const leg of legs){
      poseLeg(leg,rig,terrain,leg.load);
    }
  }};
}
