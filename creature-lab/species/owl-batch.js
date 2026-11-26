// A one-weight skin preserves each original phalanx, ankle and rectrix
// transform. Vertex colour lets horn, toes and feathers share the draw.
import * as T from '../vendor/three.module.js';
export function batchArticulatedParts(owl,parts){
  const bones=[...new Set(parts.map(part=>part.mesh.parent))];
  owl.root.updateMatrixWorld(true);
  const sources=parts.map(({mesh,make,levels})=>{
    const matrix=mesh.matrixWorld.clone(),index=bones.indexOf(mesh.parent),color=mesh.material.color.clone();
    mesh.removeFromParent();levels.forEach(g=>g.dispose());return {matrix,index,color,make};
  });
  const discarded=new Set(parts);owl.parts=owl.parts.filter(p=>!discarded.has(p));
  const skin=owl.mesh(owl.root,0xfefefe,l=>{
    const xyz=[],normal=[],rgb=[],indices=[],weights=[],joints=[];
    for(const {make,matrix,index,color} of sources){
      const g=make(l).applyMatrix4(matrix),offset=xyz.length/3;
      xyz.push(...g.attributes.position.array);normal.push(...g.attributes.normal.array);
      for(let i=0;i<g.attributes.position.count;i++){
        rgb.push(color.r,color.g,color.b);joints.push(index,0,0,0);weights.push(1,0,0,0);
      }
      for(const i of g.index.array)indices.push(i+offset);g.dispose();
    }
    const g=new T.BufferGeometry();
    for(const [name,values,n] of [['position',xyz,3],['normal',normal,3],['color',rgb,3],['skinWeight',weights,4]])
      g.setAttribute(name,new T.Float32BufferAttribute(values,n));
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(joints,4));g.setIndex(indices);return g;
  },T.SkinnedMesh);
  skin.material.vertexColors=true;skin.bind(new T.Skeleton(bones));
  // Both feet and the tail stay within this root-local flight envelope.
  // The roost circuit translates the root, so off-screen birds can still cull.
  skin.computeBoundingBox();
  skin.boundingSphere=new T.Sphere(new T.Vector3(0,.22,.07),.52);
}
