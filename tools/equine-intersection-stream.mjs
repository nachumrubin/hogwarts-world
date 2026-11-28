// Send deformed model-space triangles to the Blender overlap test.
import {once} from 'node:events';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [lab,kind]=process.argv.slice(2);
const load=path=>import(pathToFileURL(resolve(lab,path)).href);
const {catalog}=await load('species/catalog.js');
const {Vector3}=await load('vendor/three.module.js');
const actor=new catalog[kind].model();
const parts=actor.parts.map(p=>p.mesh);
const torso=parts[0];
const groups=[{name:'body',mesh:torso}];
const hoofColor=kind==='unicorn'?0x665d54:undefined;
const skins=parts.filter(m=>m.isSkinnedMesh && m!==torso);
if(skins.length!==4)throw Error('Expected four independently skinned limbs');
skins.forEach((mesh,i)=>{
  const sole=parts[parts.indexOf(mesh)+1];
  if(sole.isSkinnedMesh || (hoofColor && sole.material.color.getHex()!==hoofColor))
    throw Error('Unexpected hoof mesh');
  groups.push({name:'leg'+i,mesh},{name:'hoof'+i,mesh:sole});
});
if(kind==='unicorn')groups.push({name:'muzzle',mesh:parts.find(m=>m.material.color.getHex()===0xb5a89b)});
const topology=groups.map(({name,mesh})=>{
  const pos=mesh.geometry.attributes.position,faces=Array.from(mesh.geometry.index.array);
  let distalFaces=[];
  if(name.startsWith('leg')){
    const heights=Array.from({length:pos.count},(_,i)=>pos.getY(i));
    const limit=Math.min(...heights)+.70;
    for(let i=0;i<faces.length;i+=3){
      const f=faces.slice(i,i+3);
      if(f.every(v=>heights[v]<limit))distalFaces.push(f);
    }
  }
  return {name,vertices:pos.count,faces,distalFaces};
});
console.log(JSON.stringify(topology));
let t=0;
const v=new Vector3();
for(let frame=0;frame<=480;frame++){
  const action=frame<180?'Walk':frame<300?(kind==='unicorn'?'Graze':'Turn'):frame<370?'Idle':'Walk';
  const dt=(frame<75?1:frame<140?1.7:frame<180?.55:1)/60;
  actor.update(dt,t+=dt,action);
  actor.root.updateMatrixWorld(true);
  for(const {mesh} of groups){
    const data=new Float32Array(mesh.geometry.attributes.position.count*3);
    for(let i=0;i<data.length/3;i++){
      mesh.localToWorld(mesh.getVertexPosition(i,v)).toArray(data,3*i);
    }
    if(!process.stdout.write(Buffer.from(data.buffer)))await once(process.stdout,'drain');
  }
}
