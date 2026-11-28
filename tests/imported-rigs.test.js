import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Box3} from '../creature-lab/vendor/three.module.js';
import {parseTexturedGLB} from '../creature-lab/species/textured-glb.js';
import {ImportedOwl} from '../creature-lab/species/owl-import.js';
import {ImportedUnicorn} from '../creature-lab/species/unicorn-import.js';

function asset(name){
  const bytes=readFileSync(new URL('../creature-lab/species/static/'+name,import.meta.url));
  return parseTexturedGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}

function advance(actor,action){
  for(let i=0;i<300;i++)actor.update(1/60,i/60,action,{terrainHeight:()=>0});
  actor.root.updateMatrixWorld(true);
}

test('grazing at a translated origin keeps the imported mesh on the original skeleton',()=>{
  const source=asset('white_unicorn_meshy_ai.glb');
  const unicorn=new ImportedUnicorn(source);
  unicorn.setPosition(new Vector3(12,0,-9));
  advance(unicorn,'Graze');
  const mesh=unicorn.importedMesh,g=mesh.geometry;
  for(const bone of mesh.skeleton.bones){
    assert.ok(unicorn.root.getObjectById(bone.id),'bone detached from original hierarchy');
  }
  const points=Array.from({length:g.attributes.position.count},(_,i)=>mesh.getVertexPosition(i,new Vector3()));
  const a=new Vector3(),b=new Vector3();
  // Compare with the supplied GLB itself. A uniformly weighted but already
  // twisted muzzle in the bind mesh must also fail this check.
  const skull=[];
  for(let i=0;i<points.length;i++){
    const x=source.positions[3*i],y=source.positions[3*i+1],z=source.positions[3*i+2];
    if(y>.47&&x<-.40)skull.push(i);
  }
  assert.ok(skull.length>1000);
  for(let i=0;i<skull.length;i+=17){
    const j=skull[i],k=skull[(i+701)%skull.length];
    const authored=a.fromArray(source.positions,3*j).distanceTo(b.fromArray(source.positions,3*k));
    assert.ok(Math.abs(points[j].distanceTo(points[k])-1.58*authored)<.0003,
      'skull or horn changed shape during grazing');
  }
  let maxStretch=0;
  for(let i=0;i<g.index.count;i+=3)for(let k=0;k<3;k++){
    const j=g.index.array[i+k],l=g.index.array[i+(k+1)%3];
    a.fromBufferAttribute(g.attributes.position,j);b.fromBufferAttribute(g.attributes.position,l);
    maxStretch=Math.max(maxStretch,points[j].distanceTo(points[l])-a.distanceTo(b));
  }
  assert.ok(maxStretch<.15,'grazing edge stretched by '+maxStretch+' metres');
  unicorn.dispose();
});

test('unfold uses the original feather joints and their open-wing morphs',()=>{
  const owl=new ImportedOwl(asset('Barn_Owl_50k_Poly_meshy_ai.glb'));
  advance(owl,'Unfold');
  assert.equal(owl.flightFeathers.length,6);
  const box=new Box3(),v=new Vector3();
  for(const feather of owl.flightFeathers){
    assert.ok(feather.visible);
    for(let i=0;i<feather.geometry.attributes.position.count;i++)
      box.expandByPoint(feather.getVertexPosition(i,v).applyMatrix4(feather.matrixWorld));
  }
  assert.ok(box.min.x<-.4&&box.max.x>.4);
  advance(owl,'Fold');
  assert.ok(owl.flightFeathers.every(feather=>feather.visible&&feather.morphTargetInfluences[0]>.99));
  assert.equal(owl.importedMesh.parent,owl.head);
  owl.dispose();
});
