// Body axes are Y up, +Z anterior. Section data and joint pivots are in metres.
import * as T from '../vendor/three.module.js';

export function joint(parent,x=0,y=0,z=0) {
  const node=new T.Group();
  node.position.set(x,y,z);
  parent.add(node);
  return node;
}

// Sweep elliptical cross sections along a path. The reference axis stays
// fixed between rings so the cross sections do not twist at inflections.
function smoothSections(rows,steps){
  const samples=[];
  for(let i=0;i<rows.length-1;i++){
    const a=rows[i],b=rows[i+1],prev=rows[Math.max(0,i-1)],next=rows[Math.min(i+2,rows.length-1)];
    for(let j=0;j<steps;j++){
      const t=j/steps;
      samples.push(a.map((v,k)=>{
        const d=b[k]-v,left=v-prev[k],right=next[k]-b[k];
        const m=left*d>0?2*left*d/(left+d):0,n=right*d>0?2*right*d/(right+d):0;
        return v+(3-2*t)*t*t*d+t*(1-t)*((1-t)*m-t*n);
      }));
    }
  }
  return [...samples,rows.at(-1)];
}
export function sweep(sections,sides) {
  const rows=smoothSections(sections,sides>=20?3:sides>=12?2:1);
  const points=rows.map(r=>new T.Vector3(...r.slice(0,3)));
  const axis=new T.Vector3(1,0,0);
  const direction=points.at(-1).clone().sub(points[0]).normalize();
  if(Math.abs(direction.x)>.8) axis.set(0,0,1);
  const pos=[],indices=[];
  for(let i=0;i<rows.length;i++){
    const tangent=points[Math.min(i+1,rows.length-1)].clone().sub(points[Math.max(0,i-1)]).normalize();
    const v=tangent.clone().cross(axis).normalize(), u=v.clone().cross(tangent);
    for(let j=0;j<sides;j++){
      const a=j*2*Math.PI/sides;
      pos.push(...points[i].clone().addScaledVector(u,rows[i][3]*Math.cos(a)).addScaledVector(v,rows[i][4]*Math.sin(a)).toArray());
      if(i){const k=i*sides+j,n=i*sides+(j+1)%sides;indices.push(k-sides,n-sides,k,n-sides,n,k)}
    }
  }
  const last=(rows.length-1)*sides;
  for(let j=1;j<sides-1;j++)indices.push(0,j+1,j,last,last+j,last+j+1);
  const geo=new T.BufferGeometry();
  geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  return geo;
}

export class Specimen {
  constructor(){
    this.root=new T.Group();this.body=joint(this.root);
    this.parts=[];this.materials=new Map();this.level=0;this.origin=new T.Vector3();
  }
  mesh(parent,color,make){
    if(!this.materials.has(color))this.materials.set(color,new T.MeshStandardMaterial({color,roughness:.84,side:T.DoubleSide}));
    const levels=[make(0)],mesh=new T.Mesh(levels[0],this.materials.get(color));
    parent.add(mesh);this.parts.push({mesh,levels,make});return mesh;
  }
  loft(parent,color,rows){return this.mesh(parent,color,l=>sweep(rows,[20,12,7][l]))}
  oval(parent,color,x,y,z,w,h,d){
    const mesh=this.mesh(parent,color,l=>new T.SphereGeometry(1,[20,12,8][l],[14,9,6][l]));
    mesh.position.set(x,y,z);mesh.scale.set(w,h,d);return mesh;
  }
  setLOD(level){
    this.level=level;
    for(const part of this.parts)part.mesh.geometry=part.levels[level]??=part.make(level);
  }
  setPosition(p){this.origin.copy(p);this.root.position.copy(p)}
  dispose(){
    this.root.removeFromParent();
    for(const {levels} of this.parts)levels.forEach(g=>g.dispose());
    this.materials.forEach(m=>m.dispose());
  }
}
