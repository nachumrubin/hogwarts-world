import * as T from '../vendor/three.module.js';

// The pinned Meshy export is a single indexed primitive with embedded maps.
export function parseTexturedGLB(bytes) {
  const header=new DataView(bytes);
  const jsonLength=header.getUint32(12,true);
  const start=28+jsonLength;
  if(header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||
     header.getUint32(8,true)!==bytes.byteLength||header.getUint32(16,true)!==0x4e4f534a||
     header.getUint32(start-4,true)!==0x004e4942) throw Error('Invalid textured model GLB');
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));
  const primitive=gltf.meshes[0].primitives[0];
  const view=id=>{
    const {byteOffset=0,byteLength}=gltf.bufferViews[id];
    return new Uint8Array(bytes,start+byteOffset,byteLength);
  };
  function attribute(id,Type,components,componentType) {
    const {bufferView,byteOffset=0,count,componentType:actual}=gltf.accessors[id];
    if(actual!==componentType||gltf.bufferViews[bufferView].byteStride) throw Error('Unexpected textured model accessor layout');
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
    indices:gltf.accessors[primitive.indices].componentType===5123
      ? Uint32Array.from(attribute(primitive.indices,Uint16Array,1,5123))
      : attribute(primitive.indices,Uint32Array,1,5125),
    material,
    images:[image(pbr.baseColorTexture),image(pbr.metallicRoughnessTexture),image(material.normalTexture)]
  };
}

export async function loadTexturedGLB(url) {
  const response=await fetch(url);
  if(!response.ok) throw Error('Unable to load textured model');
  const asset=parseTexturedGLB(await response.arrayBuffer());
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

export function texturedMaterial(asset) {
  const textures=asset.images.map((image,i)=>{
    const texture=new T.Texture(image);
    texture.colorSpace=i===0?T.SRGBColorSpace:T.NoColorSpace;
    texture.wrapS=texture.wrapT=T.RepeatWrapping;
    texture.flipY=false;
    texture.needsUpdate=true;
    return texture;
  });
  const [map,packed,normalMap]=textures;
  const {pbrMetallicRoughness:pbr}=asset.material;
  const material=new T.MeshStandardMaterial({
    color:new T.Color(...(pbr.baseColorFactor??[1,1,1]).slice(0,3)),map,
    metalness:pbr.metallicFactor??1,metalnessMap:packed,
    roughness:pbr.roughnessFactor??1,roughnessMap:packed,normalMap,
    side:asset.material.doubleSided?T.DoubleSide:T.FrontSide
  });
  return {material,textures};
}
