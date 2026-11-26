// A one-weight skin preserves each original phalanx, ankle and rectrix
// transform. Vertex colour lets horn, toes and feathers share the draw.
import * as T from '../vendor/three.module.js';
import {atlasUV,owlFinish} from './owl-finish.js';
export function batchArticulatedParts(owl,parts){
  const bones=[...new Set(parts.map(part=>part.mesh.parent))];
  owl.root.updateMatrixWorld(true);
  const sources=parts.map(({mesh,make,levels})=>{
    const matrix=mesh.matrixWorld.clone(),index=bones.indexOf(mesh.parent),color=mesh.material.color.clone();
    mesh.removeFromParent();levels.forEach(g=>g.dispose());return {matrix,index,color,make,rectrix:mesh.userData.rectrix,contact:mesh.userData.owlContact,finish:mesh.userData.owlFinish};
  });
  const discarded=new Set(parts);owl.parts=owl.parts.filter(p=>!discarded.has(p));
  const skin=owl.mesh(owl.root,0xfefefe,l=>{
    const xyz=[],normal=[],rgb=[],indices=[],weights=[],joints=[],contact=[],uv=[];
    for(const {make,matrix,index,color,rectrix,contact:surface,finish} of sources){
      const g=make(l).applyMatrix4(matrix),offset=xyz.length/3;
      const kind=finish??(rectrix!==undefined?'tail':surface?.region==='claw'?'claw':'toe');
      const sides=(kind==='hock'?[20,12,7]:[14,10,7])[l];
      xyz.push(...g.attributes.position.array);normal.push(...g.attributes.normal.array);
      for(let i=0;i<g.attributes.position.count;i++){
        let value=1;
        if(rectrix!==undefined){
          const u=Math.floor(i/3)/(g.attributes.position.count/3-1);
          const band=Math.sin(Math.PI*(3*u+.06*Math.sin(rectrix)+.06*Math.abs(i%3-1)));
          value=.95-.26*Math.exp(-band*band/.15)+(i%3===1?.035:0);
        }
        if(kind==='claw'){
          const distal=i/(g.attributes.position.count-1);
          value*=1.30-.44*distal;
        }else if(kind==='toe')value*=.80+.15*Math.sin(.15*i+index)**2;
        else if(kind==='leg')value*=.95+.064*Math.sin(Math.floor(i/(3*[11,8,5][l]))*4.58);
        if(l<2)uv.push(...atlasUV(g,kind,sides,i,l));
        rgb.push(color.r*value,color.g*value,color.b*value);joints.push(index,0,0,0);weights.push(1,0,0,0);
      }
      if(surface)contact.push({...surface,first:offset,end:xyz.length/3});
      for(const i of g.index.array)indices.push(i+offset);g.dispose();
    }
    const g=new T.BufferGeometry();
    for(const [name,values,n] of [['position',xyz,3],['normal',normal,3],['color',rgb,3],['skinWeight',weights,4]])
      g.setAttribute(name,new T.Float32BufferAttribute(values,n));
    if(l<2)g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(joints,4));g.setIndex(indices);g.userData.owlContact=contact;return g;
  },T.SkinnedMesh);
  skin.material.vertexColors=true;skin.material.map=owl.maps[3];skin.material.roughness=.88;
  owlFinish(skin.material,'detail',.000075);
  skin.bind(new T.Skeleton(bones));
  // Both feet and the tail stay within this root-local flight envelope.
  // The roost circuit translates the root, so off-screen birds can still cull.
  skin.computeBoundingBox();
  skin.boundingSphere=new T.Sphere(new T.Vector3(0,.22,.07),.52);
}
