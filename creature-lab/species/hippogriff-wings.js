import * as T from '../vendor/three.module.js';
import {joint,smoothSections} from './form.js';

const clay=0xb5b1a9;
const vec=p=>new T.Vector3(...p);

// Each vane is a closed, cambered section. Its off-centre shaft and
// rolled margins give both faces a readable profile even in plain clay.
export function featherTract(actor,parent,feathers){
 return actor.mesh(parent,clay,lod=>{
   const pos=[],normals=[],idx=[],steps=[20,11,6][lod];
   for(const [index,[start,end,width,normal,curve]] of feathers.entries()){
     const a=vec(start),delta=vec(end).sub(a),side=delta.clone().cross(vec(typeof normal==='function'?normal(0):normal)).normalize();
     const up=side.clone().cross(delta).normalize(),offset=pos.length/3;
     const long=delta.length()>.54,phase=Math.sin(index*19.371);
     for(let j=0;j<=steps;j++){
       const t=j/steps,wave=Math.sin(Math.PI*t);
       // The broad proximal web carries the load. The outer third narrows
       // into an emarginated finger on the long primaries.
       const proximal=.012+.988*Math.sin(Math.min(1,t*3.2)*Math.PI/2);
       const taper=Math.pow(Math.max(.0002,1-t**(long?3:2)),long?.53:.70);
       const w=width*proximal*taper*(.94+.30*t)*(1+.06*phase);
       const center=curve?vec(curve(t)):a.clone().addScaledVector(delta,t)
         .addScaledVector(up,.23*width*wave).addScaledVector(side,(.25+.13*phase)*width*t*wave);
       let transverse=side, surfaceNormal=up;
       if(curve){
         const tangent=vec(curve(Math.min(1,t+.01))).sub(vec(curve(Math.max(0,t-.01)))).normalize();
         const outward=typeof normal==='function'?vec(normal(t)):vec(normal);
         transverse=tangent.clone().cross(outward).normalize();
         surfaceNormal=transverse.clone().cross(tangent);
       }
       const slit=long&&j===steps-3&&index%3===0?.82:1;
       for(const [k,h] of [[-1,-.018],[-.48,.022],[0,.064],[.35,.017],[.72,-.027],[.72,-.043],[0,-.051],[-1,-.034]]){
         const web=k<0?k*slit:k;
         const underside=h<-.030;
         const tilt=web*(long?.20:.11)-t*(long?.16:.055);
         normals.push(...surfaceNormal.clone().addScaledVector(transverse,tilt)
           .normalize().multiplyScalar(underside?-1:1).toArray());
         pos.push(...center.clone().addScaledVector(transverse,web*w)
           .addScaledVector(surfaceNormal,(h+web*t*(long?.16:.055))*w).toArray());
       }
       if(j)for(let k=0;k<8;k++){
         const p=offset+(j-1)*8+k,q=offset+(j-1)*8+(k+1)%8;
         idx.push(p,q,p+8,q,q+8,p+8);
       }
     }
   }
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
   g.setIndex(idx);g.computeVertexNormals();
   // Keep the fold and shaft visible in raking light. At the very thin
   // margin the local skin normal stabilizes the bevel on both faces.
   const output=g.attributes.normal,geometric=new T.Vector3(),guide=new T.Vector3();
   for(let i=0;i<output.count;i++){
     geometric.fromBufferAttribute(output,i);
     guide.fromArray(normals,3*i).lerp(geometric,.58).normalize();
     output.setXYZ(i,guide.x,guide.y,guide.z);
   }
   return g;
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
 // Parameterize the same elliptical skin used by the enclosed arm.
 // Angle zero is the leading edge, positive angles travel over the top.
 function edge(x,angle,lift=0){
   const [,y,front,back,thick]=station(x);
   return [x,y-.057+(thick+lift)*Math.sin(angle),
     (front+back)/2+((front-back)/2+lift)*Math.cos(angle)];
 }
 actor.loft(side,clay,leading.map(([x,y,f,b,d])=>[x,y-.057,(f+b)/2,(f-b)/2,d]),[1,0,0]);
 const feathers=[];
 for(let i=0;i<15;i++){
   const t=i/14,x=.34+1.50*t,root=edge(x,1.65);
   const tip=[x+.15+.29*t,root[1]-.25-.08*t,-1.13-.20*Math.sin(t*Math.PI)];
   feathers.push([root,tip,.195-.031*t,[0,1,0]]);
 }
 for(let i=0;i<10;i++){
   const t=i/9,x=1.73+.89*t,root=edge(x,1.48);
   const angle=.40+t*.95, length=1.72+.17*Math.sin(t*Math.PI)-.35*t*t;
   feathers.push([root,[x+length*Math.sin(angle),root[1]-.22-.22*t,root[2]-length*Math.cos(angle)],.224-.047*t,[0,1,0]]);
 }
 // Coverts follow both faces of the arm. Marginal coverts turn around
 // its nose, hiding the entire shoulder-to-wrist structural contour.
 for(const face of [-1,1]){
   for(const [count,angle,arc,overhang,w] of [[19,1.34,1.58,.47,.151],
       [25,.82,1.53,.19,.120],[29,.35,1.26,.05,.091],[32,-.12,1.08,.01,.079]]){
     for(let i=0;i<count;i++){
       const t=(i+.3)/count,x=.28+2.31*t,wobble=.06*Math.sin(i*2.9+angle);
       const curve=u=>{
         const tipward=u*(.12+.27*t*t+.032*Math.sin(i*1.9));
         const a=face*(angle+wobble+arc*u);
         const p=edge(x+tipward,a,.002+.013*u);
         p[2]-=overhang*u*u;p[1]-=.07*overhang*u*u;
         return p;
       };
       const outward=u=>{
         const a=face*(angle+wobble+arc*u);
         const [, ,f,b,d]=station(x+u*(.12+.27*t*t));
         return [0,Math.sin(a)/d,2*Math.cos(a)/(f-b)];
       };
       feathers.push([curve(0),curve(1),w*(1-.21*t),outward,curve]);
     }
   }
 }
 featherTract(actor,side,feathers);
}

// At rest the humerus lies caudally and the wrist returns toward the
// shoulder. The closed flight fan lies along the ribs beneath the mantle.
function folded(actor,side){
 const rows=[
   [.306,1.85,.59,.048,.081],[.388,1.85,.44,.100,.192],
   [.441,1.82,.17,.100,.247],[.432,1.78,-.12,.084,.222],
   [.422,1.76,-.43,.069,.165],[.397,1.75,-.74,.059,.108],
   [.341,1.72,-.98,.033,.065],[.272,1.70,-1.145,.009,.016]
 ];
 // The scapular mantle fills the saddle between the withers and the
 // folded humerus, especially visible when looking straight at the chest.
 actor.loft(side,clay,[[.17,1.91,.32,.16,.12],[.285,1.93,.31,.23,.145],
   [.348,1.91,.30,.21,.14],[.395,1.86,.27,.15,.12]], [1,0,0]);
 actor.loft(side,clay,rows,[0,0,-1]);
 const samples=smoothSections(rows,5);
 const feathers=[];
 function rootAt(t,angle){
   const f=t*(samples.length-1),a=samples[Math.floor(f)],b=samples[Math.ceil(f)];
   const [x,y,z,w,h]=a.map((v,i)=>v+(b[i]-v)*(f%1));
   return [x+w*Math.cos(angle),y+h*Math.sin(angle),z];
 }
 // Folded remiges bend outward across the convex gluteus, then turn
 // inward again past the dock. A straight chord would cut through the hip.
 function restingVane(root,tip,width,layer){
   const curve=u=>{
     const p=root.map((v,k)=>v+(tip[k]-v)*u);
     const flank=.465+.070*Math.exp(-(((p[2]+.81)/.40)**2))
       -.19/(1+Math.exp((p[2]+1.22)*9));
     const emerge=u*u/(u*u+.019*(1-u)*(1-u));
     p[0]+=(flank+layer-p[0])*emerge;
     p[1]+=.045*Math.sin(u*Math.PI);
     return p;
   };
   feathers.push([root,tip,width,[1,.14,0],curve]);
 }
 for(let i=0;i<10;i++){
   const t=i/9,root=rootAt(.31+.29*t,-1+.65*t);
   restingVane(root,[.34-.15*t,1.48+.04*t,-1.09-.43*t],.102,.008+.027*(1-t));
 }
 for(let i=0;i<13;i++){
   const t=i/12,root=rootAt(.13+.58*t,-.02);
   restingVane(root,[.484-.19*t*t,1.43+.06*t,-.41-.92*t],.104,.015+.025*(1-t));
 }
 // The scapulars stream down from the withers onto the coverts. Each
 // root stays inside the skin and the free end gradually clears the flank.
 for(const [angle,length,count,w] of [[-.5,.47,14,.098],[.12,.39,15,.091],
     [.63,.32,17,.084],[1.12,.27,18,.073],[1.63,.22,19,.068],[2.05,.19,17,.059]]){
   for(let i=0;i<count;i++){
     const t=(i+.4)/count, start=.022+t*.84, phase=Math.sin(i*2.81+angle);
     const curve=u=>{
       const p=rootAt(Math.min(.995,start+u*.19),angle+.11*phase-u*(.52+.14*phase));
       p[0]+=(.018+.046*Math.exp(-(((p[2]+.62)/.46)**2)))*u;p[2]-=.80*length*u*u*(.74+.25*t);p[1]-=.041*u;
       return p;
     };
     const outward=u=>{
       const a=angle+.11*phase-u*(.52+.14*phase);
       return [Math.cos(a),.47*Math.sin(a),-.08];
     };
     feathers.push([curve(0),curve(1),w,outward,curve]);
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
