import * as T from '../vendor/three.module.js';
import {joint,smoothSections} from './form.js';

const clay=0xb5b1a9;
const vec=p=>new T.Vector3(...p);

// Each vane is a closed, cambered section. Its off-centre shaft and
// rolled margins give both faces a readable profile even in plain clay.
export function featherTract(actor,parent,feathers){
 return actor.mesh(parent,clay,lod=>{
   const pos=[],idx=[],steps=[12,8,5][lod];
   for(const [start,end,width,normal] of feathers){
     const a=vec(start),delta=vec(end).sub(a),side=delta.clone().cross(vec(normal)).normalize();
     const up=side.clone().cross(delta).normalize(),offset=pos.length/3;
     for(let j=0;j<=steps;j++){
       const t=j/steps, wave=Math.sin(Math.PI*t);
       const w=width*(.008+wave**.66)*(.71+.49*t);
       const center=a.clone().addScaledVector(delta,t).addScaledVector(up,.32*width*wave)
         .addScaledVector(side,.26*width*t*wave);
       for(const [k,h] of [[-1,-.10],[-.52,.10],[0,.24],[.42,.09],[.80,-.12],[0,-.18]]){
         pos.push(...center.clone().addScaledVector(side,k*w).addScaledVector(up,h*w).toArray());
       }
       if(j)for(let k=0;k<6;k++){
         const p=offset+(j-1)*6+k,q=offset+(j-1)*6+(k+1)%6;
         idx.push(p,q,p+6,q,q+6,p+6);
       }
     }
   }
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
   g.setIndex(idx);g.computeVertexNormals();return g;
 });
}

// A broad shoulder, rearward elbow, forward wrist and narrowing hand.
// Each station contains the leading edge, trailing edge and flesh depth.
const leading=[
 [.22,1.88,.51,-.27,.185],[.43,1.99,.58,-.40,.183],
 [.75,2.16,.51,-.48,.145],[1.10,2.26,.34,-.53,.112],
 [1.37,2.30,.43,-.48,.092],[1.70,2.32,.61,-.35,.073],
 [1.98,2.27,.67,-.19,.061],[2.22,2.19,.57,-.12,.048],
 [2.47,2.09,.40,-.09,.035],[2.68,1.99,.21,-.04,.015],
 [2.75,1.96,.10,.07,.003]
];
function spread(actor,side){
 const rows=smoothSections(leading,5);
 function station(x){
   const i=rows.findIndex(r=>r[0]>=x);
   if(i<=0)return rows[i<0?rows.length-1:0];
   const a=rows[i-1],b=rows[i],t=(x-a[0])/(b[0]-a[0]);
   return a.map((v,k)=>v+(b[k]-v)*t);
 }
 function surface(x,u){
   const [,y,front,back,thick]=station(x);
   return [x,y+thick*Math.sqrt(Math.max(0,4*u*(1-u)))-u*.115,front+(back-front)*u];
 }
 // The fleshy leading edge encloses the wing bones and supports the remiges.
 actor.loft(side,clay,leading.map(([x,y,f,b,d])=>[x,y-.057,(f+b)/2,(f-b)/2,d]),[1,0,0]);
 const feathers=[];
 for(let i=0;i<14;i++){
   const t=i/13,x=.40+1.46*t;
   const root=surface(x,.49), tip=[x+.08+.37*t,root[1]-.27-.12*t,-1.06-.17*Math.sin(t*Math.PI)];
   feathers.push([root,tip,.19-.026*t,[0,1,0]]);
 }
 for(let i=0;i<10;i++){
   const t=i/9,x=1.78+.83*t,root=surface(x,.39);
   const angle=.39+t*.90, length=1.58-.13*t+.12*Math.sin(t*Math.PI);
   feathers.push([root,[x+length*Math.sin(angle),root[1]-.31-.15*t,root[2]-length*Math.cos(angle)],.215-.052*t,[0,1,0]]);
 }
 // Greater, median and marginal coverts overlap from trailing to leading.
 for(const [count,u,reach,width] of [[23,.43,.82,.145],[26,.22,.60,.119],[28,.08,.41,.107]]){
   for(let i=0;i<count;i++){
     const t=i/(count-1),x=.34+2.24*t,root=surface(x,u),distal=t*t;
     const tip=[x+.12+distal*.59,root[1]-.12-.08*t,root[2]-reach*(1-.32*distal)];
     feathers.push([root,tip,width,[0,1,0]]);
   }
 }
 featherTract(actor,side,feathers);
}

// At rest the humerus lies caudally and the wrist returns toward the
// shoulder. The closed flight fan lies along the ribs beneath the mantle.
function folded(actor,side){
 const rows=[
   [.35,1.83,.65,.044,.077],[.407,1.81,.48,.108,.204],
   [.438,1.80,.21,.129,.267],[.446,1.76,-.10,.125,.248],
   [.436,1.73,-.43,.102,.184],[.41,1.74,-.76,.071,.123],
   [.37,1.76,-1.00,.042,.073],[.336,1.77,-1.135,.009,.018]
 ];
 // The scapular mantle fills the saddle between the withers and the
 // folded humerus, especially visible when looking straight at the chest.
 actor.loft(side,clay,[[.17,1.91,.32,.16,.12],[.285,1.93,.31,.23,.145],
   [.384,1.89,.30,.24,.154],[.45,1.84,.27,.18,.14]], [1,0,0]);
 actor.loft(side,clay,rows,[0,0,-1]);
 const samples=smoothSections(rows,5);
 const feathers=[];
 function rootAt(t,angle){
   const f=t*(samples.length-1),a=samples[Math.floor(f)],b=samples[Math.ceil(f)];
   const [x,y,z,w,h]=a.map((v,i)=>v+(b[i]-v)*(f%1));
   return [x+w*Math.cos(angle),y+h*Math.sin(angle),z];
 }
 for(let i=0;i<10;i++){
   const t=i/9,root=rootAt(.31+.29*t,-1+.65*t);
   feathers.push([root,[.39+.07*Math.sin(t*2.4),1.46+.10*t,-1.12-.51*t],.111,[1,.12,0]]);
 }
 for(let i=0;i<13;i++){
   const t=i/12,root=rootAt(.13+.58*t,-.02);
   feathers.push([root,[.458+.049*Math.sin(t*3),1.39+.12*t,-.38-1.04*t],.113,[1,.14,0]]);
 }
 for(const [angle,length,count,w] of [[-.38,.61,16,.094],[.20,.48,17,.087],[.72,.35,19,.078],[1.12,.30,18,.067]]){
   for(let i=0;i<count;i++){
     const t=(i+.5)/count,root=rootAt(.065+t*.82,angle);
     const end=rootAt(Math.min(.995,.065+t*.82+.15),angle-.68);
     end[0]+=.022;end[2]-=length*(.70+.29*t);end[1]-=.064+.052*t;
     feathers.push([root,end,w,[1,.32,0]]);
   }
 }
 featherTract(actor,side,feathers);
}
export function buildWing(actor,open){
 const wings=joint(actor.body);
 for(const s of [-1,1]){
   const side=joint(wings);side.scale.x=s;
   if(open)spread(actor,side);else folded(actor,side);
 }
 return wings;
}
