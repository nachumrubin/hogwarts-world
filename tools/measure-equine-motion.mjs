// node tools/measure-equine-motion.mjs <before creature-lab> <after creature-lab> <report.json>
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const [before,after,output]=process.argv.slice(2);
if(!output)throw Error('Supply before and after creature-lab directories and an output JSON file.');
const fixedStep=1/60;
const rounded=n=>Number(n.toFixed(8));
const range=()=>({min:Infinity,max:-Infinity});
function observe(r,value){r.min=Math.min(r.min,value);r.max=Math.max(r.max,value)}
const limits=r=>({min:rounded(r.min),max:rounded(r.max)});
const load=(dir,file)=>import(pathToFileURL(join(resolve(dir),file)).href);

async function audit(dir){
  const T=await load(dir,'vendor/three.module.js');
  const {Unicorn}=await load(dir,'species/unicorn.js');
  const {Centaur}=await load(dir,'species/centaur.js');
  const v=()=>new T.Vector3();
  const point=(mesh,index)=>mesh.localToWorld(mesh.getVertexPosition(index,v()));

  function neck(){
    function ring(mesh,i,sides){
      const pts=Array.from({length:sides},(_,j)=>point(mesh,i*sides+j));
      const area=v();
      for(let j=1;j<sides-1;j++)area.add(v().crossVectors(pts[j].clone().sub(pts[0]),pts[j+1].clone().sub(pts[0])));
      const centre=pts.reduce((sum,pt)=>sum.add(pt),v()).divideScalar(sides);
      return {area:area.length()/2,centre};
    }
    const results=[];
    for(let lod=0;lod<3;lod++){
      const actor=new Unicorn();
      actor.setLOD(lod);
      const mesh=actor.parts[0].mesh;
      const muzzle=actor.parts.find(({mesh})=>mesh.material.color.getHex()===0xb5a89b).mesh;
      const mane=actor.parts.map(part=>part.mesh).filter(part=>{
        if(part.material.color.getHex()!==0xaba392)return false;
        // The tail uses the same colour. Its attachment is behind the croup.
        return part.parent.getWorldPosition(v()).z>0;
      });
      if(mane.length!==9)throw Error('Expected nine mane locks');
      actor.update(0,0,'Idle');actor.root.updateMatrixWorld(true);
      const sides=[28,16,10][lod],steps=[3,2,1][lod];
      const first=6*steps,last=mesh.geometry.attributes.position.count/sides-1;
      const series=[];
      let preceding=null;
      for(let i=first;i<=last;i++){
        const {area,centre}=ring(mesh,i,sides);
        series.push({ring:i,designStation:i/steps,neutral:area,percent:range(),
          neutralSpacing:preceding?centre.distanceTo(preceding):null,spacingPercent:range(),half:null,low:null});
        preceding=centre;
      }
      // A lock's first section is its root. Track the same closest triangle
      // and barycentric material point for every frame of the trial.
      const locks=lod===0?mane.map(m=>{
        const root=()=>{const p=v();for(let j=0;j<20;j++)p.add(point(m,j));return p.multiplyScalar(1/20)};
        const p=root(),idx=mesh.geometry.index.array;
        let best=Infinity,match;
        for(let i=0;i<idx.length;i+=3){
          const ids=[idx[i],idx[i+1],idx[i+2]];
          const tri=new T.Triangle(...ids.map(j=>point(mesh,j)));
          const q=tri.closestPointToPoint(p,v()),d=q.distanceTo(p);
          if(d<best){best=d;match={ids,weights:tri.getBarycoord(q,v()).toArray()}}
        }
        return {root,match,neutralSeparation:best,separation:range()};
      }):[];
      let closestHalf=Infinity,lastLow=0;
      const muzzleAtHold=range();
      for(let frame=0;frame<=540;frame++){
        const t=frame*fixedStep,action=frame>60&&frame<=300?'Graze':'Idle';
        actor.update(frame?fixedStep:0,t,action);actor.root.updateMatrixWorld(true);
        const g=actor.graze,half=action==='Graze'&&Math.abs(g-.5)<closestHalf;
        if(half)closestHalf=Math.abs(g-.5);
        if(action==='Graze')lastLow=g;
        let previousCentre=null;
        for(const s of series){
          const {area,centre}=ring(mesh,s.ring,sides),pct=100*(area/s.neutral-1);
          if(previousCentre)observe(s.spacingPercent,100*(centre.distanceTo(previousCentre)/s.neutralSpacing-1));
          previousCentre=centre;
          observe(s.percent,pct);
          if(half)s.half=area;if(frame===300)s.low=area;
        }
        for(const lock of locks){
          const at=v();
          lock.match.ids.forEach((id,j)=>at.addScaledVector(point(mesh,id),lock.match.weights[j]));
          observe(lock.separation,at.distanceTo(lock.root()));
        }
        if(frame>=241&&frame<=300){
          let h=Infinity;for(let i=0;i<muzzle.geometry.attributes.position.count;i++)h=Math.min(h,point(muzzle,i).y);
          observe(muzzleAtHold,h);
        }
      }
      results.push({lod,frames:541,halfBlendError:rounded(closestHalf),fullBlend:rounded(lastLow),
        muzzleClearanceAtHoldM:limits(muzzleAtHold),
        stations:series.map(s=>({ring:s.ring,designStation:rounded(s.designStation),neutralAreaM2:rounded(s.neutral),
          halfPercent:rounded(100*(s.half/s.neutral-1)),fullPercent:rounded(100*(s.low/s.neutral-1)),
          allFramePercent:limits(s.percent),
          ...(s.neutralSpacing!==null?{neutralPrecedingRingDistanceM:rounded(s.neutralSpacing),
            precedingRingDistancePercent:limits(s.spacingPercent)}:{})})),
        ...(locks.length?{maneRoots:locks.map((l,i)=>({lock:i,neutralGapM:rounded(l.neutralSeparation),gapM:limits(l.separation)}))}:{})
      });
      actor.dispose();
    }
    return results;
  }
  function extractLegs(a){
    if(a.horse.legs)return a.horse.legs.map(l=>({side:l.side,fore:l.fore,hoof:l.hoofMesh,sole:l.sole,
      planted:()=>l.stance,joints:l.fore?['shoulder','elbow','carpus','fetlock','hoof'].map(k=>l.joints[k]):['hip','stifle','hock','fetlock','hoof'].map(k=>l.joints[k])}));
    // The Stage 1B chain ends at the cannon and carries the hoof rigidly.
    // Its fetlock and coronet are mesh landmarks, not extra revolute joints.
    return a.parts.filter(p=>p.mesh.isSkinnedMesh).slice(1).map(p=>{
      const m=p.mesh,fore=m.position.z>0,side=Math.sign(m.position.x),[,upper,lower,cannon]=m.skeleton.bones;
      const hoof=cannon.children.find(n=>n.isMesh);
      const marker=(y,z)=>{const n=new T.Object3D();n.position.set(0,y,z);cannon.add(n);return n};
      const phase=(fore?.24:0)+(side>0?.5:0);
      return {side,fore,hoof,sole:marker(-.665,.14),joints:[upper,lower,cannon,marker(-.456,.042),marker(-.55,.105)],
        planted:(t,action)=>action!=='Walk'&&action!=='Turn'||(t*.8+phase)%1<.62};
    });
  }
  function locomotion(Model,species,trial='walk'){
    const grazeOnly=trial==='graze';
    const a=new Model();a.update(0,0,'Idle');a.root.updateMatrixWorld(true);
    const legs=extractLegs(a).map(l=>{
      const n=l.hoof.geometry.attributes.position.count,verts=Array.from({length:n},(_,i)=>point(l.hoof,i));
      // Pick the bottom face in the neutral, world-space mesh.
      const min=Math.min(...verts.map(p=>p.y));
      const ids=verts.flatMap((p,i)=>p.y<min+.00015?[i]:[]);
      if(ids.length<3)throw Error('Could not identify a planar sole patch');
      return {...l,ids,stanceEvents:0,stanceFrames:0,maxPatchDrift:0,maxCenterDrift:0,maxStanceFloorError:0,
        maxSoleFrameStep:0,peakSegmentStep:0,segments:Array.from({length:4},range),
        offsets:[range(),range()],inversionCounts:[0,0],samples:0};
    });
    let t=0;const cycle=[];
    for(let frame=0;frame<=600;frame++){
      const tick=frame/60;
      const speed=grazeOnly?1:tick<2?1:tick<4?.45:tick<6?1.8:tick<8?.7:1;
      const dt=frame?fixedStep*speed:0;t+=dt;
      const action=trial==='walkToGraze'?(tick<2?'Walk':tick<7?'Graze':'Walk'):grazeOnly?(frame>60&&frame<=360?'Graze':'Idle'):
        frame===0||tick>=9?'Idle':species==='centaur'&&tick>=5&&tick<7?'Turn':'Walk';
      a.update(dt,t,action);a.root.updateMatrixWorld(true);
      for(const leg of legs){
        const p=leg.joints.map(n=>n.getWorldPosition(v())),pose=p.map(w=>a.body.worldToLocal(w.clone()));
        const lens=p.slice(1).map((v,i)=>v.distanceTo(p[i]));
        lens.forEach((n,i)=>{
          observe(leg.segments[i],n);
          if(leg.lastLengths)leg.peakSegmentStep=Math.max(leg.peakSegmentStep,Math.abs(n-leg.lastLengths[i]));
        }); leg.lastLengths=lens;
        for(let j=1;j<=2;j++){
          const A=pose[j-1],B=pose[j],C=pose[j+1],dy=C.y-A.y,dz=C.z-A.z;
          // Signed anterior offset from the neighbouring pivots' line.
          const offset=((B.z-A.z)*(-dy)+(B.y-A.y)*dz)/Math.hypot(dy,dz);
          observe(leg.offsets[j-1],offset);
          const expected=(leg.fore?-1:1)*(j===1?1:-1);
          if(expected*offset<-.005)leg.inversionCounts[j-1]++;
        }
        leg.samples++;
        const patch=leg.ids.map(i=>point(leg.hoof,i));
        const center=patch.reduce((c,p)=>c.add(p),v()).divideScalar(patch.length);
        if(leg.lastCenter)leg.maxSoleFrameStep=Math.max(leg.maxSoleFrameStep,center.distanceTo(leg.lastCenter));
        leg.lastCenter=center;
        if(leg.planted(t,action)){
          leg.stanceFrames++;
          if(!leg.patch){leg.stanceEvents++;leg.patch=patch;leg.contact=center}
          leg.maxCenterDrift=Math.max(leg.maxCenterDrift,center.distanceTo(leg.contact));
          for(let j=0;j<patch.length;j++){
            leg.maxPatchDrift=Math.max(leg.maxPatchDrift,patch[j].distanceTo(leg.patch[j]));
            leg.maxStanceFloorError=Math.max(leg.maxStanceFloorError,Math.abs(patch[j].y));
          }
        }else{leg.patch=null}
      }
      if(frame%60===0)cycle.push({wallSeconds:tick,simSeconds:rounded(t),action,speed,root:a.root.position.toArray().map(rounded),yaw:rounded(a.body.rotation.y)});
    }
    const result={frames:601,sequence:cycle,legs:legs.map(l=>({
      side:l.side,limb:l.fore?'fore':'hind',soleVertices:l.ids.length,stanceFrames:l.stanceFrames,stanceEvents:l.stanceEvents,
      stanceCenterDriftM:rounded(l.maxCenterDrift),stanceVertexDriftM:rounded(l.maxPatchDrift),
      maxStanceFloorErrorM:rounded(l.maxStanceFloorError),maxSoleStepM:rounded(l.maxSoleFrameStep),
      segmentWorldLengthsM:l.segments.map(limits),maxInterframeSegmentLengthChangeM:rounded(l.peakSegmentStep),
      sagittalPivotOffsetsM:l.offsets.map(limits),invertedPivotFrameCounts:l.inversionCounts
    }))};
    a.dispose();return result;
  }
  async function habitatTrails(Model,species){
    const {createHabitat}=await load(dir,'habitats.js');
    const habitat=createHabitat(new T.Scene(),species),ground=habitat.terrainHeight;
    // Ray-test the two indexed triangles of the occupied terrain cell.
    // This independently checks the contact sampler against displayed faces.
    const terrain=habitat.group.children.find(m=>m.geometry?.type==='PlaneGeometry'&&m.geometry.parameters.width===100);
    const {width,height,widthSegments:w,heightSegments:h}=terrain.geometry.parameters;
    const positions=terrain.geometry.attributes.position,indices=terrain.geometry.index;
    const ray=new T.Ray(v(),new T.Vector3(0,-1,0)),out=v(),tri=[v(),v(),v()];
    function rendered(x,z){
      const col=Math.min(w-1,Math.floor((x/width+.5)*w)),row=Math.min(h-1,Math.floor((z/height+.5)*h));
      ray.origin.set(x,100,z);
      // Vertices are stored as float32; near a grid edge use adjacent
      // faces if the ideal cell differs by one ULP from its mesh extent.
      for(const offset of [0,-1,1,-w,w]){
        const start=6*(row*w+col+offset);
        for(let face=0;face<2;face++){
          tri.forEach((p,j)=>p.fromBufferAttribute(positions,indices.getX(start+face*3+j)));
          if(ray.intersectTriangle(tri[0],tri[1],tri[2],false,out))return out.y;
        }
      }
      throw Error('No visible ground triangle at the sampled contact');
    }
    const runs=[];
    for(const walkSeconds of [0,5,10,15,20,25,30]){
      const a=new Model(),t0=walkSeconds*60,holdAction=species==='unicorn'?'Graze':'Idle';
      const context={terrainHeight:ground,obstacles:habitat.obstacles,habitatRadius:3};
      a.update(0,0,'Idle',context);a.root.updateMatrixWorld(true);
      const legs=extractLegs(a);
      const muzzle=species==='unicorn'?a.parts.find(({mesh})=>mesh.material.color.getHex()===0xb5a89b).mesh:null;
      const muzzleAPI=range(),muzzleRendered=range();
      const totals={walk:{frames:0,slip:0,apiGap:range(),renderGap:range(),edgeGap:range()},
        hold:{frames:0,slip:0,apiGap:range(),renderGap:range(),edgeGap:range()}};
      for(const leg of legs){
        const vertices=Array.from({length:leg.hoof.geometry.attributes.position.count},(_,i)=>point(leg.hoof,i));
        const low=Math.min(...vertices.map(v=>v.y));
        leg.ids=vertices.flatMap((v,i)=>v.y<=low+.00015?[i]:[]);
      }
      for(let frame=0;frame<=t0+300;frame++){
        const action=frame===0?'Idle':frame<=t0?'Walk':holdAction,t=frame/60;
        a.update(frame?fixedStep:0,t,action,context);a.root.updateMatrixWorld(true);
        const total=totals[frame<=t0?'walk':'hold'];total.frames++;
        for(const leg of legs){
          if(!leg.planted(t,action)){leg.ref=null;continue}
          const pts=leg.ids.map(i=>point(leg.hoof,i)),centre=v();
          if(!leg.ref)leg.ref=pts;
          pts.forEach((p,j)=>{
            total.slip=Math.max(total.slip,p.distanceTo(leg.ref[j]));
            observe(total.edgeGap,p.y-rendered(p.x,p.z));
            centre.add(p);
          });
          centre.divideScalar(pts.length);
          observe(total.apiGap,centre.y-ground(centre.x,centre.z));
          observe(total.renderGap,centre.y-rendered(centre.x,centre.z));
        }
        if(muzzle&&frame>t0+240){
          let apiGap=Infinity,renderGap=Infinity;
          for(let i=0;i<muzzle.geometry.attributes.position.count;i++){
            const p=point(muzzle,i);
            apiGap=Math.min(apiGap,p.y-ground(p.x,p.z));renderGap=Math.min(renderGap,p.y-rendered(p.x,p.z));
          }
          observe(muzzleAPI,apiGap);observe(muzzleRendered,renderGap);
        }
      }
      const stats=key=>({frames:totals[key].frames,maxStanceVertexDriftM:rounded(totals[key].slip),
        soleCentreClearanceAPIM:limits(totals[key].apiGap),soleCentreClearanceRenderedM:limits(totals[key].renderGap),soleVertexClearanceRenderedM:limits(totals[key].edgeGap)});
      runs.push({walkSeconds,holdAction,finalPositionM:a.root.position.toArray().map(rounded),
        walk:stats('walk'),hold:stats('hold'),
        ...(muzzle?{settledMuzzleClearanceAPIM:limits(muzzleAPI),settledMuzzleClearanceRenderedM:limits(muzzleRendered)}:{})});
      a.dispose();
    }
    habitat.dispose();return runs;
  }
  const fingerprint=createHash('sha256');
  const habitatSha256=createHash('sha256').update(await readFile(join(resolve(dir),'habitats.js'))).digest('hex');
  const speciesDir=join(resolve(dir),'species');
  for(const name of (await readdir(speciesDir)).filter(name=>name.endsWith('.js')).sort()){
    fingerprint.update(name+'\0');fingerprint.update(await readFile(join(speciesDir,name)));
  }
  return {speciesSourceSha256:fingerprint.digest('hex'),habitatSha256,habitat:{centaur:await habitatTrails(Centaur,'centaur'),unicorn:await habitatTrails(Unicorn,'unicorn')},neck:neck(),centaur:locomotion(Centaur,'centaur'),unicorn:locomotion(Unicorn,'unicorn'),grazing:locomotion(Unicorn,'unicorn','graze'),walkToGraze:locomotion(Unicorn,'unicorn','walkToGraze')};
}

