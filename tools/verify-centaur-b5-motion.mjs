// Focused rig regression, run with node tools/verify-centaur-b5-motion.mjs.
import assert from 'node:assert/strict';
import * as T from '../creature-lab/vendor/three.module.js';
import {Centaur} from '../creature-lab/species/centaur.js';

const dt=1/60;
const vector=()=>new T.Vector3();
const posePoint=(mesh,index)=>mesh.localToWorld(mesh.getVertexPosition(index,vector()));

function surfaceVolume(actor){
  let volume=0;
  for(const {mesh} of actor.parts){
    const attr=mesh.geometry.attributes.position,indices=mesh.geometry.index.array;
    const vertices=Array.from({length:attr.count},(_,i)=>posePoint(mesh,i));
    const cross=vector();
    for(let i=0;i<indices.length;i+=3){
      const [a,b,c]=[vertices[indices[i]],vertices[indices[i+1]],vertices[indices[i+2]]];
      volume+=a.dot(cross.crossVectors(b,c))/6;
    }
  }
  return Math.abs(volume);
}

for(const slope of [0,.045]){
  const actor=new Centaur();
  const terrainHeight=(x,z)=>slope*(z+.32*x);
  const context={terrainHeight};
  actor.update(0,0,'Idle',context);actor.root.updateMatrixWorld(true);
  const neutral=surfaceVolume(actor);
  let maxSlip=0,maxGroundError=0,maxBoneStretch=0,maxVolumeChange=0;
  let stopPosition;
  const planted=new Map(), lifted=new Set();
  for(let frame=1;frame<=540;frame++){
    const action=frame<=150?'Walk':frame<=295?'Turn':frame<=360?'Walk':'Stop';
    actor.update(dt,frame*dt,action,context);actor.root.updateMatrixWorld(true);
    for(const leg of actor.horse.legs){
      for(let i=0;i<4;i++){
        const length=leg.bones[i].getWorldPosition(vector()).distanceTo(leg.bones[i+1].getWorldPosition(vector()));
        maxBoneStretch=Math.max(maxBoneStretch,Math.abs(length-leg.lengths[i]));
      }
      if(!leg.stance){
        if(frame<=150 && leg.target.y-terrainHeight(leg.target.x,leg.target.z)>.07)lifted.add(leg);
        planted.delete(leg);continue;
      }
      const hoof=leg.hoofMesh,attr=hoof.geometry.attributes.position;
      const low=-leg.ref[4].y;
      const patch=[];
      for(let i=0;i<attr.count;i++)if(Math.abs(attr.getY(i)-low)<.00002){
        const p=posePoint(hoof,i);
        patch.push(p);
        maxGroundError=Math.max(maxGroundError,Math.abs(p.y-terrainHeight(p.x,p.z)));
      }
      assert.ok(patch.length>=3,'Missing hoof bearing rim');
      if(planted.has(leg))patch.forEach((p,i)=>{maxSlip=Math.max(maxSlip,p.distanceTo(planted.get(leg)[i]));});
      else planted.set(leg,patch);
    }
    if([62,91,184,281,394].includes(frame)){
      const change=Math.abs(surfaceVolume(actor)/neutral-1);
      maxVolumeChange=Math.max(maxVolumeChange,change);
    }
    if(frame===150){
      assert.ok(actor.root.position.z>1.4 && Math.abs(actor.body.rotation.y)<.001,'Walk must advance straight');
      assert.equal(lifted.size,4,'Every hoof must clear the ground during the walk');
    }
    if(frame===295)assert.ok(actor.body.rotation.y>1.2,'Turn must change the heading');
    if(frame===480)stopPosition=actor.root.position.clone();
  }
  console.log({slope,maxSlip,maxGroundError,maxBoneStretch,maxVolumeChange});
  assert.ok(maxSlip<.0002 && maxGroundError<.0002,'Stance contact error');
  assert.ok(maxBoneStretch<1e-5 && maxVolumeChange<.035,'Unstable limb length or surface volume');
  assert.ok(stopPosition.distanceTo(actor.root.position)<.0001 && actor.horse.legs.every(l=>l.stance),'Failed to settle');
  const idleBones=[actor.head,actor.arms[0].wrist,actor.arms[1].fingers];
  const initial=idleBones.map(b=>b.quaternion.clone()),excursion=idleBones.map(()=>0);
  const breath=actor.ribs.scale.z;
  let ribExcursion=0;
  for(let i=1;i<=240;i++){
    actor.update(dt,9+i*dt,'Idle',context);
    idleBones.forEach((b,j)=>{excursion[j]=Math.max(excursion[j],b.quaternion.angleTo(initial[j]));});
    ribExcursion=Math.max(ribExcursion,Math.abs(actor.ribs.scale.z-breath));
  }
  assert.ok(excursion.every(angle=>angle>.015) && ribExcursion>.01,'Idle head, wrists, fingers and ribs must move');
  for(const level of [1,2,0]){
    actor.setLOD(level);actor.update(dt,13+dt,'Idle',context);
    actor.root.updateMatrixWorld(true);
    const mesh=actor.parts[0].mesh;
    assert.equal(mesh.skeleton,actor.skeleton);
    assert.ok(Number.isFinite(mesh.getVertexPosition(0,vector()).length()));
  }
  actor.dispose();
}
