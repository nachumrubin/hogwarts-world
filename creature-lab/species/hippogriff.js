import * as T from '../vendor/three.module.js';
import {Specimen,joint,smoothSections} from './form.js';
import {buildWing,featherTract} from './hippogriff-wings.js';

const clay=0xb5b1a9;
// Width, dorsal Y/Z, ventral Y/Z. These contours turn together from
// transverse barrel sections into horizontal throat and crown sections.
const contour=[
 [.035,1.57,-1.27,1.47,-1.27],[.29,1.85,-1.17,1.16,-1.15],
 [.43,1.99,-.92,1.02,-.89],[.405,1.94,-.60,1.075,-.53],
 [.414,1.89,-.28,1.02,-.25],[.456,1.94,.04,.95,.13],
 [.47,2.025,.24,.96,.49],[.418,2.09,.40,1.10,.78],
 [.366,2.18,.48,1.43,.99],[.292,2.32,.56,1.80,1.08],
 [.226,2.50,.64,2.16,1.13],[.189,2.65,.69,2.45,1.14],
 [.202,2.77,.69,2.61,1.18],[.231,2.88,.72,2.72,1.25],
 [.224,2.98,.79,2.86,1.27],[.151,3.045,.86,2.975,1.20],
 [.025,3.073,.98,3.061,1.05]
];
function skin(row,angle){
 const [w,dy,dz,vy,vz]=row, c=Math.cos(angle),t=(1+Math.sin(angle))*.5;
 return [w*c*(.94+.09*t),vy+(dy-vy)*t,vz+(dz-vz)*t];
}
function trunk(lod){
 const rows=smoothSections(contour,[4,3,2][lod]), sides=[48,32,20][lod],pos=[],idx=[];
 rows.forEach((r,i)=>{
   for(let j=0;j<sides;j++){
     pos.push(...skin(r,2*Math.PI*j/sides));
     const a=i*sides+j,b=i*sides+(j+1)%sides;
     if(i)idx.push(a-sides,b-sides,a,b-sides,b,a);
   }
 });
 const last=(rows.length-1)*sides;
 for(let j=1;j<sides-1;j++)idx.push(0,j+1,j,last,last+j,last+j+1);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setIndex(idx);g.computeVertexNormals();return g;
}

