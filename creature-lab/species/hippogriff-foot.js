// A single implicit skin covers the metatarsal pad, phalanges and unguals.
// Digit centre-lines also locate the overlying dorsal scale plates.
import * as T from '../vendor/three.module.js';
import {smoothSections} from './form.js';

const digits=[[-.258,.305,1.13],[.016,.412,1],[.258,.279,.91],[-.097,-.271,1.21]];
const blend=(a,b,k)=>Math.min(a,b)-Math.max(0,k-Math.abs(a-b))**2/(4*k);

const toes=digits.map(([x,z,girth])=>{
 const length=Math.hypot(x,z),sx=x/length,sz=z/length;
 const stations=[[.04,.094,.061,.054],[.19,.087,.059,.050],[.32,.067,.044,.036],
   [.42,.079,.048,.045],[.55,.067,.039,.032],[.65,.084,.045,.042],
   [.735,.091,.042,.039],[.77,.097,.034,.033],[.85,.111,.033,.036],
   [.94,.096,.030,.032],[1.016,.073,.022,.026],[1.079,.046,.014,.017],
   [1.090,.022,.007,.009],[1.082,.008,.002,.003]];
 const path=smoothSections(stations,3).map(([t,y,w,h])=>[length*t,y,w*girth,h*girth]);
 const segments=path.slice(1).map((b,i)=>{
   const a=path[i],dz=b[0]-a[0],dy=b[1]-a[1];
   return {a,b,dz,dy,inv:1/(dz*dz+dy*dy)};
 });
 return {sx,sz,path,segments,length};
});

function field(x,y,z){
 let d=(Math.hypot(x/.107,(y-.092)/.074,(z-.02)/.132)-1)*.083;
 for(const {sx,sz,segments,length} of toes){
   const lateral=x*sz-z*sx,along=x*sx+z*sz;
   if(Math.abs(lateral)>.097 || along<-.06 || along>1.1*length+.06)continue;
   let digit=1;
   for(const {a,b,dz,dy,inv} of segments){
     if(along<Math.min(a[0],b[0])-.11 || along>Math.max(a[0],b[0])+.11)continue;
     const t=Math.max(0,Math.min(1,((along-a[0])*dz+(y-a[1])*dy)*inv));
     const w=a[2]+t*(b[2]-a[2]),h=a[3]+t*(b[3]-a[3]);
     const dy0=(y-a[1]-t*dy),dz0=along-a[0]-t*dz;
     digit=Math.min(digit,(Math.sqrt((lateral/w)**2+(dy0*dy0+dz0*dz0)/(h*h))-1)*Math.min(w,h));
   }
   d=blend(d,digit,.026);
 }
 return d;
}

