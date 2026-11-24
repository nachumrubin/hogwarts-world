import * as T from '../vendor/three.module.js';
import {Specimen,joint,smoothSections} from './form.js';
import {buildWing,featherTract} from './hippogriff-wings.js';

const clay=0xb5b1a9;
// Width, dorsal Y/Z, ventral Y/Z. These contours turn together from
// transverse barrel sections into horizontal throat and crown sections.
const contour=[
 [.035,1.57,-1.27,1.47,-1.27],[.29,1.85,-1.17,1.16,-1.15],
 [.46,2.025,-.94,.99,-.90],[.418,1.955,-.63,1.09,-.54],
 [.432,1.94,-.29,.985,-.24],[.491,2.015,.045,.91,.14],
 [.531,2.11,.25,.89,.54],[.503,2.17,.39,1.03,.87],
 [.422,2.235,.47,1.33,1.09],[.339,2.32,.53,1.68,1.185],
 [.272,2.46,.60,1.99,1.17],[.231,2.59,.69,2.245,1.22],
 [.223,2.705,.79,2.367,1.30],[.255,2.782,.962,2.395,1.40],
 [.239,2.79,1.175,2.434,1.49],[.196,2.744,1.354,2.494,1.55],
 [.124,2.664,1.489,2.528,1.586],[.036,2.614,1.568,2.557,1.60]
];
function skin(row,angle){
 const [w,dy,dz,vy,vz]=row, c=Math.cos(angle),t=(1+Math.sin(angle))*.5;
 const y=vy+(dy-vy)*t,z=vz+(dz-vz)*t;
 // Excavate the orbit under the supraorbital shelf and shape the paired
 // pectorals on either side of the keel in the same continuous skin.
 const orbit=.053*Math.exp(-(((y-2.63)/.068)**2+((z-1.374)/.115)**2));
 const shelfY=2.677-.13*(z-1.29);
 const brow=.056*Math.exp(-(((y-shelfY)/.042)**2+((z-1.34)/.15)**2));
 const pec=.039*Math.exp(-(((y-1.57)/.35)**2+((z-.64)/.26)**2));
 const keel=.039*Math.exp(-((w*c/.095)**2))*Math.exp(-(((y-1.50)/.45)**2+((z-.91)/.27)**2));
 return [(w+pec+brow-orbit)*c*(.94+.09*t),y,z-keel];
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

function bill(lod,stations,lower=false){
 const rows=smoothSections(stations,[4,3,2][lod]),pos=[],idx=[];
 // A median culmen, sloping sides, sharp lateral lip and shallow palate.
 const section=[[0,1],[-.46,.90],[-.80,.62],[-1,.14],[-.96,.015],[-.55,.035],
   [0,0],[.55,.035],[.96,.015],[1,.14],[.80,.62],[.46,.90]];
 for(let i=0;i<rows.length;i++){
   const [z,top,lip,w]=rows[i];
   section.forEach(([x,h],j)=>{
     pos.push(x*w,lip+(top-lip)*(lower?1-h:h),z);
     const a=i*section.length+j,b=i*section.length+(j+1)%section.length;
     if(i)idx.push(a-section.length,b-section.length,a,b-section.length,b,a);
   });
 }
 const last=(rows.length-1)*section.length;
 for(let j=1;j<section.length-1;j++)idx.push(0,j+1,j,last,last+j,last+j+1);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 if(lower)idx.reverse();
 g.setIndex(idx);g.computeVertexNormals();return g;
}

// Low-relief transverse scutes are part of the leg surface. The large
// anterior plates narrow and split into smaller lateral rows at the sides.
function scaledShank(profile,lod){
 const smooth=smoothSections(profile,4),rings=[],pos=[],idx=[],sides=[40,28,16][lod];
 for(let i=0;i<smooth.length-1;i++){
   const a=smooth[i],b=smooth[i+1];
   const n=a[1]<.84?Math.ceil((a[1]-b[1])/[.005,.009,.016][lod]):1;
   for(let j=0;j<n;j++)rings.push(a.map((v,k)=>v+(b[k]-v)*j/n));
 }
 rings.push(smooth.at(-1));
 for(let i=0;i<rings.length;i++){
   const [x,y,z,w,d]=rings[i];
   const zone=Math.max(0,Math.min(1,(y-.13)/.05,(.82-y)/.07));
   for(let j=0;j<sides;j++){
     const a=j*Math.PI*2/sides,c=Math.cos(a),f=Math.sin(a);
     const phase=(y+.012*c*c)/(.043+.004*y)+.48*Math.abs(c)**5;
     const ledge=(.5+.5*Math.cos(2*Math.PI*phase))**3;
     const relief=.0065*zone*ledge*Math.max(.08,f);
     pos.push(x+(w+relief)*c,y,z+(d+relief)*f);
     const k=i*sides+j,q=i*sides+(j+1)%sides;
     if(i)idx.push(k-sides,q-sides,k,q-sides,q,k);
   }
 }
 const last=(rings.length-1)*sides;
 for(let j=1;j<sides-1;j++)idx.push(0,j+1,j,last,last+j,last+j+1);
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setIndex(idx);g.computeVertexNormals();return g;
}

export class Hippogriff extends Specimen {
 constructor(){
   super();
   const body=this.body;
   this.mesh(body,clay,trunk);
   const rows=smoothSections(contour,12),plumes=[];
   // Feather tracts follow the curved skin. Long nape hackles stream
   // caudally, breast feathers converge on the keel and cheek feathers
   // sweep away from the eye. The orbital margin and cere stay bare.
   for(let band=0;band<24;band++){
     const count=band<10?30:band<18?32:34;
     for(let j=0;j<count;j++){
       const phase=Math.sin(j*7.31+band*9.74);
       const angle=2*Math.PI*(j+.48*(band%2)+.22*phase)/count;
       const at=77+band*4.9+1.8*phase;
       const sample=(station,a)=>{
         const i=Math.floor(station),f=station-i;
         return skin(rows[i].map((v,k)=>v+(rows[i+1][k]-v)*f),a);
       };
       const root=sample(at,angle);
       if(root[2]>1.24 && root[1]>2.52 && root[1]<2.72)continue;
       const cheek=band>16, breast=band<10, rear=Math.sin(angle);
       const reach=(cheek?9:breast?8:13)*(1+.19*phase+.18*rear);
       const sweep=(cheek?.37:breast?-.17:.18)*Math.cos(angle);
       const across=new T.Vector3(...sample(at,angle+.015)).sub(new T.Vector3(...sample(at,angle-.015)));
       const along=new T.Vector3(...sample(at+.2,angle)).sub(new T.Vector3(...sample(at-.2,angle)));
       const n=across.cross(along).normalize().toArray();
       const curve=t=>sample(at-reach*t,angle+sweep*t).map((v,k)=>v+n[k]*(-.007+.014*t));
       plumes.push([curve(0),curve(1),(cheek?.027:breast?.061:.047)*(1+.18*phase),n,curve]);
     }
   }
   featherTract(this,body,plumes);
   // Dorsal ridge and broad, nearly straight cutting edges narrow into
   // a downturned tip. The lower bill tucks inside the upper tomium.
   this.mesh(body,clay,lod=>bill(lod,[
     [1.421,2.697,2.541,.146],[1.514,2.695,2.535,.144],
     [1.609,2.675,2.534,.119],[1.704,2.639,2.529,.085],
     [1.77,2.59,2.51,.055],[1.795,2.558,2.482,.040],
     [1.807,2.514,2.454,.026],[1.794,2.457,2.439,.003]]));
   this.mesh(body,clay,lod=>bill(lod,[
     [1.392,2.543,2.462,.139],[1.493,2.535,2.476,.124],
     [1.594,2.529,2.481,.099],[1.702,2.523,2.492,.064],
     [1.758,2.519,2.506,.015]],true));
   for(const s of [-1,1]){
     const eye=joint(body,s*.187,2.625,1.378);eye.rotation.y=s*.97;
     this.oval(eye,0x908f8b,0,0,0,.072,.048,.035);
     this.oval(eye,0x767570,0,.001,.028,.036,.035,.012);
     this.oval(eye,0x54534f,0,.001,.038,.019,.025,.006);
     // Brow and lower orbital rim follow the cheek in depth. The front
     // corner dips over the eye toward the cere.
     this.loft(eye,clay,[[-.072,.004,-.006,.008,.010],[-.035,.036,.008,.012,.013],
       [.023,.038,.012,.011,.013],[.070,.009,-.004,.007,.009]]);
     this.loft(eye,clay,[[-.072,-.003,-.004,.008,.013],[-.038,-.039,.008,.012,.014],
       [.028,-.042,.008,.011,.013],[.074,-.011,-.005,.007,.009]]);
     const naris=this.oval(body,0x84837d,s*.116,2.621,1.568,.011,.011,.033);
     naris.rotation.z=-s*.53;
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
   this.loft(leg,clay,[[0,1.89,-.94,.109,.174],[s*.012,1.65,-.92,.185,.304],
    [s*.034,1.39,-.874,.195,.287],[s*.035,1.14,-.744,.152,.204],[s*.04,1.014,-.694,.117,.139],
    [s*.03,.841,-.856,.104,.128],[s*.025,.68,-1.008,.075,.092],[s*.026,.60,-1.075,.068,.09],[s*.024,.546,-1.043,.056,.064],
    [s*.024,.496,-1.015,.048,.057],[s*.025,.269,-1.001,.041,.049],
    [s*.021,.195,-.988,.058,.067],[s*.019,.127,-.94,.047,.061]]);
   this.loft(leg,clay,[[s*.02,.168,-.96,.048,.066],[s*.02,.124,-.934,.063,.084],
    [s*.02,.047,-.903,.079,.107],[s*.02,.013,-.898,.081,.113]], [0,-1,0]);
 }
 foreLeg(s){
   const leg=joint(this.body,s*.278,0,s*.065);
   const profile=[[-s*.038,1.93,.37,.115,.19],[0,1.69,.48,.201,.242],
    [s*.028,1.39,.58,.183,.207],[s*.044,1.16,.49,.144,.171],
    [s*.046,.986,.432,.111,.127],[s*.047,.84,.48,.086,.100],
    [s*.05,.681,.539,.080,.088],[s*.06,.45,.606,.067,.071],
    [s*.07,.221,.665,.063,.071],[s*.07,.114,.70,.084,.100]];
   this.mesh(leg,clay,lod=>scaledShank(profile,lod));
   const foot=joint(leg,s*.07,.0,.70);
   this.oval(foot,clay,0,.093,.020,.106,.072,.131);
   for(const [x,z,girth] of [[-.195,.284,1.12],[.009,.385,1],[.208,.271,.86],[-.078,-.224,1.25]]){
     const toe=joint(foot);toe.rotation.y=Math.atan2(s*x,z);
     const d=Math.hypot(x,z);
     this.loft(toe,clay,[[0,.106,.01,.053,.052],[0,.091,d*.23,.051,.051],
       [0,.077,d*.38,.040,.040],[0,.087,d*.51,.044,.047],
       [0,.064,d*.66,.032,.032],[0,.078,d*.79,.038,.037]]
       .map(([x,y,z,w,h])=>[x,y,z,w*girth,h*girth]));
     this.loft(toe,clay,[[0,.084,d*.75,.036,.032],[0,.099,d*.86,.035,.041],
       [0,.087,d*.99,.028,.032],[0,.061,d*1.075,.020,.024],
       [0,.030,d*1.10,.010,.015],[0,.009,d*1.07,.002,.004]]
       .map(([x,y,z,w,h])=>[x,y,z,w*girth,h*girth]));
   }
 }
 update(dt,t,action){
   const pose=action==='Unfold'?this.extended:this.folded;
   if(this.pose===pose)return;
   this.folded.removeFromParent();this.extended.removeFromParent();
   this.body.add(pose);this.pose=pose;
 }
}
