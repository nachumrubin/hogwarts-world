// Study geometry samples rest-space stations and their existing bone weights.
import * as T from '../../vendor/three.module.js';
import {surfaceAttribute} from '../../hippogriff-surface.js';
const vector=(attribute,i)=>new T.Vector3().fromBufferAttribute(attribute,i);
function meshPart(mesh,geometry,study=false){
 return {mesh:{name:mesh.name,userData:{...mesh.userData,study},geometry}};
}
function subset(mesh,indices){
 const g=Object.create(mesh.geometry);
 g.index=new T.Uint32BufferAttribute(indices,1);
 return meshPart(mesh,g);
}
class Cards{
 constructor(){this.p=[];this.n=[];this.detail=[];this.ids=[];this.weights=[];this.ix=[];}
 point(g,i,p,n,u,v,id,salt){
  const sk=g.attributes.skinIndex,wt=g.attributes.skinWeight;
  this.ids.push(sk.getX(i),sk.getY(i),0,0);this.weights.push(wt.getX(i),wt.getY(i),0,0);
  this.p.push(...p.toArray());this.n.push(...n.toArray());this.detail.push(u,v,id,salt);
 }
 strip(rows,cols){
  const start=this.p.length/3-rows*cols;
  for(let j=1;j<rows;j++)for(let k=1;k<cols;k++){
   const b=start+j*cols+k;this.ix.push(b-cols-1,b-cols,b,b-cols-1,b,b-1);
  }
 }
 part(mesh){
  const g=new T.BufferGeometry();
  for(const [key,array,stride] of [['position',this.p,3],['normal',this.n,3],['surfaceDetail',this.detail,4],['skinWeight',this.weights,4]])
   g.setAttribute(key,new T.Float32BufferAttribute(array,stride));
  g.setAttribute('skinIndex',new T.Uint16BufferAttribute(this.ids,4));g.setIndex(this.ix);
  return meshPart(mesh,g,true);
 }
}
function plumage(mesh,region,lod){
 const g=mesh.geometry,vanes=g.userData.vanes,{position,normal}=g.attributes;
 const keep=[],cards=new Cards();let first=0;
 for(const [i,{offset,steps,stride}] of vanes.entries()){
  const count=steps*stride*6,facial=position.getY(offset+3)>2.43;
  if(facial!==(region==='face')){
   for(let k=first;k<first+count;k++)keep.push(g.index.array[k]);
  }else{
   const middle=offset+Math.floor(steps*.5)*stride;
   const radius=vector(position,middle).distanceTo(vector(position,middle+6))*.62;
   const rows=lod?4:7;
   for(let j=0;j<rows;j++){
    const t=j/(rows-1),row=offset+Math.round(t*steps)*stride,i0=row+3;
    const mid=vector(position,i0),n=vector(normal,i0).normalize();
    const lateral=vector(position,row+6).sub(vector(position,row)).normalize();
    for(const x of [-1,0,1]){
     const p=mid.clone().addScaledVector(lateral,x*radius).addScaledVector(n,.0015-.09*radius*x*x);
     const camber=n.clone().addScaledVector(lateral,.32*x).normalize();
     cards.point(g,i0,p,camber,(x+1)/2,t,1,i%8);
    }
   }
   cards.strip(rows,3);
  }
  first+=count;
 }
 if(first!==g.index.count)throw Error('Unexpected contour tract topology');
 return [subset(mesh,keep),cards.part(mesh)];
}
function down(mesh,lod){
 const g=mesh.geometry,{position,normal}=g.attributes,cards=new Cards(),seen=new Set();
 // Sample across the skin triangles; vertex rows alone leave lines of bare skin.
 const index=g.index.array;
 for(let tri=0;tri<index.length;tri+=3){
  const corners=[index[tri],index[tri+1],index[tri+2]];
  const vertices=corners.map(i=>vector(position,i));
  const [a,b,c]=vertices;
  if(Math.max(a.z,b.z,c.z)<1.16||Math.min(a.y,b.y,c.y)>2.80)continue;
  const ab=b.clone().sub(a),ac=c.clone().sub(a);
  const count=Math.ceil(ab.clone().cross(ac).length()*(lod?3500:10500));
  for(let sample=0;sample<count;sample++){
   const i=corners[0],seed=tri+sample*.732;
   const rand=k=>{const a=Math.sin(seed*17.13+k*27.21)*43051;return a-Math.floor(a);};
   const r=Math.sqrt(rand(1)),u=r*(1-rand(2)),v=r-u;
   const p=a.clone().addScaledVector(ab,u).addScaledVector(ac,v);
   if(Math.abs(p.x)<.10||p.z<1.17||p.z>1.56||p.y<2.49||p.y>2.78)continue;
   if(Math.hypot((p.y-2.635)/.047,(p.z-1.386)/.078)<1.01)continue;
   const n=vector(normal,i).multiplyScalar(1-r).addScaledVector(vector(normal,corners[1]),u).addScaledVector(vector(normal,corners[2]),v).normalize();
   const grid=lod?.021:.010,key=p.toArray().map(v=>Math.floor(v/grid)).join(',');
   if(seen.has(key))continue;seen.add(key);
  const dir=new T.Vector3(0,-.25,-1);dir.addScaledVector(n,-dir.dot(n)).normalize();
  const across=new T.Vector3().crossVectors(dir,n).normalize(),salt=i%8;
  for(const t of [0,.5,1])for(const x of [-1,1]){
   const q=p.clone().addScaledVector(dir,t*(.032+.002*salt)).addScaledVector(across,x*.012).addScaledVector(n,.001+t*.002);
   cards.point(g,i,q,n,(x+1)/2,t,13,salt);
  }
  cards.strip(3,2);
  }
 }
 return cards.part(mesh);
}
function tail(mesh,lod){
 const g=mesh.geometry,{position}=g.attributes,cards=new Cards();
 const sides=[8,6,5][lod],steps=[18,13,9][lod],stride=sides+1,span=stride*(steps+1);
 for(let start=0;start<position.count;start+=span){
  const lock=start/span;
  for(let plane=0;plane<(lod?1:2);plane++){
   const rows=lod?6:10;
   for(let j=0;j<rows;j++){
    const t=j/(rows-1),row=start+Math.round(t*steps)*stride;
    const center=new T.Vector3();
    for(let k=0;k<sides;k++)center.add(vector(position,row+k));center.divideScalar(sides);
    const w=center.distanceTo(vector(position,row))*1.52+.001;
    const angle=lock*2.39996+plane*Math.PI/2+.26*t;
    const across=new T.Vector3(Math.cos(angle),0,Math.sin(angle)),n=new T.Vector3(-across.z,0,across.x);
    for(const x of [-1,1])cards.point(g,row,center.clone().addScaledVector(across,x*w),n,(x+1)/2,t,5,lock%8);
   }
   cards.strip(rows,2);
  }
 }
 return cards.part(mesh);
}
function tissue(mesh,lod){
 const g=Object.create(mesh.geometry);
 // Independent attribute table leaves the control geometry intact.
 g.attributes={...g.attributes,surfaceDetail:surfaceAttribute(mesh,lod)};
 return meshPart(mesh,g,true);
}
export function studyParts(actor,region){
 const out=[];
 for(const part of actor.parts){
  const {mesh}=part,g=mesh.geometry,lod=actor.level;
  if((region==='face'||region==='chest')&&mesh.name==='ruff'&&g.userData.vanes)out.push(...plumage(mesh,region,lod));
  else if(region==='tail'&&mesh.name==='tail')out.push(tail(mesh,lod));
  else if(region==='face'&&['orbit','head','lid'].includes(mesh.name)&&!g.userData.vanes)out.push(tissue(mesh,lod));
  else if(region==='coat'&&(mesh.name==='body'||(mesh.name==='leg'&&!g.userData.vanes&&g.attributes.position.getZ(0)<0)))out.push(tissue(mesh,lod));
  else out.push(part);
  if(region==='face'&&mesh.name==='body')out.push(down(mesh,lod));
 }
 return out;
}
