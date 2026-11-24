import * as T from '../vendor/three.module.js';
import {joint,smoothSections} from './form.js';

const clay=0xb5b1a9;
const vec=p=>new T.Vector3(...p);

// Each vane is a closed, cambered section. Its off-centre shaft and
// rolled margins give both faces a readable profile even in plain clay.
export function featherTract(actor,parent,feathers){
 return actor.mesh(parent,clay,lod=>{
   const pos=[],idx=[],normals=[],detail=[];
   // Closely spaced samples at the midrib resolve a narrow rounded rachis.
   // Upper and lower faces meet only at their thin rolled margins.
   const cross=[-1,-.48,-.075,0,.075,.46,1],stride=cross.length*2;
   for(const [index,[start,end,width,normal,curve]] of feathers.entries()){
     const a=vec(start),delta=vec(end).sub(a),flight=delta.length()>.55;
     const outward=t=>vec(typeof normal==='function'?normal(t):normal);
     const side=delta.clone().cross(outward(0)).normalize(),up=side.clone().cross(delta).normalize();
     const phase=Math.sin(index*17.3),offset=pos.length/3;
     const steps=(flight?[18,11,6]:[15,10,6])[lod];
     const len=delta.length();
     const path=t=>curve?vec(curve(t)):a.clone().addScaledVector(delta,t)
       .addScaledVector(up,width*.39*Math.sin(Math.PI*t))
       .addScaledVector(side,width*(.29+.14*phase)*t*Math.sin(Math.PI*t));
     for(let j=0;j<=steps;j++){
       const t=j/steps,center=path(t);
       const tangent=path(Math.min(1,t+.008)).sub(path(Math.max(0,t-.008))).normalize();
       const lateral=tangent.clone().cross(outward(t)).normalize();
       const dorsal=lateral.clone().cross(tangent).normalize();
       const envelope=flight?.006+Math.sin(Math.PI*t**.83)**.61:
         .004+Math.sin(Math.PI*t**(.70+.09*phase))**.69;
       // Roll the free tip slightly off the skin while its root stays buried.
       const arch=width*(.13*Math.sin(Math.PI*t)+.10*t*t);
       if(!flight)center.addScaledVector(dorsal,arch);
       const w=width*envelope*(.91+.16*t), twist=.19*t+.09*phase;
       for(const bottom of [false,true]){
         for(let c=0;c<cross.length;c++){
           const k=cross[bottom?cross.length-1-c:c];
           const x=k*(k>0?(flight?.66:.86):1);
           const shaft=.102*(1-.75*t)*Math.exp(-((k/.066)**2));
           const camber=.245*(1-k*k)+twist*k;
           const h=camber+(bottom?-.046:shaft);
           detail.push(x*w,t*len+.011*phase,1);
           pos.push(...center.clone().addScaledVector(lateral,x*w).addScaledVector(dorsal,h*w).toArray());
           // A rounded shaft shoulder, smoothly cambered vanes, and a
           // separate underside keep packed normals stable on thin edges.
           const slope=-.49*k+twist+(bottom?0:-2*k*shaft/.00436);
           normals.push(...dorsal.clone().addScaledVector(lateral,-slope/(x===k?1:(flight?.66:.86)))
             .normalize().multiplyScalar(bottom?-1:1).toArray());
         }
       }
       if(j)for(let c=0;c<stride;c++){
         const p=offset+(j-1)*stride+c,q=offset+(j-1)*stride+(c+1)%stride;
         idx.push(p,q,p+stride,q,q+stride,p+stride);
       }
     }
   }
   const g=new T.BufferGeometry();
   g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
   g.setAttribute('clayDetail',new T.Float32BufferAttribute(detail,3));
   g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setIndex(idx);
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
 // A continuous ellipsoidal folded arm fills the envelope inside the
 // marginal coverts, including the inside face visible on the far wing.
 const rows=[
   [.263,1.83,.68,.045,.070],[.325,1.86,.54,.119,.150],
   [.374,1.84,.35,.139,.209],[.398,1.835,.13,.146,.229],
   [.400,1.82,-.13,.142,.211],[.394,1.80,-.42,.141,.195],
   [.409,1.79,-.73,.135,.177],[.401,1.76,-.95,.111,.147],
   [.342,1.70,-1.16,.080,.104],[.279,1.61,-1.37,.028,.048]
 ];
 actor.loft(side,clay,rows,[0,0,-1]);
 const feathers=[];
 // A common mantle surface carries all tracts down and back over the
 // ribs. v runs from the dorsal seam to the ventral wing margin.
 const hull=smoothSections(rows,5);
 function mantleNormal(v){
   const theta=1.56-2.67*v;
   return [Math.cos(theta),.69*Math.sin(theta),0];
 }
 function mantle(z,v,lift=0){
   // Follow the actual folded arm through the shoulder and haunch. The
   // short extrapolation beyond the dock belongs only to the primary tips.
   let i=1;
   while(i<hull.length-1 && hull[i][2]>z)i++;
   const a=hull[i-1],b=hull[i],t=Math.min(1,Math.max(0,(z-a[2])/(b[2]-a[2])));
   const [x,y,,rx,ry]=a.map((n,k)=>n+(b[k]-n)*t);
   const theta=1.56-2.67*v,free=Math.max(0,b[2]-z);
   return [x+(rx+lift)*Math.cos(theta)-free*.35,
     y+(ry+lift)*Math.sin(theta)-free*.24,z];
 }
 // Ten nested primaries finish the long rear point, while the broader
 // secondaries furnish the lower margin just ahead of the haunch.
 for(const [primary,count] of [[true,10],[false,13]]){
   for(let i=0;i<count;i++){
     const t=i/(count-1),z0=primary?-.13-.45*t:.47-.91*t;
     const z1=primary?-1.13-.46*t:-.15-1.11*t;
     const v0=primary?.36+.13*t:.27+.20*t,v1=primary?.90-.24*t:.98-.09*t;
     const curve=u=>{
       const z=z0+(z1-z0)*u,v=v0+(v1-v0)*u;
       const p=mantle(z,v,(primary?.013:.027)+.023*u+.014*(1-t));
       p[0]+=.033*Math.exp(-(((z+.82)/.38)**2))*u;
       p[1]-=u*(primary?.055:.097);
       return p;
     };
     feathers.push([curve(0),curve(1),primary?.100:.115,u=>mantleNormal(v0+(v1-v0)*u),curve]);
   }
 }
 // The greater coverts lie over the remiges, with progressively shorter
 // feathers turning forward and over the convex shoulder towards the neck.
 for(const [count,v,drop,reach,w,lift] of [[12,.31,.49,.65,.110,.045],
   [14,.18,.43,.44,.091,.047],[17,.06,.31,.32,.075,.043],[18,-.03,.24,.24,.064,.039]]){
   for(let i=0;i<count;i++){
     const t=(i+.4)/count,phase=Math.sin(2.36*i+v*4);
     const z0=.555-1.39*t+.024*phase;
     const curve=u=>{
       const z=z0-u*reach*(.73+.39*t+.06*phase);
       const level=v+u*(drop+.065*phase);
       const p=mantle(z,level,(lift*(.38+.62*u)+.015*u*u)*(.57+.49*level));
       p[1]+=.013*Math.sin(Math.PI*u);
       return p;
     };
     feathers.push([curve(0),curve(1),w*(1+.085*phase),u=>mantleNormal(v+u*(drop+.065*phase)),curve]);
   }
 }
 // Short dorsal feathers turn from the back onto the wing instead of
 // leaving free plates suspended along the far shoulder.
 for(let i=0;i<19;i++){
   const z=.48-i*.068;
   const curve=t=>mantle(z-.21*t,-.16+.38*t,.008+.039*t);
   feathers.push([curve(0),curve(1),.065,u=>mantleNormal(-.16+.38*u),curve]);
 }
 // Scapular contour feathers bridge the pectoral skin and folded wrist
 // over the forward end of the arm, where the longer wing rows originate.
 const shoulderRows=smoothSections(rows,5);
 function shoulderSurface(i,a,lift){
   const n=Math.floor(i),t=i-n;
   const [x,y,z,w,h]=shoulderRows[n].map((v,k)=>v+(shoulderRows[n+1][k]-v)*t);
   return [x+(w+lift)*Math.cos(a),y+(h+lift)*Math.sin(a),z];
 }
 for(let row=0;row<6;row++){
   for(let j=0;j<12;j++){
     const start=1.8+1.95*row,angle=-1.06+.27*(j+.48*(row%2));
     const phase=Math.sin(j*3.18+row*2.06);
     const curve=u=>shoulderSurface(start+(7.6+1.5*phase)*u,
       angle-u*(.25+.11*phase),.003+.028*u);
     const outward=u=>[Math.cos(angle-.25*u),Math.sin(angle-.25*u),.35*(1-u)];
     feathers.push([curve(0),curve(1),.046+.005*row,outward,curve]);
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
