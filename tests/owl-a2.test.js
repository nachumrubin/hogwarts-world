import test from 'node:test';
import assert from 'node:assert/strict';
import {Owl} from '../creature-lab/species/owl.js';

test('perched toe transforms stay fixed through breathing, tracking, LOD changes and return to contact',()=>{
  const bird=new Owl();
  try{
    const skin=bird.parts.find(({mesh})=>mesh.isSkinnedMesh).mesh;
    const toes=skin.skeleton.bones.filter(b=>b.position.z>.009&&b.parent.parent!==bird.body);
    assert.ok(toes.length>=8);
    bird.root.updateMatrixWorld(true);
    const rest=toes.map(b=>b.matrixWorld.clone());
    let t=0;
    function advance(action,n){
      for(let i=0;i<n;i++)bird.update(1/60,t+=1/60,action);
      bird.root.updateMatrixWorld(true);
    }
    for(const lod of [0,1,2]){
      bird.setLOD(lod);
      for(const action of ['Perch','Look']){
        for(let frame=0;frame<90;frame++){
          advance(action,1);
          toes.forEach((b,i)=>assert.deepEqual(b.matrixWorld.elements,rest[i].elements));
        }
      }
      advance('Takeoff',150);
      assert.ok(toes.some((b,i)=>!b.matrixWorld.equals(rest[i])));
      advance('Land',210);
      toes.forEach((b,i)=>assert.deepEqual(b.matrixWorld.elements,rest[i].elements));
    }
  }finally{bird.dispose()}
});
