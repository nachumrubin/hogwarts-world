import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../creature-lab/vendor/three.module.js';
import {Merperson} from '../creature-lab/species/merperson.js';
import {ImportedMerperson,parseMerpersonGLB} from '../creature-lab/species/merperson-import.js';

const glb=readFileSync(new URL('../creature-lab/species/static/merperson-meshy.glb',import.meta.url));
const asset=parseMerpersonGLB(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength));

test('Meshy asset retains the submitted triangle stream and all three maps',()=>{
  assert.equal(createHash('sha256').update(glb).digest('hex'),'4a508918b566db4521b106428fcdc721f28eabe7c189a1342b83f99d9d2b1dbf');
  assert.equal(asset.positions.length/3,2240);
  assert.equal(asset.indices.length/3,2657);
  assert.deepEqual(asset.images.map(image=>image.type),['image/jpeg','image/png','image/png']);
  const actor=new ImportedMerperson(asset);
  const {geometry,material}=actor.model;
  assert.equal(material.map.colorSpace,T.SRGBColorSpace);
  assert.equal(material.normalMap.colorSpace,T.NoColorSpace);
  assert.equal(material.metalnessMap,material.roughnessMap);
  assert.equal(material.side,T.DoubleSide);
  assert.equal(geometry.attributes.position.array,asset.positions);
  assert.equal(geometry.index.array,asset.indices);
  for(const level of [1,2,0]){
    actor.setLOD(level);
    assert.equal(actor.model.geometry,geometry);
  }
  actor.dispose();
});

test('converted skin stays finite and uses the baseline swim trajectory in all seven actions',()=>{
  const actor=new ImportedMerperson(asset),baseline=new Merperson();
  const second=new ImportedMerperson(asset);
  const {geometry,skeleton}=actor.model;
  assert.notEqual(second.model.skeleton,skeleton);
  const position=geometry.attributes.position,weights=geometry.attributes.skinWeight,ids=geometry.attributes.skinIndex;
  for(let vertex=0;vertex<position.count;vertex++){
    let total=0;
    for(let i=0;i<4;i++){
      const weight=weights.array[vertex*4+i];
      assert.ok(weight>=0&&weight<=1);
      assert.ok(ids.array[vertex*4+i]<skeleton.bones.length);
      total+=weight;
    }
    assert.ok(Math.abs(total-1)<1e-6);
  }
  const point=new T.Vector3(),start=actor.stations.at(-1).bone.position.clone();
  let time=0,tailMotion=0;
  for(const action of ['Idle','Cruise','Swim','Turn','TurnRight','Glide','Brake']){
    for(let tick=0;tick<90;tick++){
      time+=1/60;
      actor.update(1/60,time,action);
      baseline.update(1/60,time,action);
      assert.deepEqual(actor.root.position.toArray(),baseline.root.position.toArray());
      assert.deepEqual(actor.body.quaternion.toArray(),baseline.body.quaternion.toArray());
      tailMotion=Math.max(tailMotion,start.distanceTo(actor.stations.at(-1).bone.position));
    }
    actor.root.updateMatrixWorld(true);
    for(let vertex=0;vertex<position.count;vertex++){
      actor.model.applyBoneTransform(vertex,point.fromBufferAttribute(position,vertex));
      assert.ok(Number.isFinite(point.lengthSq())&&point.lengthSq()<2);
    }
  }
  assert.ok(tailMotion>.15);
  for(const specimen of [actor,baseline,second])specimen.dispose();
});