export function plantarSkin(lod){
 const step=[.008,.011,.015][lod],origin=[-.36,-.025,-.36];
 const dims=[.73,.26,.87].map(v=>Math.ceil(v/step)+1),[nx,ny,nz]=dims;
 const strides=[1,nx,nx*ny],values=new Float32Array(nx*ny*nz);
 const corners=[0,1,nx,nx+1,nx*ny,nx*ny+1,nx*ny+nx,nx*ny+nx+1];
 const pos=[],indices=[],vertices=new Map();
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   values[x+nx*(y+ny*z)]=field(origin[0]+x*step,origin[1]+y*step,origin[2]+z*step);
 }
 // Consistent face diagonals across neighboring cells retain the web
 // between toes without ambiguous four-way edges at narrow saddles.
 const tetrahedra=[[0,1,3,7],[0,3,2,7],[0,2,6,7],[0,6,4,7],[0,4,5,7],[0,5,1,7]];
 function crossing(i,j){
   const key=Math.min(i,j)*values.length+Math.max(i,j);
   const cached=vertices.get(key);if(cached!==undefined)return cached;
   const t=values[i]/(values[i]-values[j]),id=pos.length/3;
   for(let k=0;k<3;k++){
     const a=Math.floor(i/strides[k])%dims[k],b=Math.floor(j/strides[k])%dims[k];
     pos.push(origin[k]+step*(a+(b-a)*t));
   }
   vertices.set(key,id);return id;
 }
 for(let z=0;z<nz-1;z++)for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
   const i=x+nx*(y+ny*z),negative=values[i]<0;
   if(corners.every(off=>(values[i+off]<0)===negative))continue;
   for(const tetra of tetrahedra){
     const inside=[],outside=[];
     for(const c of tetra)(values[i+corners[c]]<0?inside:outside).push(c);
     if(!inside.length||!outside.length)continue;
     const edge=(a,b)=>crossing(i+corners[a],i+corners[b]);
     const cuts=inside.length===2?[edge(inside[0],outside[0]),edge(inside[0],outside[1]),
       edge(inside[1],outside[1]),edge(inside[1],outside[0])]:
       inside.flatMap(a=>outside.map(b=>edge(a,b)));
     const [a,b,c]=cuts.map(id=>new T.Vector3().fromArray(pos,3*id));
     const dir=new T.Vector3(...[0,1,2].map(k=>((outside[0]>>k)&1)-((inside[0]>>k)&1)));
     if(b.sub(a).cross(c.sub(a)).dot(dir)<0)cuts.reverse();
     indices.push(cuts[0],cuts[1],cuts[2]);
     if(cuts.length===4)indices.push(cuts[0],cuts[2],cuts[3]);
   }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setIndex(indices);g.computeVertexNormals();
 const skin=g.attributes.position,norm=g.attributes.normal,detail=[];
 // Intrinsic digit coordinates drive sub-millimetre scale grooves in
 // WGSL. Derive them from the same centre-lines that formed the union.
 for(let i=0;i<skin.count;i++){
   const x=skin.getX(i),y=skin.getY(i),z=skin.getZ(i),ny=norm.getY(i);
   let nearest=Infinity,tDigit=0,angle=0;
   for(const {sx,sz,length,segments} of toes){
     const along=x*sx+z*sz,side=x*sz-z*sx;
     for(const {a,b,dy,dz,inv} of segments){
       const u=Math.max(0,Math.min(1,((along-a[0])*dz+(y-a[1])*dy)*inv));
       const dy0=y-a[1]-u*dy,dz0=along-a[0]-u*dz;
       const dist=side*side+dy0*dy0+dz0*dz0;
       if(dist>=nearest)continue;
       nearest=dist;tDigit=(a[0]+u*dz)/length;
       angle=Math.atan2(side,(dy0*dz-dz0*dy)*Math.sqrt(inv));
     }
   }
   detail.push(angle,tDigit,3);
   if(ny<.2)continue;
   let relief=0;
   for(const {sx,sz,length,path} of toes){
     const along=x*sx+z*sz,t=along/length;
     if(t<.13||t>.76)continue;
     const side=x*sz-z*sx;
     let j=1;while(path[j][0]<along)j++;
     const a=path[j-1],b=path[j],u=(along-a[0])/(b[0]-a[0]);
     const width=a[2]+(b[2]-a[2])*u;
     const across=side/width;
     if(Math.abs(across)>1||y<a[1]+(b[1]-a[1])*u)continue;
     // Broad central scutes become short staggered plates at the sides.
     const lateral=Math.abs(across);
     const phase=t*14.3+.35*lateral*lateral+.26*Math.max(0,lateral-.55)*3;
     const f=phase-Math.floor(phase);
     const rim=Math.min(1,f/.16,(1-f)/.12);
     const margin=Math.min(1,(1-lateral)*8);
     const split=Math.min(1,.27+12*Math.abs(lateral-.72));
     relief=Math.max(relief,.0048*rim*margin*split*(.64+.36*f)*ny);
   }
   skin.setXYZ(i,x+norm.getX(i)*relief,y+ny*relief,z+norm.getZ(i)*relief);
 }
 g.setAttribute('clayDetail',new T.Float32BufferAttribute(detail,3));
 g.computeVertexNormals();
 // Interpolate the implicit gradient to suppress normal noise where the
 // isosurface narrowly clips a tetrahedron. Retain the scale relief.
 const guide=new T.Vector3(),geometric=new T.Vector3();
 for(let i=0;i<skin.count;i++){
   const xyz=[skin.getX(i),skin.getY(i),skin.getZ(i)].map((v,k)=>(v-origin[k])/step);
   const cell=xyz.map((v,k)=>Math.min(dims[k]-3,Math.max(1,Math.floor(v))));
   const frac=xyz.map((v,k)=>Math.max(0,Math.min(1,v-cell[k])));
   const base=cell[0]+nx*(cell[1]+ny*cell[2]);guide.set(0,0,0);
   for(let c=0;c<8;c++){
     const j=base+corners[c];
     const w=frac.reduce((p,f,k)=>p*((c&(1<<k))?f:1-f),1);
     for(let k=0;k<3;k++)guide.setComponent(k,guide.getComponent(k)+w*(values[j+strides[k]]-values[j-strides[k]]));
   }
   geometric.fromBufferAttribute(norm,i).lerp(guide.normalize(),.63).normalize();
   norm.setXYZ(i,geometric.x,geometric.y,geometric.z);
 }
 return g;
}
