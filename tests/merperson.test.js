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

test('Swimming eases through action changes and keeps the same pose when LOD changes',()=>{
  const actor=new Merperson(),dt=1/60,pos=new Vector3();
  const distal=new Vector3(),previous=new Vector3();
  let maxStep=0,locomotionDistance=0,lastPhase=actor.phase;
  try {
    for(let frame=0;frame<420;frame++) {
      const action=frame<60?'Idle':frame<180?'Swim':frame<310?'Turn':'Idle';
      actor.update(dt,frame*dt,action);
      actor.root.updateMatrixWorld(true);
      actor.caudal.getWorldPosition(distal);
      if(frame>0) maxStep=Math.max(maxStep,previous.distanceTo(distal));
      previous.copy(distal);
      assert.ok((actor.phase-lastPhase+Math.PI*2)%(Math.PI*2)<.10);
      lastPhase=actor.phase;
      if(frame===179) locomotionDistance=actor.root.position.length();
      if(frame%30===0) {
        const boneTransforms=actor.skin.skeleton.bones.map(b=>b.matrixWorld.toArray());
        const geometry=actor.skin.geometry;
        actor.setLOD((actor.level+1)%3);
        assert.notEqual(actor.skin.geometry,geometry);
        actor.root.updateMatrixWorld(true);
        assert.deepEqual(actor.skin.skeleton.bones.map(b=>b.matrixWorld.toArray()),boneTransforms);
        const count=actor.skin.geometry.attributes.position.count;
        for(let vertex=0;vertex<count;vertex+=13) {
          actor.skin.getVertexPosition(vertex,pos);
          assert.ok(pos.toArray().every(Number.isFinite));
        }
      }
    }
    assert.ok(locomotionDistance>1.4,'The swimming cycle produces forward motion');
    assert.ok(actor.heading>1,'The turning action changes heading');
    assert.ok(maxStep<.12,'The caudal attachment moves continuously through action changes');
    assert.ok(actor.drive<.01,'The merperson settles on returning to Idle');
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
