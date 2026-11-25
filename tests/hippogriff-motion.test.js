import test from 'node:test';
import assert from 'node:assert/strict';
import {Hippogriff, sequence} from '../creature-lab/species/hippogriff-motion.js';
import {V} from '../creature-lab/species/hippogriff-rig.js';

// Probe the rendered skin because a stationary IK target alone cannot
// detect accidental double translation of a hoof or talon in the Lab.
function soleProbe(actor,leg){
  const ankle=leg.points.at(-1);
  let result,lowest=Infinity;
  for(const {mesh} of actor.parts){
    if(mesh.name!=='leg'&&mesh.name!=='foot')continue;
    const position=mesh.geometry.attributes.position;
    for(let i=0;i<position.count;i++){
      const p=V().fromBufferAttribute(position,i);
      if(p.y>.035||p.x*ankle.x<0||p.z*ankle.z<0)continue;
      const score=p.y+.04*p.distanceTo(ankle);
      if(score<lowest){lowest=score;result={mesh,i};}
    }
  }
  assert.ok(result);
  return result;
}

test('C.4 skin stays planted and connected through the flight sequence',()=>{
  const actor=new Hippogriff();
  try{
    actor.setLOD(2);
    actor.prepare();
    const probes=actor.contacts.map(c=>soleProbe(actor,c.leg));
    const previous=[],states=new Set(),landingTimes=[];
    let suspensionFrames=0;const strideCrossings=[];
    const frames=Math.ceil(sequence.reduce((time,entry)=>time+entry[1],0)*60);
    for(let frame=0;frame<frames;frame++){
      const oldPhase=actor.phase;
      actor.update(1/60,frame/60,'Sequence',{studio:true});
      if(actor.state==='Gallop'){
        if(actor.contacts.every(c=>!c.stance))suspensionFrames++;
        if(Math.floor(oldPhase)!==Math.floor(actor.phase))strideCrossings.push(actor.root.position.z);
      }
      actor.root.updateMatrixWorld(true);
      states.add(actor.state);
      for(let k=0;k<4;k++){
        const c=actor.contacts[k],{mesh,i}=probes[k];
        const p=mesh.localToWorld(mesh.getVertexPosition(i,V()));
        if(c.stance&&previous[k])assert.ok(previous[k].distanceTo(p)<.0001,'stance slip in '+actor.state);
        if(actor.state==='Land'&&c.stance&&!previous[k])landingTimes[k]??=frame/60;
        previous[k]=c.stance?p:null;
        c.joints.slice(1).forEach((joint,j)=>{
          const length=c.leg.points[j+1].distanceTo(c.leg.points[j]);
          assert.ok(Math.abs(joint.distanceTo(c.joints[j])-length)<.025,'unreachable target in '+actor.state);
        });
      }
    }
    assert.deepEqual([...states],[...new Set(sequence.map(entry=>entry[0]))]);
    assert.ok(suspensionFrames>=10);
    assert.ok(strideCrossings.length>=3);
    const stride=strideCrossings.at(-1)-strideCrossings.at(-2);
    assert.ok(Math.abs(stride-4.15/1.65)<.08);
    assert.ok(Math.min(landingTimes[0],landingTimes[2])-Math.max(landingTimes[1],landingTimes[3])>.10);
    assert.equal(actor.open,0);
    assert.equal(actor.height,0);
  }finally{actor.dispose();}
});
