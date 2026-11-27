import * as T from '../vendor/three.module.js';
import {Unicorn} from './unicorn.js';
import {grazingCorrective} from './grazing-corrective.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadUnicornAsset(){
  const url=typeof UNICORN_EMBEDDED_GLB==='string'?UNICORN_EMBEDDED_GLB:
    new URL('./static/white_unicorn_meshy_ai.glb',typeof UNICORN_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  return loadTexturedGLB(url);
}

const corrections=new WeakMap();
export class ImportedUnicorn extends Unicorn {
  constructor(asset){
    super();
    const {legs}=this.horse;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(asset.positions.slice(),3));
    geometry.setAttribute('normal',new T.BufferAttribute(asset.normals.slice(),3));
    geometry.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
    geometry.setIndex(new T.BufferAttribute(asset.indices,1));
    geometry.rotateY(1.67);
    geometry.computeBoundingBox();
    const {min}=geometry.boundingBox;
    geometry.translate(.24,-min.y,0);
    geometry.scale(1.47,1.64,1.47);
    // The export turns its poll and muzzle sideways. Unwind that turn into
    // the straight-ahead bind pose of the original cervical chain.
    const axis=new T.Vector3(0,1,0),point=new T.Vector3();
    const pos=geometry.attributes.position,normal=geometry.attributes.normal;
    for(let i=0;i<pos.count;i++){
      point.fromBufferAttribute(pos,i);
      const turn=-1.45*T.MathUtils.smoothstep(point.y+.75*point.x,1.55,2.04)
        *T.MathUtils.smoothstep(point.z,.38,.78);
      point.z-=.96;
      point.applyAxisAngle(axis,turn);
      pos.setXYZ(i,point.x,point.y,point.z+.96);
      point.fromBufferAttribute(normal,i).applyAxisAngle(axis,turn);
      normal.setXYZ(i,point.x,point.y,point.z);
    }
    geometry.computeBoundingBox();

    // The old leg skins and torso are also parents of the animated bones.
    for(const {mesh} of this.parts)mesh.visible=false;
    const cervical=this.cervical.bones;
    const headIndex=cervical.length;
    const joints=[...cervical,this.head,...legs.flatMap(leg=>leg.bones)];
    this.root.updateMatrixWorld(true);
    const position=geometry.attributes.position;
    const indices=new Uint16Array(position.count*4),weights=new Float32Array(position.count*4);
    const smooth=(value,min,max)=>T.MathUtils.smoothstep(value,min,max);
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      const fore=z>0,side=x>0;
      const leg=headIndex+1+5*(2*Number(side)+Number(fore));
      const limb=(1-smooth(y,.98,1.55))*smooth(Math.abs(z),.17,.61);
      const neck=(1-limb)*smooth(z+.60*(y-1.55),.22,.77);
      const progress=smooth(y+.45*z,1.60,2.48);
      const ring=1+progress*(headIndex-2);
      const first=Math.min(Math.floor(ring),headIndex-2),fraction=ring-first;
      const head=smooth(y+.95*z,2.85,3.18);
      const station=T.MathUtils.clamp((1.42-y)/.34,0,4);
      const lower=Math.min(3,Math.floor(station)),blend=station-lower;
      // The upper neck and lower limbs occupy separate regions of the rest mesh.
      if(neck>limb){
        indices.set([0,first,first+1,headIndex],4*i);
        weights.set([1-neck,neck*(1-head)*(1-fraction),neck*(1-head)*fraction,neck*head],4*i);
      }else{
        indices.set([0,leg+lower,leg+lower+1],4*i);
        weights.set([1-limb,limb*(1-blend),limb*blend],4*i);
      }
    }
    geometry.setAttribute('skinIndex',new T.BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new T.BufferAttribute(weights,4));
    const {material,textures}=texturedMaterial(asset);
    this.textures=textures;
    this.materials.set('Meshy unicorn',material);
    const mesh=new T.SkinnedMesh(geometry,material);
    mesh.name='Meshy unicorn';
    mesh.frustumCulled=false;
    this.body.add(mesh);
    this.root.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton(joints));
    let corrective=corrections.get(asset);
    if(!corrective){
      this.graze=1;
      this.update(0,0,'Graze',{terrainHeight:()=>0});
      this.root.updateMatrixWorld(true);
      corrective=grazingCorrective(mesh);
      corrections.set(asset,corrective);
      this.graze=0;
      this.update(0,0,'Idle');
    }
    geometry.morphTargetsRelative=true;
    geometry.morphAttributes.position=[corrective];
    mesh.updateMorphTargets();
    this.importedMesh=mesh;
    this.parts.push({mesh,levels:[geometry]});
  }

  setLOD(level){this.level=level}

  update(dt,t,action,context){
    super.update(dt,t,action,context);
    if(this.importedMesh)this.importedMesh.morphTargetInfluences[0]=this.graze*this.graze;
  }

  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
