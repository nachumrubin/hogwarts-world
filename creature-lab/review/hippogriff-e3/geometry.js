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
 part(mesh,region=true){
  const g=new T.BufferGeometry();
  for(const [key,array,stride] of [['position',this.p,3],['normal',this.n,3],['surfaceDetail',this.detail,4],['skinWeight',this.weights,4]])
   g.setAttribute(key,new T.Float32BufferAttribute(array,stride));
  g.setAttribute('skinIndex',new T.Uint16BufferAttribute(this.ids,4));g.setIndex(this.ix);
  return meshPart(mesh,g,region);
 }
}
// Eye-local tangent coordinate and distance along the outward viewing axis.
function eyeFrame(p){
 const side=Math.sign(p.x)||1,dx=Math.abs(p.x)-.192,dz=p.z-1.386;
 return {side,x:dx*.58168-dz*.81342,y:p.y-2.635,depth:dx*.81342+dz*.58168};
}
function sweepEyeMargin(p,amount){
 const {side,x,y,depth}=eyeFrame(p);
 if(Math.abs(x)>.14||Math.abs(y)>.11||depth<-.035)return p;
 const flare=Math.max(0,depth-.035);
 const w=.060+flare*.90,h=.052+flare*.50;
 const r=Math.hypot(x/w,y/h);
 const factor=amount*Math.max(0,1/Math.max(r,.001)-1);
 const dx=x*factor,dy=y*factor;
 return p.add(new T.Vector3(side*.58168*dx,dy,-.81342*dx));
}
function plumage(mesh,region,lod,approved=false){
 const g=mesh.geometry,vanes=g.userData.vanes,{position,normal}=g.attributes;
 const keep=[],cards=new Cards(),chest=new Cards();let first=0;
 for(const [i,{offset,steps,stride}] of vanes.entries()){
  const count=steps*stride*6,facial=position.getY(offset+3)>2.43;
  if(region!=='all'&&facial!==(region==='face')){
   for(let k=first;k<first+count;k++)keep.push(g.index.array[k]);
  }else{
   const target=region==='all'&&!facial?chest:cards;
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
     if(approved&&facial)sweepEyeMargin(p,.92);
     target.point(g,i0,p,camber,(x+1)/2,t,1,i%8);
    }
   }
   target.strip(rows,3);
  }
  first+=count;
 }
 if(first!==g.index.count)throw Error('Unexpected contour tract topology');
 if(region==='all')return [cards.part(mesh,'face'),chest.part(mesh,'chest')];
 return [subset(mesh,keep),cards.part(mesh)];
}
function down(mesh,lod,approved=false){
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
  const {side,x,y,depth}=eyeFrame(p);
  const distance=Math.hypot(x/.086,y/.075);
  const near=approved&&depth>-.035?Math.min(1,Math.max(0,(1.6-distance)/.72)):0;
  if(near){
   const away=new T.Vector3(side*.58168*x,y,-.81342*x);
   away.addScaledVector(n,-away.dot(n)).normalize();
   dir.lerp(away,near*.92).normalize();
  }
  const across=new T.Vector3().crossVectors(dir,n).normalize(),salt=i%8;
  for(const t of [0,.5,1])for(const x of [-1,1]){
   const q=p.clone().addScaledVector(dir,t*(.032+.002*salt)*(1-.49*near)).addScaledVector(across,x*.012*(1-.36*near)).addScaledVector(n,.001+t*.002);
   if(near)sweepEyeMargin(q,.94);
   cards.point(g,i,q,n,(x+1)/2,t,13,salt);
  }
  cards.strip(3,2);
  }
 }
 return cards.part(mesh,approved?'face':true);
}
function tail(mesh,lod,region=true){
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
 return cards.part(mesh,region);
}
function tissue(mesh,lod,region=true){
 const g=Object.create(mesh.geometry);
 // Independent attribute table leaves the control geometry intact.
 g.attributes={...g.attributes,surfaceDetail:surfaceAttribute(mesh,lod)};
 return meshPart(mesh,g,region);
}
export function studyParts(actor,region){
 const out=[];
 for(const part of actor.parts){
  const {mesh}=part,g=mesh.geometry,lod=actor.level;
  if(region==='all'&&mesh.name==='ruff'&&g.userData.vanes)out.push(...plumage(mesh,region,lod,true));
  else if((region==='face'||region==='chest')&&mesh.name==='ruff'&&g.userData.vanes)out.push(...plumage(mesh,region,lod));
  else if((region==='tail'||region==='all')&&mesh.name==='tail')out.push(tail(mesh,lod,region==='all'?'tail':true));
  else if((region==='face'||region==='all')&&['orbit','head','lid'].includes(mesh.name)&&!g.userData.vanes)out.push(tissue(mesh,lod,region==='all'?'face':true));
  else if((region==='coat'||region==='all')&&(mesh.name==='body'||(mesh.name==='leg'&&!g.userData.vanes&&g.attributes.position.getZ(0)<0)))out.push(tissue(mesh,lod,region==='all'?'coat':true));
  else out.push(part);
  if((region==='face'||region==='all')&&mesh.name==='body')out.push(down(mesh,lod,region==='all'));
 }
 return out;
}