const report={method:{
 neck:'World-space area of corresponding deformed material rings (polygon vector area) on the continuous torso, sampled from withers to poll. Standing 1 s, grazing 4 s, return 4 s at 60 Hz. Half = closest rising graze blend to 0.5. Range covers every frame. Unit m². Preceding-ring spacing uses world-space centroid distance divided by the same station pair’s neutral distance.',
 mane:'Distance of each clay lock root centroid to its neutral nearest surface material point, carried by the same triangle and barycentric coordinates, LOD 0. Values include neutral embed depth.',
 gait:'Ten wall-clock seconds at 60 Hz, flat floor, LOD 0. Walk with 1×, 0.45×, 1.8×, 0.7× and 1× simulation rate; includes curved walking and centaur Turn. Stop at second 9. Graze trial from rest, hold and return. Additional walk-to-graze-to-walk trial changes actions at wall seconds 2 and 7. Each stance begins at the first supported frame, ends on swing. Compare every neutral sole-patch vertex against its position at touchdown. Includes action changes.',
 habitat:'Each animal starts at the real habitat origin for seven independent 60 Hz trials. Walk for the indicated duration then graze (unicorn) or stand (centaur) for five seconds. Stance drift follows every sole vertex; clearances sample the sole centre against both the live terrainHeight function and the piecewise planar rendered ground. Muzzle clearance is the lowest vertex relative to terrain beneath that vertex in the final second.',
 pivots:'Fore chain shoulder/elbow/carpus/fetlock/hoof. Hind chain hip/stifle/hock/fetlock/hoof. Positive offset is anterior in the body sagittal plane. Inversion counts use 5 mm allowance; elbow/hock expected posterior, carpus/stifle anterior. Stage 1B fetlock and hoof are landmarks on one rigid cannon. Distances are evaluated after world scaling, including previous anisotropic body scaling.'
},before:await audit(before),after:await audit(after)};
await writeFile(output,JSON.stringify(report,null,2)+'\n');
