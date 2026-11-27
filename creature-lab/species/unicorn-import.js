import * as T from '../vendor/three.module.js';
import {Unicorn} from './unicorn.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadUnicornAsset(){
  const url=typeof UNICORN_EMBEDDED_GLB==='string'?UNICORN_EMBEDDED_GLB:
    new URL('./static/white_unicorn_meshy_ai.glb',typeof UNICORN_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  return loadTexturedGLB(url);
}

export class ImportedUnicorn extends Unicorn {
  constructor(asset){
    super();
    const {base,legs}=this.horse;
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(asset.positions.slice(),3));
    geometry.setAttribute('normal',new T.BufferAttribute(asset.normals.slice(),3));
    geometry.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
    geometry.setIndex(new T.BufferAttribute(asset.indices,1));
    geometry.rotateY(1.67);
    geometry.computeBoundingBox();
    const {min}=geometry.boundingBox,center=geometry.boundingBox.getCenter(new T.Vector3());
    geometry.translate(-center.x,-min.y,-center.z);
    geometry.scale(1.47,1.47,1.47);

    for(const {mesh} of this.parts)mesh.removeFromParent();
    const joints=[base,this.neck,this.head,...legs.flatMap(leg=>Object.values(leg.joints))];
    this.root.updateMatrixWorld(true);
    const position=geometry.attributes.position;
    const indices=new Uint16Array(position.count*4),weights=new Float32Array(position.count*4);
    const smooth=(value,min,max)=>T.MathUtils.smoothstep(value,min,max);
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      const fore=z>0,side=x>0;
      const leg=3+5*(2*Number(side)+Number(fore));
      const limb=(1-smooth(y,.98,1.55))*smooth(Math.abs(z),.17,.61);
      const neck=(1-limb)*smooth(z,.37,.84)*smooth(y,1.27,1.84);
      const head=neck*smooth(y,1.77,2.16)*smooth(z,.62,1.04);
      const station=T.MathUtils.clamp((1.42-y)/.34,0,4);
      const lower=Math.min(3,Math.floor(station)),blend=station-lower;
      // The upper neck and lower limbs occupy separate regions of the rest mesh.
      if(neck>0){
        indices.set([0,1,2,leg+lower],4*i);
        weights.set([1-limb-neck,neck-head,head,limb],4*i);
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
    this.parts.push({mesh,levels:[geometry]});
  }

  setLOD(level){this.level=level}

  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
