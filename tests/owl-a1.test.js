import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from '../creature-lab/vendor/three.module.js';
import {Owl} from '../creature-lab/species/owl.js';

test('barn owl fits the perch, unfolds at adult scale and returns to contact at every LOD',()=>{
  const owl=new Owl(),size=()=>new Box3().setFromObject(owl.root,true).getSize(new Vector3());
  let time=0;
  const run=(name,context)=>{for(let i=0;i<180;i++)owl.update(1/60,time+=1/60,name,context)};
  try{
    for(let lod=0;lod<3;lod++){
      owl.setLOD(lod);run('Perch');
      assert.ok(size().x<.18&&size().y>.28&&size().y<.36);
      run('Look',{stimulus:new Vector3(.5,.30,.30)});
      assert.ok(owl.neck.rotation.y>0&&owl.atlas.rotation.y>0&&owl.head.rotation.y>0);
      run('Unfold');assert.ok(size().x>.88&&size().x<.97);
      run('Takeoff');assert.ok(owl.body.position.y>.28&&owl.root.position.length()>1);
      run('Bank');assert.ok(Math.abs(owl.bank)>.1);
      run('Land');assert.ok(owl.air<.001&&owl.open<.001&&Math.abs(owl.body.position.y)<.003);
      assert.ok(size().x<.18&&owl.root.position.distanceTo(owl.origin)<.001);
    }
  }finally{owl.dispose()}
});
