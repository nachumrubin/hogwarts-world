import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3} from '../creature-lab/vendor/three.module.js';
import {Merperson} from '../creature-lab/species/merperson.js';
import {catalog} from '../creature-lab/species/catalog.js';
import {Aragog} from '../creature-lab/aragog.js';
import {Squid} from '../creature-lab/squid.js';

function verifySkin(actor) {
  const {geometry,skeleton}=actor.skin;
  const {position,skinIndex,skinWeight}=geometry.attributes;
  for(let i=0;i<position.count;i++) {
    const total=skinWeight.getX(i)+skinWeight.getY(i)+skinWeight.getZ(i)+skinWeight.getW(i);
    assert.ok(Math.abs(total-1)<1e-6);
    for(let c=0;c<4;c++) {
      assert.ok(skinIndex.array[i*4+c]<skeleton.bones.length);
      assert.ok(skinWeight.array[i*4+c]>=0);
    }
  }
  const edges=new Map();
  const indices=geometry.index.array;
  for(let i=0;i<indices.length;i+=3) {
    for(let j=0;j<3;j++) {
      const a=indices[i+j],b=indices[i+(j+1)%3];
      assert.notEqual(a,b);
      const key=Math.min(a,b)*position.count+Math.max(a,b);
      const direction=a<b?1:-1;
      const history=edges.get(key)||0;
      assert.notEqual(history,2,'More than two skin faces share this edge');
      assert.notEqual(history,direction,'Skin faces share an edge with the same winding');
      edges.set(key,history===0?direction:2);
    }
  }
  assert.ok(Array.from(edges.values()).every(value=>value===2),'The trunk and arm joins are closed');
}

test('Merperson geometry is deterministic, closed at the shoulders, and reduced across its LODs',()=>{
  const actor=new Merperson(),copy=new Merperson();
  let previous=Infinity;
  try {
    for(const level of [0,1,2]) {
      actor.setLOD(level);
      copy.setLOD(level);
      verifySkin(actor);
      let count=0;
      for(const [i,{mesh}] of actor.parts.entries()) {
        const other=copy.parts[i].mesh;
        const g=mesh.geometry;
        count+=mesh.visible?g.index.count/3:0;
        for(const [key,attribute] of Object.entries(g.attributes)) {
          assert.ok(attribute.array.every(Number.isFinite));
          assert.deepEqual(attribute.array,other.geometry.attributes[key].array);
        }
        assert.deepEqual(g.index.array,other.geometry.index.array);
      }
      assert.ok(count<previous);
      previous=count;
    }
  } finally {
    actor.dispose();
    copy.dispose();
  }
});

test('The continuous tail preserves its curved length and transverse sections at every LOD',()=>{
  const actor=new Merperson(),dt=1/60,pos=new Vector3(),other=new Vector3();
  try {
    const bindCenters=actor.tail.centers.map(p=>p.clone());
    let excursion=0;
    for(let frame=0;frame<200;frame++) {
      actor.update(dt,frame*dt,'Swim');
      excursion=Math.max(excursion,Math.abs(actor.tail.centers.at(-1).y-bindCenters.at(-1).y));
      for(let i=1;i<bindCenters.length;i++) {
        const expected=bindCenters[i].distanceTo(bindCenters[i-1]);
        const actual=actor.tail.centers[i].distanceTo(actor.tail.centers[i-1]);
        assert.ok(Math.abs(actual-expected)<1e-10);
      }
      if(frame%30!==0) continue;
      const caudal=actor.caudal.position.toArray();
      const boneTransforms=actor.skin.skeleton.bones.map(b=>b.quaternion.toArray());
      actor.setLOD((actor.level+1)%3);
      assert.deepEqual(actor.caudal.position.toArray(),caudal);
      assert.deepEqual(actor.skin.skeleton.bones.map(b=>b.quaternion.toArray()),boneTransforms);
      const g=actor.skin.geometry, sections=new Map();
      for(const [i,z] of g.userData.tailStations.entries()) {
        if(z>=0) continue;
        if(!sections.has(z)) sections.set(z,i);
        const a=sections.get(z);
        const current=g.attributes.position, rest=g.attributes.merpersonRest;
        const span=pos.fromBufferAttribute(current,a).distanceTo(other.fromBufferAttribute(current,i));
        const original=pos.fromBufferAttribute(rest,a).distanceTo(other.fromBufferAttribute(rest,i));
        assert.ok(Math.abs(span-original)<1e-6);
      }
    }
    assert.ok(excursion>.38,'The moving tail should depart substantially from its neutral pose');
  } finally {
    actor.dispose();
  }
});

test('Swim states change speed and steering continuously and articulate the hands',()=>{
  const actor=new Merperson();
  try {
    let frame=0;
    const advance=(action,seconds)=>{
      const ending=frame+Math.round(60*seconds);
      const last=actor.root.position.clone();
      for(;frame<ending;frame++) {
        actor.update(1/60,frame/60,action);
        assert.ok(last.distanceTo(actor.root.position)<.038);
        last.copy(actor.root.position);
      }
    };
    const {motion,arms}=actor;
    advance('Idle',.8);
    assert.ok(actor.root.position.length()<1e-10);
    const hoveringWrist=arms[0].wrist.quaternion.clone();
    advance('Cruise',2);
    const cruising=motion.speed;
    assert.ok(.55<cruising && cruising<.9);
    advance('Swim',1.6);
    assert.ok(motion.speed>cruising+.65);
    const fastest=motion.speed, cruisingFinger=arms[0].digits[1][1].rotation.x;
    advance('Glide',1);
    assert.ok(motion.speed<fastest && motion.speed>fastest*.55);
    assert.ok(motion.stroke<.05);
    const heading=motion.heading;
    advance('Turn',1.25);
    assert.ok(motion.heading>heading+.5);
    const leftHeading=motion.heading;
    advance('TurnRight',1.55);
    assert.ok(motion.heading<leftHeading-.55);
    assert.ok(!arms[0].wrist.quaternion.equals(hoveringWrist));
    advance('Swim',1.3);
    advance('Brake',.25);
    assert.ok(motion.brake>.4);
    assert.ok(arms[0].digits[1][1].rotation.x<cruisingFinger-.08);
    advance('Brake',1.55);
    advance('Idle',1.3);
    assert.ok(motion.speed<.002);
    assert.ok(motion.hover>.9);
    actor.root.updateMatrixWorld(true);
    for(const {handMesh} of arms) {
      const vertex=new Vector3();
      for(let i=0;i<handMesh.geometry.attributes.position.count;i+=5) {
        handMesh.getVertexPosition(i,vertex);
        assert.ok(vertex.toArray().every(Number.isFinite));
      }
    }
  } finally {
    actor.dispose();
  }
});

test('All seven Lab creatures construct, update and switch detail levels',()=>{
  const entries=[
    [Squid,'Rest'],[Aragog,'Idle'],
    ...Object.values(catalog).map(entry=>[entry.model,Object.keys(entry.actions)[0]])
  ];
  assert.equal(entries.length,7);
  for(const [Model,action] of entries) {
    const actor=new Model();
    try {
      actor.setLOD(1);
      actor.update(1/60,1/60,action);
      actor.setLOD(2);
      actor.update(1/60,2/60,action);
      actor.root.updateMatrixWorld(true);
      assert.ok(actor.root.matrixWorld.elements.every(Number.isFinite));
    } finally {
      actor.dispose();
    }
  }
});
