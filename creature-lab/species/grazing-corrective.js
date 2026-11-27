import * as T from '../vendor/three.module.js';

// Bake a pose-space correction from the actual grazing skeleton. The mane is
// fused to the jaw in the scan. Preserve its local edge directions across the
// cervical joints while keeping the surface close to its skinned position.
export function grazingCorrective(mesh){
  const geometry=mesh.geometry,position=geometry.attributes.position;
  const joints=geometry.attributes.skinIndex,weights=geometry.attributes.skinWeight;
  mesh.updateWorldMatrix(true,false);
  const skeleton=mesh.skeleton;
  const matrices=skeleton.bones.map((bone,i)=>new T.Matrix4()
    .multiplyMatrices(mesh.bindMatrixInverse,bone.matrixWorld)
    .multiply(skeleton.boneInverses[i]).multiply(mesh.bindMatrix));
  const byPosition=new Map(),ids=[],rest=[],posed=[],linear=[],inverse=[];
  for(let i=0;i<position.count;i++){
    const p=new T.Vector3().fromBufferAttribute(position,i);
    const key=p.toArray().map(v=>Math.round(v*1e5)).join(',');
    if(!byPosition.has(key)){
      byPosition.set(key,rest.length);
      const matrix=new T.Matrix4();matrix.elements.fill(0);
      for(let k=0;k<4;k++){
        const w=weights.array[4*i+k],m=matrices[joints.array[4*i+k]].elements;
        for(let j=0;j<16;j++)matrix.elements[j]+=w*m[j];
      }
      const frame=new T.Matrix3().setFromMatrix4(matrix);
      rest.push(p);posed.push(p.clone().applyMatrix4(matrix));
      linear.push(frame);inverse.push(frame.clone().invert());
    }
    ids.push(byPosition.get(key));
  }
  const n=rest.length,neighbors=Array.from({length:n},()=>new Set());
  const triangles=geometry.index.array;
  for(let i=0;i<triangles.length;i+=3)for(let k=0;k<3;k++){
    const a=ids[triangles[i+k]],b=ids[triangles[i+(k+1)%3]];
    if(a!==b){neighbors[a].add(b);neighbors[b].add(a)}
  }
  // Solve the screened graph Laplacian by conjugate gradients. Use welded
  // vertices so texture seams have exactly the same correction on both sides.
  const rhs=new Float64Array(3*n),degree=new Float64Array(n);
  const edge=new T.Vector3(),target=new T.Vector3();
  for(let i=0;i<n;i++){
    degree[i]=neighbors[i].size*1.001+.0001;
    for(const j of neighbors[i]){
      edge.subVectors(rest[i],rest[j]);
      target.copy(edge).applyMatrix3(linear[i]).add(edge.applyMatrix3(linear[j])).multiplyScalar(.5);
      target.sub(posed[i]).add(posed[j]);
      rhs[3*i]+=target.x;rhs[3*i+1]+=target.y;rhs[3*i+2]+=target.z;
    }
  }
  const adj=neighbors.map(s=>Array.from(s)),delta=new Float64Array(3*n);
  const direction=rhs.slice(),product=new Float64Array(3*n);
  const dot=(a,b)=>{let sum=0;for(let i=0;i<a.length;i++)sum+=a[i]*b[i];return sum};
  let residual=dot(rhs,rhs);
  for(let step=0;step<160&&residual>1e-12;step++){
    for(let i=0;i<n;i++){
      const p=3*i;
      let x=direction[p]*degree[i],y=direction[p+1]*degree[i],z=direction[p+2]*degree[i];
      for(const j of adj[i]){x-=direction[3*j];y-=direction[3*j+1];z-=direction[3*j+2]}
      product[p]=x;product[p+1]=y;product[p+2]=z;
    }
    const alpha=residual/dot(direction,product);
    for(let i=0;i<rhs.length;i++){delta[i]+=alpha*direction[i];rhs[i]-=alpha*product[i]}
    const next=dot(rhs,rhs),beta=next/residual;
    for(let i=0;i<rhs.length;i++)direction[i]=rhs[i]+beta*direction[i];
    residual=next;
  }
  const result=new Float32Array(3*position.count);
  ids.forEach((id,i)=>edge.fromArray(delta,3*id).applyMatrix3(inverse[id]).toArray(result,3*i));
  return new T.BufferAttribute(result,3);
}
