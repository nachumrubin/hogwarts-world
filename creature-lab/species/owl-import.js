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
    // The perched torso faces source +X. Its face is turned toward +Z.
    // Centre the two toe pads on the old perch frame before binding.
    geometry.translate(-.28,.90,0);
    geometry.rotateY(-Math.PI/2);
    geometry.scale(scale,scale,scale);
    const vertex=new T.Vector3(),up=new T.Vector3(0,1,0);
    const pivot=new T.Vector3(0,.23,.028);
    const positions=geometry.attributes.position,normals=geometry.attributes.normal;
    for(let i=0;i<positions.count;i++){
      vertex.fromBufferAttribute(positions,i);
      const turn=Math.PI/2*T.MathUtils.smoothstep(vertex.y,.20,.252);
      vertex.sub(pivot).applyAxisAngle(up,turn).add(pivot);
      positions.setXYZ(i,vertex.x,vertex.y,vertex.z);
      vertex.fromBufferAttribute(normals,i).applyAxisAngle(up,turn);
      normals.setXYZ(i,vertex.x,vertex.y,vertex.z);
    }

    // Keep the procedural pose controller and replace its visible surfaces.
    for(const {mesh} of this.parts)mesh.visible=false;
    // The scan fuses the folded feathers to the breast. The legacy wing rig
    // supplies separate flight feathers, including its folded-to-open morphs.
    this.flightFeathers=this.wings.flatMap(wing=>wing.joints.flatMap(joint=>
      joint.children.filter(child=>child.isMesh)));
    const joints=[this.trunk,this.head,this.tail,...this.feet.map(foot=>foot.carrier)];
    const position=geometry.attributes.position;
    const indices=new Uint16Array(4*position.count),weights=new Float32Array(4*position.count);
    const smooth=T.MathUtils.smoothstep;
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      const side=Number(x>0),width=Math.abs(x);
      const head=smooth(y,.209,.255);
      const foot=(1-smooth(y,.037,.091))*smooth(z,-.068,-.018);
      const tail=(1-smooth(z,-.167,-.098))*(1-smooth(width,.014,.041));
      indices.set([0,1,2,3+side],4*i);
      weights.set([1-head-foot-tail,head,tail,foot],4*i);
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

  applyPose(pose){
    super.applyPose(pose);
    for(const feather of this.flightFeathers??[])feather.visible=pose.open>.02;
  }

  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
