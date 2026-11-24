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
const hindProfile=[
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

function poseLeg(leg,rig,terrain,weight,checkReach=false){
  const {fore,ref,offsets,lengths,bones}=leg;
  const swing=Math.sin(Math.PI*leg.swing);
  const sole=rig.worldToLocal(leg.target.clone());
  const worldFoot=new T.Quaternion().setFromAxisAngle(Y,leg.yaw);
  if(terrain)worldFoot.premultiply(new T.Quaternion().setFromUnitVectors(Y,groundNormal(terrain,leg.target.x,leg.target.z)));
  worldFoot.multiply(new T.Quaternion().setFromAxisAngle(vec(1,0,0),-(.17+(leg.fold??0)*.45)*swing*swing));
  const foot=rig.getWorldQuaternion(new T.Quaternion()).invert().multiply(worldFoot);
  const coronet=sole.sub(leg.sole.position.clone().applyQuaternion(foot));
  const root=leg.mobileOrigin ? bones[0].position.clone() : ref[0].clone();
  const down=vec(coronet.x-root.x,coronet.y-root.y,0).normalize();
  const direction=angle=>down.clone().multiplyScalar(Math.cos(angle)).addScaledVector(Z,Math.sin(angle));
  const pasternAngle=(leg.pasternAngle ?? (fore?.60:.64))+weight*(leg.pasternYield??.075)-.10*swing;
  const fetlock=coronet.clone().addScaledVector(direction(pasternAngle),-lengths[3]);
  const delta=fetlock.clone().sub(root),distance=delta.length();
  const axis=Math.atan2(delta.z,delta.dot(down));
  const [a,b,c]=lengths;
  const flex=(leg.carpalFlex ?? .055)+ (1.16+(leg.fold??0)*.58)*swing*swing;
  const distal=fore?Math.sqrt(b*b+c*c+2*b*c*Math.cos(flex)):b+c;
  if(checkReach)return Math.max(0,distance-a-distal);
  let upperAngle,lowerAngle;
  if(fore){
    // In stance the radius and cannon form a nearly straight column.
    // Flexing the carpus in swing shortens their combined effective link.
    const opening=Math.acos(T.MathUtils.clamp((a*a+distance*distance-distal*distal)/(2*a*distance),-1,1));
    upperAngle=axis-opening;
    const remaining=delta.clone().addScaledVector(direction(upperAngle),-a);
    lowerAngle=Math.atan2(remaining.z,remaining.dot(down))+Math.atan2(c*Math.sin(flex),b+c*Math.cos(flex));
  }else{
    // The reciprocal apparatus couples stifle and hock flexion. Solve
    // the coupled chain's reach, keeping each rigid lever at bind length.
    const ratio=leg.hockRatio ?? .68;
    let low=0,high=2.85;
    for(let i=0;i<45;i++){
      const k=(low+high)*.5;
      const reach2=a*a+b*b+c*c+2*(a*b*Math.cos(k)+b*c*Math.cos(ratio*k)+a*c*Math.cos((1-ratio)*k));
      if(reach2>distance*distance)low=k;else high=k;
    }
    const k=(low+high)*.5;
    upperAngle=axis-Math.atan2(-b*Math.sin(k)-c*Math.sin((1-ratio)*k),
      a+b*Math.cos(k)+c*Math.cos((1-ratio)*k));
    lowerAngle=upperAngle-k;
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
  return equineContacts(actor,base,tail,rig,legs,config);
}

// The production centaur supplies its own bind skeleton to the same world-space
// planting, swing prediction, terrain alignment and fixed-length IK as the lab rig.
export function equineContacts(actor,base,tail,rig,legs,config){
  const fitted=Boolean(config.fitted);
  let phase=0,speed=0,turn=0,desiredSpeed=0,desiredTurn=0,cadence=0,moving=false,terrain;
  // Unwrapped phase offsets in LH, LF, RH, RF order. Crossing zero means
  // touchdown. Interpolate the offsets without resetting a planted foot.
  const trotOffsets=[0,.5,.5,0],gallopOffsets=[0,.60,.87,.46];
  let gaitLevel=0,run=0,gallop=0,duty=.68,lift=0,flightTime=0,launchHeight=0;
  const isUnicorn=config.kind==='unicorn';
  const support={fore:0,hind:0,pitch:0,roll:0,brake:0,drive:0,push:0,gather:0,impact:0,acceleration:0,run:0,gallop:0};
  let stopping=false, speedRate=6, stepSeconds=0;
  const home=(leg,ahead=0)=>{
    const transient=(1-Math.exp(-speedRate*ahead))/speedRate;
    const travel=desiredSpeed*ahead+(speed-desiredSpeed)*transient;
    const heading=desiredTurn*ahead+(turn-desiredTurn)*(1-Math.exp(-6*ahead))/6;
    // Project the foot's own lateral offset around the predicted heading.
    // With forward travel through the turn this makes the outer arc longer.
    const yaw=actor.body.rotation.y+heading;
    const p=leg.home.clone();
    if(ahead>0)p.z+=gallop*(leg.fore?.063:.041);
    if(!fitted&&(!ahead||!moving))p.z+=isUnicorn?leg.side*(leg.fore?.13:-.052):leg.side*(leg.fore?.035:-.025);
    p.applyAxisAngle(Y,yaw).add(actor.root.position);
    const midYaw=yaw-heading*.5;
    p.x+=travel*Math.sin(midYaw);p.z+=travel*Math.cos(midYaw);
    p.y=actor.origin.y+(terrain?.(p.x,p.z)||0);return p;
  };
  const lastOrigin=vec(Infinity,Infinity,Infinity);
  return {legs,support,get phase(){return phase},get speed(){return speed},get turn(){return turn},advance(dt,action,context){
    terrain=context?.terrainHeight;
    if(!actor.origin.equals(lastOrigin)){
      lastOrigin.copy(actor.origin);legs.forEach(leg=>leg.initialized=false);
    }
    const walk=action==='Walk',pivot=action==='Turn';
    const requested=fitted?(action==='Gallop'?2:action==='Trot'?1:0):0;
    gaitLevel+=T.MathUtils.clamp(requested-gaitLevel,-.62*dt,.94*dt);
    run=T.MathUtils.smoothstep(gaitLevel,0,1);gallop=T.MathUtils.smoothstep(gaitLevel,1,2);
    support.run=run;support.gallop=gallop;
    duty=.68-.295*run-.115*gallop;
    const blend=1-Math.exp(-dt*6);
    stopping=fitted&&!walk&&!pivot&&!requested;
    speedRate=stopping?2.8:6;
    desiredSpeed=walk?(isUnicorn?.72:.66):(fitted&&pivot?.39:0);
    if(requested||(!stopping&&gaitLevel>0))desiredSpeed=.66+1.28*run+1.58*gallop;
    const previousSpeed=speed;
    speed+=(desiredSpeed-speed)*(stopping?1-Math.exp(-dt*speedRate):blend);
    if(stopping && speed<.005)speed=0;
    if(fitted && dt>0){
      support.acceleration+=((speed-previousSpeed)/dt-support.acceleration)*(1-Math.exp(-dt*6));
      const deceleration=Math.max(0,(previousSpeed-speed)/dt);
      support.brake+=(Math.min(1,deceleration)-support.brake)*(1-Math.exp(-dt*5));
    }
    desiredTurn=walk?(fitted?0:.17):pivot?(fitted?.60:.42):0;
    turn+=(desiredTurn-turn)*blend;
    const yaw=actor.body.rotation.y+turn*dt*.5;
    actor.root.position.x+=speed*dt*Math.sin(yaw);actor.root.position.z+=speed*dt*Math.cos(yaw);
    actor.body.rotation.y+=turn*dt;
    actor.root.position.y=actor.origin.y+(terrain?.(actor.root.position.x,actor.root.position.z)||0);
    moving=walk||pivot||requested>0||speed>.035||Math.abs(turn)>.035;
    cadence=.73+.19*(fitted?Math.min(.66,speed):speed)+.43*run+.24*gallop;
    stepSeconds=dt;
    if(moving||legs.some(leg=>!leg.stance))phase+=cadence*dt;
  },animate(t,walk,tuck=0,graze=0){
    if(!fitted)tail.rotation.z=.12*Math.sin(1.8*t);
    const effort=Math.min(1,speed/.68+Math.abs(turn)*.30);
    base.position.set((fitted?0:.014)*effort*Math.sin(phase*2*Math.PI),
      -(isUnicorn?.028:fitted?.008:.019)-.08*graze-(fitted?0:.009)*effort*Math.cos(phase*4*Math.PI),
      .078*graze);
    if(terrain){
      // Match the local support plane under the whole trunk. Rotating
      // about barrel height keeps its lateral projection above the feet.
      const normal=groundNormal(terrain,actor.root.position.x,actor.root.position.z)
        .applyAxisAngle(Y,-actor.body.rotation.y);
      base.quaternion.setFromUnitVectors(Y,normal);
      base.position.addScaledVector(Y,1.1).addScaledVector(normal,-1.1);
    }else base.quaternion.identity();

    for(const [index,leg] of legs.entries()){
      const offset=leg.phase+(trotOffsets[index]-leg.phase)*run+(gallopOffsets[index]-trotOffsets[index])*gallop;
      const cycle=fitted?(phase+offset+2)%1:(phase+leg.phase)%1;
      const strike=fitted?cycle<(leg.previousCycle??0)-.5:cycle<duty;
      leg.previousCycle=cycle;
      if(fitted)leg.fold=run*.48+gallop*.52;
      if(!leg.initialized){leg.anchor.copy(home(leg));leg.yaw=actor.body.rotation.y;leg.initialized=true;leg.stance=true;leg.finalStep=false}
      // At a halt, gather one displaced hoof at a time after forward travel ends.
      const gather=stopping && speed<.035 && leg.anchor.distanceTo(home(leg))>.048;
      const finalStep=gather && legs.every(other=>other.stance);
      const heading=actor.body.rotation.y;
      const trailing=leg.home.z-((leg.anchor.x-actor.root.position.x)*Math.sin(heading)
        +(leg.anchor.z-actor.root.position.z)*Math.cos(heading));
      const release=run>0&&cycle>.12&&trailing>.38;
      if(leg.stance&&((moving&&(cycle>=duty||release))||finalStep)){
        leg.swingStart=cycle;leg.finalStep=finalStep;leg.finalProgress=0;
        leg.stance=false;leg.liftOff.copy(leg.anchor);leg.startYaw=leg.yaw;
        if(fitted)(leg.relativeLift??=vec()).copy(leg.anchor).sub(actor.root.position);
        const ahead=(1-cycle+duty*.5)/cadence;
        leg.landing.copy(home(leg,finalStep?0:ahead));leg.endYaw=actor.body.rotation.y+turn*(finalStep?0:ahead);
        leg.stepHeight=fitted?T.MathUtils.clamp(leg.liftOff.distanceTo(leg.landing)*.17,.018,.105):(leg.fore?.139:.122);
      }
      if(!leg.stance&&!leg.finalStep&&run>0&&cycle>=leg.swingStart){
        // During a gait change the projected strike moves with cadence and speed.
        // Fade replanning out before touchdown, leaving a fixed world target.
        const progress=(cycle-leg.swingStart)/(1-leg.swingStart);
        const ahead=(1-cycle+duty*.5)/cadence;
        leg.landing.lerp(home(leg,ahead),(1-T.MathUtils.smoothstep(progress,.3,.8))*(1-Math.exp(-stepSeconds*14)));
      }
      if(!leg.stance&&leg.finalStep)leg.finalProgress+=stepSeconds/.33;
      if(!leg.stance&&(leg.finalStep?leg.finalProgress>=1:strike)){
        leg.stance=true;leg.anchor.copy(leg.landing);leg.yaw=leg.endYaw;
      }
      leg.swing=0;
      if(leg.stance){
        if(fitted)leg.anchor.y=actor.origin.y+(terrain?.(leg.anchor.x,leg.anchor.z)||0);
        leg.target.copy(leg.anchor);
      }
      else{
        const u=leg.finalStep?leg.finalProgress:T.MathUtils.clamp((cycle-leg.swingStart)/(1-leg.swingStart),0,1),ease=u*u*u*(10+u*(-15+6*u));
        leg.swing=u;leg.target.lerpVectors(leg.liftOff,leg.landing,ease);
        if(run>0&&!leg.finalStep){
          // Interpolate a swing relative to the advancing hip. A changing
          // beat interval must not leave the airborne foot behind the horse.
          const sweep=leg.relativeLift.clone().add(actor.root.position)
            .lerp(home(leg,duty*.5/cadence),ease);
          const swingSeconds=(1-leg.swingStart)/cadence;
          // The trailing hind stays extended through release, then folds under
          // the flank. The forearm folds earlier and opens towards its strike.
          const strideWindow=Math.sin(Math.PI*u)**2;
          const sweepBias=leg.fore?.24*(2*u-1):.15*Math.sin(2*Math.PI*(u-.34));
          const tangent=-speed*swingSeconds*u*(1-u)*(1-2*u)+gallop*strideWindow*sweepBias;
          sweep.z+=Math.cos(actor.body.rotation.y)*tangent;
          sweep.x+=Math.sin(actor.body.rotation.y)*tangent;
          leg.target.x=T.MathUtils.lerp(leg.target.x,sweep.x,run);
          leg.target.z=T.MathUtils.lerp(leg.target.z,sweep.z,run);
          if(u>.70)leg.landing.lerp(home(leg,(1-cycle+duty*.5)/cadence),run);
        }
        const tuck=run*(leg.fore?.087:.075)+gallop*(leg.fore?.15:.14);
        const liftPhase=u+gallop*(leg.fore?.13:-.115)*Math.sin(Math.PI*u);
        leg.target.y+=(leg.stepHeight+tuck)*Math.sin(Math.PI*liftPhase)**2;
        leg.yaw=T.MathUtils.lerp(leg.startYaw,leg.endYaw,ease);
      }
      leg.load=leg.stance?Math.sin(Math.PI*cycle/duty)**2:0;
      if(fitted){
        // Accept weight quickly, support the barrel through midstance, then
        // unload the pastern progressively as the other limbs take the load.
        const stanceTime=cycle/duty;
        const carried=T.MathUtils.smoothstep(stanceTime,0,.26)*(1-T.MathUtils.smoothstep(stanceTime,.59,1));
        leg.load=leg.stance?carried:0;
      }
    }
    if(fitted){
      // Walking horses show a stride-frequency pelvic roll and separate withers
      // and pelvic excursions. See the circular-walk measurements in PMID 37127806.
      const [lh,lf,rh,rf]=legs;
      support.fore=rf.load-lf.load;
      support.hind=rh.load-lh.load;
      const foreLoad=lf.load+rf.load,hindLoad=lh.load+rh.load,total=foreLoad+hindLoad;
      const response=1-Math.exp(-stepSeconds*15);
      support.drive+=(hindLoad-support.drive)*response;
      support.impact+=(foreLoad-support.impact)*response;
      // Measure the sagittal span of the moving feet in the travel frame.
      // Its shortening flexes the loin before the hinds accept weight.
      const forward=vec(Math.sin(actor.body.rotation.y),0,Math.cos(actor.body.rotation.y));
      const span=(lf.target.dot(forward)+rf.target.dot(forward)-lh.target.dot(forward)-rh.target.dot(forward))*.5;
      const restSpan=(lf.home.z+rf.home.z-lh.home.z-rh.home.z)*.5;
      support.gather+=(T.MathUtils.clamp((restSpan-span)/.46,-1,1)-support.gather)*response;
      const hipZ=actor.root.position.dot(forward);
      const push=[lh,rh].reduce((sum,leg)=>sum+leg.load*
        T.MathUtils.smoothstep(hipZ+leg.home.z-leg.target.dot(forward),-.10,.22),0);
      support.push+=(push-support.push)*response;
      // Loaded limbs shorten in midstance and extend into takeoff. Between
      // the last release and next predicted strike, follow a ballistic arc.
      if(legs.some(l=>l.stance)){
        flightTime=0;
        const compressed=-.044*Math.min(1.65,total)+.010*(support.drive-support.impact);
        lift+=(compressed-lift)*(1-Math.exp(-stepSeconds*21));
      }else{
        if(!flightTime)launchHeight=lift;
        flightTime+=stepSeconds;
        const remaining=Math.min(...legs.map(l=>(1-l.swing)*(1-l.swingStart)/cadence));
        lift=launchHeight*remaining/(flightTime+remaining||1)+.5*9.81*flightTime*remaining;
      }
      base.position.y+=run*lift+effort*.010*(total-1.8)*(1-run);
      support.roll=effort*(.022*support.hind+.013*support.fore);
      support.pitch=effort*.018*(lf.load+rf.load-lh.load-rh.load)+.018*support.brake
        +gallop*(.115*support.impact-.077*support.drive-.085*support.push);
      base.position.z-=support.pitch*1.07;
      base.position.z+=gallop*(.033*support.push-.021*support.impact);
      // Translate about the ribcage height when rolling, keeping the trunk
      // over its support polygon instead of swinging from a ground-level pivot.
      base.position.x+=1.0*support.roll+.009*effort*(support.fore+support.hind);
      base.rotateZ(support.roll);base.rotateX(support.pitch);
      for(const leg of legs){
        const root=leg.bones[0].position.copy(leg.ref[0]);
        const reach=rig.worldToLocal(leg.target.clone()).z-leg.ref[0].z;
        leg.mobileOrigin=true;
        root.z+=effort*T.MathUtils.clamp(reach,-.55,.55)*(leg.fore?.115:.073);
        root.y+=effort*(leg.fore?.012:.010)*(leg.load-.35);
        root.z+=gallop*T.MathUtils.clamp(reach,-.52,.52)*(leg.fore?.092:.047);
        root.y+=gallop*(leg.fore?.020*leg.load:-.018*support.gather+.019*support.push);
      }
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
    if(fitted){
      // A transition may leave the previous stance foot farther behind the
      // hip than the steady-state stride. Yield at the trunk until every IK
      // target is reachable. The sole and rigid lever lengths stay fixed.
      for(let pass=0;pass<3;pass++){
        const excess=Math.max(...legs.map(leg=>poseLeg(leg,rig,terrain,leg.load,true)));
        if(excess<.000001)break;
        base.position.y-=1.28*excess;
      }
    }
    for(const leg of legs){
      poseLeg(leg,rig,terrain,leg.load);
    }
  }};
}
