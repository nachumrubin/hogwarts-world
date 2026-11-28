// Geometry stream consumed by check-hippogriff-fold.py under Blender.
import {once} from 'node:events';
import {Hippogriff} from '../creature-lab/species/hippogriff.js';
import {Vector3} from '../creature-lab/vendor/three.module.js';

const actor=new Hippogriff();
actor.setLOD(Number(process.argv[2]));
const meshes=actor.parts.map(part=>part.mesh);
const wingCounts=new Map([[0x898b80,7],[0x686c69,9],[0x8c8d83,9],[0x505658,10],[0x727570,10]]);
const fans=meshes.filter(mesh=>mesh.morphTargetInfluences).slice(-wingCounts.size);
const collar=meshes.filter(mesh=>mesh.parent===actor.neck);
const selected=[meshes.find(mesh=>mesh.isSkinnedMesh),...collar,...fans];
const groups=[];
for(const mesh of selected){
  const wing=fans.includes(mesh);
  const count=wing?wingCounts.get(mesh.material.color.getHex()):1;
  const index=mesh.geometry.index.array;
  const vertices=mesh.geometry.attributes.position.count/count;
  for(let i=0;i<count;i++){
    const indices=Array.from(index.slice(i*index.length/count,(i+1)*index.length/count),value=>value-i*vertices);
    groups.push({wing,vertices,indices});
  }
}
process.stdout.write(JSON.stringify(groups)+'\n');
const point=new Vector3();
for(let frame=0;frame<482;frame++){
  if(frame<=120)actor.wings.forEach(pose=>pose(frame/120,.36));
  else{
    const t=frame-121,actions=['Unfold','Idle','Flap','Fly','Idle'];
    actor.update(1/24,t/24,actions[Math.floor(t/75)]);
  }
  actor.root.updateMatrixWorld(true);
  for(const mesh of selected){
    const positions=new Float32Array(mesh.geometry.attributes.position.count*3);
    for(let i=0;i<positions.length/3;i++){
      mesh.localToWorld(mesh.getVertexPosition(i,point)).toArray(positions,i*3);
    }
    if(!process.stdout.write(Buffer.from(positions.buffer)))await once(process.stdout,'drain');
  }
}
