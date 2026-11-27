import * as T from '../vendor/three.module.js';
import {Owl} from './owl.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadOwlAsset(){
  const url=typeof OWL_EMBEDDED_GLB==='string'?OWL_EMBEDDED_GLB:
    new URL('./static/Barn_Owl_50k_Poly_meshy_ai.glb',typeof OWL_PAGES!=='undefined'?
      new URL('species/',import.meta.url):import.meta.url);
  return loadTexturedGLB(url);
}

export class ImportedOwl extends Owl {
  constructor(asset){
    super();
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(asset.positions.slice(),3));
    geometry.setAttribute('normal',new T.BufferAttribute(asset.normals.slice(),3));
    geometry.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
    geometry.setIndex(new T.BufferAttribute(asset.indices,1));
    const scale=.34/1.90065485;
    geometry.translate(0,.94974494,0);
    geometry.scale(scale,scale,scale);

    // Keep the procedural pose controller and replace its visible surfaces.
    for(const {mesh} of this.parts)mesh.removeFromParent();
    const joints=[this.trunk,this.head,this.tail,
      ...this.feet.map(foot=>foot.carrier),...this.wings.flatMap(wing=>wing.joints)];
    const position=geometry.attributes.position;
    const indices=new Uint16Array(4*position.count),weights=new Float32Array(4*position.count);
    const smooth=T.MathUtils.smoothstep;
    for(let i=0;i<position.count;i++){
      const x=position.getX(i)/scale,y=position.getY(i)/scale-.94974494,z=position.getZ(i)/scale;
      const side=Number(x>0),width=Math.abs(x);
      const foot=(1-smooth(y,-.91,-.69))*(1-smooth(width,.24,.43))*smooth(z,-.23,-.04);
      const wing=(1-foot)*smooth(width,.25,.55)*(1-smooth(z,.19,.33));
      const remaining=1-foot-wing;
      const head=remaining*smooth(y,-.06,.36)*smooth(z,.04,.23);
      const tail=(remaining-head)*(1-smooth(y,-.66,-.36))*(1-smooth(z,-.22,-.07));
      const wingJoint=5+side*3+(width>.60?2:width>.42?1:0);
      // Feet and tail occupy opposite sides of the lower body in depth.
      const lowerJoint=foot>=tail?3+side:2;
      indices.set([0,1,wingJoint,lowerJoint],4*i);
      const lower=Math.max(foot,tail);
      weights.set([1-head-wing-lower,head,wing,lower],4*i);
    }
    geometry.setAttribute('skinIndex',new T.BufferAttribute(indices,4));
    geometry.setAttribute('skinWeight',new T.BufferAttribute(weights,4));
    const {material,textures}=texturedMaterial(asset);
    this.textures=textures;
    this.materials.set('Meshy barn owl',material);
    const mesh=new T.SkinnedMesh(geometry,material);
    mesh.name='Meshy barn owl';
    mesh.frustumCulled=false;
    this.root.add(mesh);
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
