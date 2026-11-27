import * as T from '../vendor/three.module.js';
import {Merperson} from './merperson.js';
import {tailCenterline} from './merperson-anatomy.js';

// The pinned Meshy export is a single indexed primitive with embedded maps.
export function parseMerpersonGLB(bytes) {
  const header=new DataView(bytes);
  const jsonLength=header.getUint32(12,true);
  const start=28+jsonLength;
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||
     header.getUint32(8,true)!==bytes.byteLength||header.getUint32(16,true)!==0x4e4f534a||
     header.getUint32(start-4,true)!==0x004e4942) throw Error('Invalid merperson GLB');
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));
  const primitive=gltf.meshes[0].primitives[0];
  const view=id=>{
    const {byteOffset=0,byteLength}=gltf.bufferViews[id];
    return new Uint8Array(bytes,start+byteOffset,byteLength);
  };
  function attribute(id,Type,components,componentType) {
    const {bufferView,byteOffset=0,count,componentType:actual}=gltf.accessors[id];
    if(actual!==componentType||gltf.bufferViews[bufferView].byteStride) throw Error('Unexpected merperson accessor layout');
    return new Type(bytes,view(bufferView).byteOffset+byteOffset,count*components).slice();
  }
  const {POSITION,NORMAL,TEXCOORD_0}=primitive.attributes;
  const material=gltf.materials[primitive.material];
  const image=info=>{
    const {bufferView,mimeType}=gltf.images[gltf.textures[info.index].source];
    return new Blob([view(bufferView)],{type:mimeType});
  };
  const pbr=material.pbrMetallicRoughness;
  return {
    positions:attribute(POSITION,Float32Array,3,5126),
    normals:attribute(NORMAL,Float32Array,3,5126),
    uv:attribute(TEXCOORD_0,Float32Array,2,5126),
    indices:attribute(primitive.indices,Uint32Array,1,5125),
    material,
    images:[image(pbr.baseColorTexture),image(pbr.metallicRoughnessTexture),image(material.normalTexture)]
  };
}