export class Hippogriff extends Specimen {
 constructor(){
   super();
   const body=this.body;
   this.mesh(body,clay,trunk);
   // Follow the actual skin toward the breast and nape, staggering follicles.
   const rows=smoothSections(contour,6),hackles=[];
   for(let i=0;i<12;i++){
     const station=46+i*3, count=32-Math.floor(i/3)*2;
     for(let j=0;j<count;j++){
       const angle=2*Math.PI*(j+(i%2)*.5+.08*Math.sin(j*3+i))/count;
       const n=[Math.cos(angle),.13,-Math.sin(angle)];
       const follicle=station+Math.round(.9*Math.sin(j*2.1+i));
       const root=skin(rows[follicle],angle);
       const tip=skin(rows[follicle-5],angle+.095*Math.cos(angle));
       root.forEach((_,k)=>{root[k]-=.016*n[k];tip[k]+=(.008+.004*Math.sin(j+i))*n[k]});
       hackles.push([root,tip,(i<5?.052:.039),n]);
     }
   }
   // Small crown and auricular feathers lie flush and flow away from
   // the cere. Leave room around the orbit for the bare orbital rim.
   for(let i=0;i<6;i++){
     const count=30-i*3;
     for(let j=0;j<count;j++){
       const angle=2*Math.PI*(j+.5*(i%2))/count;
       const root=skin(rows[81+i*2],angle),tip=skin(rows[77+i*2],angle+.12*Math.cos(angle));
       if(root[2]>1.10 && root[1]<2.95)continue;
       const n=[Math.cos(angle)*.77,.57,-Math.sin(angle)*.8];
       for(let k=0;k<3;k++){root[k]-=.010*n[k];tip[k]+=.006*n[k]}
       hackles.push([root,tip,.034-.002*i,n]);
     }
   }
   featherTract(this,body,hackles);
   // Cere, upper culmen and recurved maxillary hook, with a separate lower jaw.
   this.loft(body,clay,[[0,2.818,1.14,.136,.105],[0,2.828,1.237,.132,.109],
    [0,2.823,1.316,.106,.097],[0,2.804,1.391,.078,.078],[0,2.768,1.437,.049,.057],
    [0,2.716,1.451,.031,.035],[0,2.668,1.434,.012,.015],[0,2.651,1.422,.002,.003]]);
   this.loft(body,clay,[[0,2.737,1.16,.12,.058],[0,2.728,1.262,.105,.047],
    [0,2.735,1.349,.066,.029],[0,2.738,1.402,.013,.012]]);
   for(const s of [-1,1]){
     const eye=joint(body,s*.157,2.867,1.175);eye.rotation.y=s*.86;eye.rotation.z=-s*.16;
     this.oval(eye,clay,0,0,0,.074,.058,.039);
     this.oval(eye,0x898780,0,.001,.029,.042,.043,.018);
     this.oval(eye,0x706f69,0,.001,.044,.021,.025,.007);
     this.loft(eye,clay,[[-.083,.021,-.009,.018,.022],[-.047,.052,.008,.026,.027],
       [.004,.050,.015,.024,.025],[.052,.037,.009,.018,.020],[.080,.012,-.010,.009,.013]]);
     this.loft(eye,clay,[[-.069,-.005,.005,.007,.009],[0,-.049,.015,.012,.014],[.067,-.009,.002,.007,.008]]);
     const nostril=this.oval(body,0x88867f,s*.106,2.858,1.29,.012,.019,.030);nostril.rotation.z=-s*.47;
     this.hindLeg(s);
     this.foreLeg(s);
   }
   // The tail follows the dock and falls as a tapered, slightly parted switch.
   for(let i=0;i<9;i++){
     const a=i*2.4, x=.066*Math.cos(a),z=.07*Math.sin(a);
     this.loft(body,clay,[[x*.3,1.77,-1.09,.087,.085],[x,1.66,-1.28+z,.091,.1],
       [x*1.3,1.37,-1.40+z,.077,.085],[x*1.45,1.0,-1.43+z,.065,.076],
       [x*1.7,.73,-1.49+z,.047,.059],[x*2,.52+.09*Math.cos(a),-1.56+z,.006,.008]]);
   }
   this.folded=buildWing(this,false);this.extended=buildWing(this,true);
   this.update(0,0,'Idle');
 }
 hindLeg(s){
   const leg=joint(this.body,s*.29,0,s*.058);
   this.loft(leg,clay,[[0,1.83,-.89,.075,.14],[s*.012,1.61,-.9,.166,.285],
    [s*.034,1.37,-.86,.18,.282],[s*.035,1.12,-.758,.144,.202],[s*.04,.994,-.737,.108,.137],
    [s*.03,.83,-.883,.097,.139],[s*.025,.645,-1.032,.066,.094],[s*.026,.573,-1.058,.068,.081],
    [s*.024,.496,-1.015,.048,.057],[s*.025,.269,-1.001,.041,.049],
    [s*.021,.195,-.988,.058,.067],[s*.019,.127,-.94,.047,.061]]);
   this.loft(leg,clay,[[s*.02,.168,-.96,.048,.066],[s*.02,.124,-.934,.063,.084],
    [s*.02,.047,-.903,.079,.107],[s*.02,.013,-.898,.081,.113]], [0,-1,0]);
 }
 foreLeg(s){
   const leg=joint(this.body,s*.278,0,s*.065);
   this.loft(leg,clay,[[-s*.028,1.80,.47,.105,.18],[0,1.60,.55,.175,.224],
    [s*.028,1.35,.55,.157,.187],[s*.044,1.13,.465,.118,.148],
    [s*.046,.964,.418,.093,.106],[s*.047,.84,.457,.074,.091],
    [s*.05,.681,.527,.064,.08],[s*.06,.45,.606,.054,.063],
    [s*.07,.221,.665,.051,.061],[s*.07,.114,.70,.071,.092]]);
   // Overlapping scutes follow the front of the tarsometatarsus,
   // retaining the taper of the underlying long tendons.
   for(let i=0;i<10;i++){
     const t=i/9,y=.235+.46*t,x=s*(.069-.019*t),z=.662-.137*t;
     const r=.050+.013*t;
     this.loft(leg,clay,[[x-r*.88,y+.012,z+r*.46,.006,.008],
       [x-r*.55,y+.004,z+r*.97,.010,.012],[x,y-.006,z+r*1.15,.014,.012],
       [x+r*.55,y+.004,z+r*.97,.010,.012],[x+r*.88,y+.012,z+r*.46,.006,.008]]);
   }
   const foot=joint(leg,s*.07,.0,.70);
   this.oval(foot,clay,0,.092,.015,.091,.065,.112);
   for(const [x,z] of [[-.18,.245],[.007,.33],[.188,.236],[-.052,-.183]]){
     const toe=joint(foot);toe.rotation.y=Math.atan2(s*x,z);
     const d=Math.hypot(x,z);
     this.loft(toe,clay,[[0,.099,.014,.046,.046],[0,.080,d*.31,.042,.040],
       [0,.071,d*.46,.037,.035],[0,.077,d*.58,.034,.036],
       [0,.059,d*.74,.027,.026],[0,.066,d*.82,.028,.029]]);
     this.loft(toe,clay,[[0,.071,d*.75,.028,.026],[0,.078,d*.87,.031,.034],
       [0,.068,d*1.01,.022,.026],[0,.045,d*1.092,.014,.018],[0,.015,d*1.105,.002,.003]]);
   }
 }
 update(dt,t,action){
   const pose=action==='Unfold'?this.extended:this.folded;
   if(this.pose===pose)return;
   this.folded.removeFromParent();this.extended.removeFromParent();
   this.body.add(pose);this.pose=pose;
 }
}
