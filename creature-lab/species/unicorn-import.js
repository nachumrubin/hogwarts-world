import * as T from '../vendor/three.module.js';
import {unzlibSync} from '../vendor/fflate.js';
import * as binding from './unicorn-binding.js';
import {Unicorn} from './unicorn.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadUnicornAsset(){
  const url=typeof UNICORN_EMBEDDED_GLB==='string'?UNICORN_EMBEDDED_GLB:
    new URL('./static/white_unicorn_meshy_ai.glb',typeof UNICORN_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  return loadTexturedGLB(url);
}

function decode(text,Type){
  const bytes=unzlibSync(Uint8Array.from(atob(text),char=>char.charCodeAt(0)));
  return new Type(bytes.buffer,bytes.byteOffset,bytes.byteLength/Type.BYTES_PER_ELEMENT);
}
let fitted;
function surface(asset){
  if(!fitted){
    const lookup=decode(binding.vertex,Uint16Array),position=decode(binding.position,Int16Array);
    const ids=decode(binding.joint,Uint8Array),weights=decode(binding.weight,Uint16Array);
    const xyz=new Float32Array(3*lookup.length),joint=new Uint8Array(4*lookup.length);
    const weight=new Float32Array(4*lookup.length);
    lookup.forEach((v,i)=>{
      for(let k=0;k<3;k++)xyz[3*i+k]=position[3*v+k]/8192;
      for(let k=0;k<4;k++){joint[4*i+k]=ids[4*v+k];weight[4*i+k]=weights[4*v+k]/65535}
    });
    const corrections=[binding.halfGraze,binding.fullGraze].map(encoded=>{
      const values=decode(encoded,Int16Array),delta=new Float32Array(xyz.length);
      lookup.forEach((v,i)=>{for(let k=0;k<3;k++)delta[3*i+k]=values[3*v+k]/8192});
      return delta;
    });
    fitted={xyz,joint,weight,corrections,normal:decode(binding.normal,Int8Array)};
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.BufferAttribute(fitted.xyz,3));
  g.setAttribute('skinIndex',new T.BufferAttribute(fitted.joint,4));
  g.setAttribute('skinWeight',new T.BufferAttribute(fitted.weight,4));
  g.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
  g.setIndex(new T.BufferAttribute(asset.indices,1));
  g.setAttribute('normal',new T.BufferAttribute(fitted.normal,3,true));
  g.morphTargetsRelative=true;
  g.morphAttributes.position=fitted.corrections.map(delta=>new T.BufferAttribute(delta,3));
  return g;
}

export class ImportedUnicorn extends Unicorn {
  constructor(asset){
    super();
    for(const {mesh} of this.parts)mesh.visible=false;
    const geometry=surface(asset);
    const {material,textures}=texturedMaterial(asset);
    this.textures=textures;
    this.materials.set('Meshy unicorn',material);
    const mesh=new T.SkinnedMesh(geometry,material);
    mesh.name='Meshy unicorn';
    mesh.frustumCulled=false;
    this.body.add(mesh);
    this.root.updateMatrixWorld(true);
    const bones=[...this.cervical.bones,this.head,...this.horse.legs.flatMap(leg=>leg.bones),this.horse.tail];
    mesh.bind(new T.Skeleton(bones));
    this.importedMesh=mesh;
    this.parts.push({mesh,levels:[geometry]});
  }

  setLOD(level){this.level=level}
  update(dt,time,action,context){
    super.update(dt,time,action,context);
    const progress=this.graze*2;
    this.importedMesh.morphTargetInfluences[0]=1-Math.abs(1-progress);
    this.importedMesh.morphTargetInfluences[1]=Math.max(0,progress-1);
  }
  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