export async function loadMerpersonAsset() {
  const url=typeof MERPERSON_EMBEDDED_GLB==='string'?MERPERSON_EMBEDDED_GLB:
    new URL('./static/merperson-meshy.glb',typeof MERPERSON_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  const response=await fetch(url);
  if(!response.ok) throw Error('Unable to load the merperson model');
  const asset=parseMerpersonGLB(await response.arrayBuffer());
  asset.images=await Promise.all(asset.images.map(async blob=>{
    const url=URL.createObjectURL(blob);
    try {
      const image=new Image();
      image.src=url;
      await image.decode();
      return image;
    } finally {URL.revokeObjectURL(url)}
  }));
  return asset;
}

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const scale=2.8/.951172;
const waist=.075;
const neck=.345;
const tailStations=12;
const toVertical=new T.Quaternion().setFromAxisAngle(V(1,0,0),-Math.PI/2);
const fromVertical=toVertical.clone().invert();
const {lerp,smoothstep,clamp}=T.MathUtils;
const armMotion=[.65,.55,.38];
const shoulder=[.057,.294,.004];
const elbow=[.075,.195,.004];
const wrist=[.107,.099,.021];

function forearmVertices({positions,indices}) {
  // Weld identical positions for the flood only. The render mesh retains
  // every original UV and normal seam.
  const vertices=new Map(),keys=[];
  for(let i=0;i<positions.length;i+=3){
    const point=positions.subarray(i,i+3),key=point.join(',');
    if(!vertices.has(key))vertices.set(key,{point,neighbors:new Set()});
    keys.push(vertices.get(key));
  }
  for(let i=0;i<indices.length;i+=3){
    const triangle=[keys[indices[i]],keys[indices[i+1]],keys[indices[i+2]]];
    for(let j=0;j<3;j++){
      const a=triangle[j],b=triangle[(j+1)%3];
      a.neighbors.add(b);b.neighbors.add(a);
    }
  }
  const arm=new Set();
  for(const side of [-1,1]){
    const eligible=({point:[x,y]})=>x*side>lerp(.055,.045,smoothstep(y,.168,.200))&&y>.008&&y<.245;
    let seed,distance=Infinity;
    for(const vertex of vertices.values()){
      if(!eligible(vertex))continue;
      const [x,y,z]=vertex.point;
      const error=(x-(side<0?-.128:.099))**2+(y-.095)**2+(z-.009)**2;
      if(error<distance){seed=vertex;distance=error}
    }
    const queue=[seed];
    arm.add(seed);
    for(const vertex of queue)for(const next of vertex.neighbors){
      if(eligible(next)&&!arm.has(next)){arm.add(next);queue.push(next)}
    }
  }
  return keys.map(vertex=>Number(arm.has(vertex)));
}

export class ImportedMerperson extends Merperson {
  constructor(asset) {
    super(true);
    this.head.position.set(0,neck*scale,.014);
    this.closeUpOffset=.20;
    this.closeUpRadius=1.08;

    const bones=[];
    const addBone=(point,parent=this.body)=>{
      const bone=new T.Bone();
      bone.position.copy(point);
      parent.add(bone);
      bones.push(bone);
      return bone;
    };
    addBone(V());
    bones.push(this.head);
    const tailStart=tailCenterline[0][2],tailEnd=tailCenterline.at(-1)[2];
    this.tailSegment=V();
    this.tailRotation=new T.Quaternion();
    this.stations=Array.from({length:tailStations},(_,i)=>{
      const u=i/(tailStations-1);
      const rest=V(0,lerp(waist,-.476,u)*scale,0);
      return {bone:addBone(rest),rest,coordinate:this.tail.coordinate(lerp(tailStart,tailEnd,u))};
    });
    this.armBindings=this.arms.map(arm=>{
      const point=([x,y,z])=>V(arm.sign*x,y,z).multiplyScalar(scale);
      const a=point(shoulder),b=point(elbow),c=point(wrist);
      const upper=addBone(a),lower=addBone(b.sub(a),upper),hand=addBone(c.sub(point(elbow)),lower);
      arm.update(this.motion);
      return {driven:[upper,lower,hand],source:[arm.shoulder,arm.elbow,arm.wrist],
        inverse:[arm.shoulder,arm.elbow,arm.wrist].map(b=>b.quaternion.clone().invert())};
    });

    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(asset.positions,3));
    geometry.setAttribute('normal',new T.BufferAttribute(asset.normals,3));
    geometry.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
    geometry.setIndex(new T.BufferAttribute(asset.indices,1));
    const indices=[],weights=[],forearms=forearmVertices(asset);
    for(let i=0;i<asset.positions.length;i+=3) {
      const x=Math.abs(asset.positions[i]),y=asset.positions[i+1],z=asset.positions[i+2];
      const u=clamp((waist-y)/(waist+.476),0,1)*(tailStations-1);
      const station=Math.min(tailStations-2,Math.floor(u)),fraction=u-station;
      const tail=1-smoothstep(y,waist-.045,waist);
      const head=smoothstep(y,.305,.375);
      // Keep the rear hair mass out of the shoulder envelope.
      const shoulderWeight=smoothstep(x,.045,.093)*smoothstep(z,-.039,-.006)*
        (1-smoothstep(y,.285,.327));
      const arm=lerp(forearms[i/3],shoulderWeight,smoothstep(y,.210,.243));
      if(arm>0) {
        const start=2+tailStations+(asset.positions[i]<0?0:3);
        const lower=1-smoothstep(y,.168,.225),hand=1-smoothstep(y,.079,.118);
        const first=hand>0?1:0, blend=hand>0?hand:lower;
        indices.push(0,1,start+first,start+first+1);
        weights.push(1-head-arm,head,arm*(1-blend),arm*blend);
      } else {
        indices.push(0,1,2+station,3+station);
        weights.push(1-head-tail,head,tail*(1-fraction),tail*fraction);
      }
    }
    geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));

    this.textures=asset.images.map((image,i)=>{
      const texture=new T.Texture(image);
      texture.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;
      texture.wrapS=texture.wrapT=T.RepeatWrapping;
      texture.flipY=false;
      texture.needsUpdate=true;
      return texture;
    });
    const [map,packed,normalMap]=this.textures;
    const {pbrMetallicRoughness:pbr}=asset.material;
    const material=new T.MeshStandardMaterial({
      color:new T.Color(...pbr.baseColorFactor.slice(0,3)),map,
      metalness:pbr.metallicFactor,metalnessMap:packed,
      roughness:pbr.roughnessFactor,roughnessMap:packed,normalMap,
      side:asset.material.doubleSided?T.DoubleSide:T.FrontSide
    });
    this.materials.set('Meshy',material);
    this.model=new T.SkinnedMesh(geometry,material);
    this.model.name='Meshy merperson';
    this.model.scale.setScalar(scale);
    this.model.frustumCulled=false;
    this.body.add(this.model);
    this.root.updateMatrixWorld(true);
    this.model.bind(new T.Skeleton(bones));
    this.parts.push({mesh:this.model,levels:[geometry]});
    this.update(0,0,'Idle');
  }

  pose(time) {
    super.pose(time);
    this.body.position.y+=.21;
    let previous;
    for(const station of this.stations) {
      const {bone,rest,coordinate}=station;
      this.tail.sample(...coordinate);
      bone.quaternion.copy(toVertical).multiply(this.tail.frame).multiply(fromVertical);
      if(previous){
        // Transport the imported bind segments through the original tail
        // frames so the new centerline retains its own segment lengths.
        this.tailRotation.slerpQuaternions(previous.bone.quaternion,bone.quaternion,.5);
        this.tailSegment.subVectors(rest,previous.rest).applyQuaternion(this.tailRotation);
        bone.position.copy(previous.bone.position).add(this.tailSegment);
      }else bone.position.copy(rest);
      previous=station;
    }
    for(const {driven,source,inverse} of this.armBindings) {
      for(let i=0;i<driven.length;i++){
        this.tailRotation.copy(source[i].quaternion).multiply(inverse[i]);
        driven[i].quaternion.identity().slerp(this.tailRotation,armMotion[i]);
      }
    }
  }

  setLOD(level) {
    // The source is already 2,657 triangles. Keep the authored mesh at every distance.
    this.level=level;
  }

  dispose() {
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
