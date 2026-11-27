import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as T from '../creature-lab/vendor/three.module.js';
import {Centaur} from '../creature-lab/species/centaur.js';
import {ImportedCentaur} from '../creature-lab/species/centaur-import.js';
import {parseTexturedGLB} from '../creature-lab/species/textured-glb.js';

const glb=readFileSync(new URL('../creature-lab/species/static/centaur-meshy.glb',import.meta.url));
const asset=parseTexturedGLB(glb.buffer.slice(glb.byteOffset,glb.byteOffset+glb.byteLength));

test('centaur uses the submitted geometry and material maps',async()=>{
  assert.equal(createHash('sha256').update(glb).digest('hex'),'f0a28cfadff265fce14039c3733bb71fb4f78050e073ce31f089f8ac9c71eb29');
  assert.equal(asset.positions.length/3,65334);
  assert.equal(asset.indices.length/3,51861);
  for(const image of asset.images){
    assert.equal(image.type,'image/png');
    const header=new DataView(await image.slice(0,24).arrayBuffer());
    assert.equal(header.getUint32(16),4096);
    assert.equal(header.getUint32(20),4096);
  }
  const actor=new ImportedCentaur(asset),{geometry,material}=actor.model;
  assert.equal(geometry.index.array,asset.indices);
  assert.equal(geometry.attributes.uv.array,asset.uv);
  assert.equal(material.map.colorSpace,T.SRGBColorSpace);
  assert.equal(material.normalMap.colorSpace,T.NoColorSpace);
  assert.equal(material.metalnessMap,material.roughnessMap);
  assert.equal(material.side,T.DoubleSide);
  for(const lod of [1,2,0]){
    actor.setLOD(lod);
    assert.equal(actor.model.geometry,geometry);
  }
  actor.dispose();
});

test('centaur has normalized skin weights and all six gait actions',()=>{
  const actor=new ImportedCentaur(asset),baseline=new Centaur();
  assert.equal(baseline.horse.legs.length,4);
  const {position,skinWeight,skinIndex}=actor.model.geometry.attributes;
  const point=new T.Vector3();
  for(let i=0;i<position.count;i++){
    let total=0;
    for(let k=0;k<4;k++){
      const value=skinWeight.array[i*4+k];
      assert.ok(value>=0&&value<=1);
      assert.ok(skinIndex.array[i*4+k]<actor.bones.length);
      total+=value;
    }
    assert.ok(Math.abs(total-1)<1e-6);
  }
  let time=0;
  const strokes=new Set();
  for(const action of ['Idle','Walk','Trot','Gallop','Turn','Stop']){
    for(let frame=0;frame<120;frame++){
      actor.update(1/60,time+=1/60,action);
      if(actor.horse.legs.some(leg=>leg.swing>0))strokes.add(action);
      if(frame%30)continue;
      actor.root.updateMatrixWorld(true);
      for(const leg of actor.horse.legs){
        if(leg.stance)assert.ok(leg.sole.getWorldPosition(point).distanceTo(leg.target)<1e-5);
      }
      for(let i=0;i<position.count;i++){
        actor.model.applyBoneTransform(i,point.fromBufferAttribute(position,i));
        assert.ok(Number.isFinite(point.lengthSq())&&point.lengthSq()<12);
      }
    }
  }
  for(const action of ['Walk','Trot','Gallop','Turn'])assert.ok(strokes.has(action),action);
  actor.dispose();
  baseline.dispose();
});
