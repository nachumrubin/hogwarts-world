import * as T from '../vendor/three.module.js';
import {unzlibSync} from '../vendor/fflate.js';
import {Owl} from './owl.js';
import {pigment} from './owl-binding.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadOwlAsset(){
  const url=typeof OWL_EMBEDDED_GLB==='string'?OWL_EMBEDDED_GLB:
    new URL('./static/Barn_Owl_50k_Poly_meshy_ai.glb',typeof OWL_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  return loadTexturedGLB(url);
}

// Isolate the facial disc, crown and ruff. The lowest retained strip turns
// inwards under the breast plumage, so head rotation never opens the collar.
function facialDisc(asset){
  const position=[],normal=[],uv=[],indices=[],mapped=new Map();
  function vertex(id){
    if(mapped.has(id))return mapped.get(id);
    const k=3*id,y=asset.positions[k+1],t=T.MathUtils.smoothstep(y,.20,.37);
    const index=position.length/3;
    mapped.set(id,index);
    const x=(asset.positions[k]-.44)*.20,z=(asset.positions[k+2]-.065)*.20;
    const collarRadius=.033+.11*T.MathUtils.smoothstep(y,.31,.52);
    const width=Math.min(1,collarRadius/Math.max(.0001,Math.hypot(x,z)))*t;
    position.push(x*width,(y-.63)*.20,z*width);
    normal.push(...asset.normals.subarray(k,k+3));
    uv.push(...asset.uv.subarray(2*id,2*id+2));
    return index;
  }
  for(let i=0;i<asset.indices.length;i+=3){
    const a=asset.indices[i],b=asset.indices[i+1],c=asset.indices[i+2];
    if(Math.max(...[a,b,c].map(j=>asset.positions[3*j+1]))<=.20)continue;
    indices.push(vertex(a),vertex(b),vertex(c));
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(position,3));
  geometry.setAttribute('normal',new T.Float32BufferAttribute(normal,3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);
  return geometry;
}

let colors;
function transferPigment(surfaces){
  colors??=unzlibSync(Uint8Array.from(atob(pigment),c=>c.charCodeAt(0)));
  const color=new T.Color();
  let offset=0;
  for(const mesh of surfaces){
    const count=mesh.geometry.attributes.position.count,linear=new Float32Array(3*count);
    for(let i=0;i<count;i++,offset+=3){
      color.setRGB(colors[offset]/255,colors[offset+1]/255,colors[offset+2]/255,T.SRGBColorSpace);
      // Let the original vane atlas provide the feather bars and fine relief.
      color.multiplyScalar(.65).addScalar(.35).toArray(linear,3*i);
    }
    mesh.geometry.setAttribute('color',new T.BufferAttribute(linear,3));
    mesh.material.vertexColors=true;
  }
  if(offset!==colors.length)throw Error('Barn owl rig no longer matches its baked plumage.');
}

export class ImportedOwl extends Owl {
  constructor(asset){
    super();
    this.head.traverse(child=>{if(child.isMesh)child.visible=false});
    const {material,textures}=texturedMaterial(asset);
    this.textures=textures;
    this.materials.set('Meshy facial disc',material);
    const geometry=facialDisc(asset),face=new T.Mesh(geometry,material);
    face.name='Meshy barn owl facial disc';
    this.head.add(face);
    this.importedMesh=face;
    this.parts.push({mesh:face,levels:[geometry]});
    this.flightFeathers=this.wings.flatMap(wing=>wing.joints.flatMap(j=>j.children.filter(c=>c.isMesh)));
    transferPigment([this.breast,...this.flightFeathers]);
  }
  setLOD(level){this.level=level}
  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
