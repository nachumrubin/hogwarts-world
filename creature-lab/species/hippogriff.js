import * as T from '../vendor/three.module.js';
import {Specimen,joint,smoothSections,sweep} from './form.js';
import {plantarSkin} from './hippogriff-foot.js';
import {hindProfile} from './equine-gait.js';
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
 [.246,2.736,.765,2.355,1.30],[.278,2.827,.95,2.38,1.42],
 [.260,2.827,1.17,2.415,1.50],[.218,2.774,1.38,2.477,1.565],
 [.124,2.664,1.489,2.528,1.586],[.036,2.614,1.568,2.557,1.60]
];
function skin(row,angle){
 const [w,dy,dz,vy,vz]=row, c=Math.cos(angle),t=(1+Math.sin(angle))*.5;
 const y=vy+(dy-vy)*t,z=vz+(dz-vz)*t;
 // Excavate the orbit under the supraorbital shelf and shape the paired
 // pectorals on either side of the keel in the same continuous skin.
 const orbit=.074*Math.exp(-(((y-2.63)/.068)**2+((z-1.374)/.115)**2));
 const shelfY=2.700-.24*(z-1.29);
 const brow=.074*Math.exp(-(((y-shelfY)/.042)**2+((z-1.34)/.15)**2));
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
 const rows=smoothSections(stations,[8,4,2][lod]),pos=[],idx=[];
 // A median culmen, sloping sides, sharp lateral lip and shallow palate.
 const corners=[[0,1],[-.46,.90],[-.80,.62],[-1,.14],[-.96,.015],[-.55,.035],
   [0,0],[.55,.035],[.96,.015],[1,.14],[.80,.62],[.46,.90]];
 const section=smoothSections([...corners,corners[0]],[3,2,1][lod]).slice(0,-1);
 for(let i=0;i<rows.length;i++){
   const [z,top,lip,w]=rows[i];
   const t=i/(rows.length-1);
   // Rotate sections progressively around the culmen, independently of
   // radius interpolation; the outline stays smooth through the hook.
   const bend=Math.max(0,Math.min(1,(t-.33)/.67));
   const tilt=lower?0:1.91*bend*bend*(3-2*bend);
   section.forEach(([x,h],j)=>{
     const rise=(top-lip)*((lower?1-h:h)-.5);
     const y=(top+lip)*.5+rise*Math.cos(tilt),depth=z+rise*Math.sin(tilt);
     const nostril=lower?0:Math.exp(-(((y-2.648)/.014)**2+((depth-1.563)/.029)**2));
     pos.push(x*(w-.023*nostril),y,depth);
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

// Rounded polygonal shields are draped over the limb surface. Each
// shield has its own boundary and a raised distal lip.
function scalePlates(actor,parent,plates){
 actor.mesh(parent,clay,lod=>{
   const pos=[],idx=[],steps=[12,10,8][lod];
   for(const surface of plates){
     const start=pos.length/3;
     pos.push(...surface(0,0,.006));
     for(const radius of [.76,1]){
       for(let i=0;i<steps;i++){
         const angle=2*Math.PI*i/steps,c=Math.cos(angle),d=Math.sin(angle);
         const u=Math.sign(c)*Math.abs(c)**.77*radius;
         const v=Math.sign(d)*Math.abs(d)**.79*radius;
         pos.push(...surface(u,v,radius===1?.0009:.0047-.0016*v));
       }
     }
     for(let i=0;i<steps;i++){
       const a=start+1+i,b=start+1+(i+1)%steps;
       idx.push(start,a,b,a,a+steps,b,b,a+steps,b+steps);
     }
   }
   const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
   g.setIndex(idx);g.computeVertexNormals();return g;
 });
}
function legSurface(profile,y,angle,offset=0){
 let i=1;
 while(i<profile.length-1 && y<profile[i][1])i++;
 const a=profile[i-1],b=profile[i],t=Math.max(0,Math.min(1,(y-a[1])/(b[1]-a[1])));
 const [x,,z,w,d]=a.map((v,k)=>v+(b[k]-v)*t);
 return [x+(w+offset)*Math.sin(angle),y,z+(d+offset)*Math.cos(angle)];
}

// Rounded bundles give the hanging switch volume. Narrow peripheral
// strands follow the same dock, part in small groups, and taper separately.
function tailHair(lod){
 const pos=[],uv=[],idx=[],sides=[8,6,5][lod],steps=[18,13,9][lod];
 const count=[87,61,39][lod];
 for(let i=0;i<count;i++){
   const a=i*2.39996323,radial=Math.sqrt((i+.5)/count);
   const phase=Math.sin(i*11.37),length=1.39-.18*radial+.10*Math.cos(a*3)+.085*phase;
   const bundle=i%4===0?.043:.019;
   for(let j=0;j<=steps;j++){
     const t=j/steps,fan=.034+.120*Math.sin(Math.PI*t**.82)**.68;
     const angle=a+.26*t*Math.sin(a*3)+.11*Math.sin(t*4+a);
     const x=radial*fan*Math.cos(angle)+.085*Math.sin(5*t)*t+.080*t*t+.017*t*Math.sin(6*t+a)+.021*t*t*Math.sin(2*a);
     const y=1.81-length*t;
     const z=-1.10-.42*(1-Math.exp(-t*5))-.15*t*t-.045*Math.sin(2*Math.PI*t)*t+radial*fan*Math.sin(angle)+.024*t*t*Math.cos(a*3);
     const w=bundle*(.32+.72*Math.sin(Math.PI*t**.65)**.57)*(1-.80*t**3)*(1+.15*phase);
     for(let k=0;k<=sides;k++){
       const theta=2*Math.PI*k/sides;
       pos.push(x+w*Math.cos(theta),y,z+w*.81*Math.sin(theta));
       uv.push(k/sides,t,2);
       if(j&&k){const n=pos.length/3-1,prev=n-(sides+1);
         idx.push(prev-1,prev,n-1,prev,n,n-1);}
     }
   }
 }
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
 g.setAttribute('clayDetail',new T.Float32BufferAttribute(uv,3));g.setIndex(idx);g.computeVertexNormals();
 const n=g.attributes.normal,seam=new T.Vector3(),other=new T.Vector3();
 for(let j=0;j<n.count;j+=sides+1){
   seam.fromBufferAttribute(n,j).add(other.fromBufferAttribute(n,j+sides)).normalize();
   n.setXYZ(j,seam.x,seam.y,seam.z);n.setXYZ(j+sides,seam.x,seam.y,seam.z);
 }
 return g;
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
       const at=76+band*5.15+1.8*phase;
       const sample=(station,a)=>{
         const i=Math.floor(station),f=station-i;
         return skin(rows[i].map((v,k)=>v+(rows[i+1][k]-v)*f),a);
       };
       const root=sample(at,angle);
       if(root[2]>1.24 && root[1]>2.52 && root[1]<2.72)continue;
       const cheek=band>16, breast=band<10, rear=Math.sin(angle);
       const reach=(cheek?12:breast?10:15)*(1+.19*phase+.18*rear);
       const sweep=(cheek?.37:breast?-.17:.18)*Math.cos(angle);
       const across=new T.Vector3(...sample(at,angle+.015)).sub(new T.Vector3(...sample(at,angle-.015)));
       const along=new T.Vector3(...sample(at+.2,angle)).sub(new T.Vector3(...sample(at-.2,angle)));
       const n=across.cross(along).normalize().toArray();
       const curve=t=>sample(at-reach*t,angle+sweep*t).map((v,k)=>
         v+n[k]*(-.005+(.022+.020*Math.max(0,rear)+.007*phase)*t**1.3));
       plumes.push([curve(0),curve(1),(cheek?.027:breast?.061:.047)*(1+.18*phase),n,curve]);
     }
   }
   // Narrow superciliary feathers sweep from the cere along the orbital
   // shelf. Their tips continue into the broader temple and nape tract.
   const temple=[];
   for(let i=153;i<199;i++)for(let j=-15;j<30;j++){
     const angle=j*.045;
     temple.push({i,angle,p:skin(rows[i],angle)});
   }
   for(const side of [-1,1]){
     for(let j=0;j<15;j++){
       const t=j/14,z=1.52-.36*t,y=2.682+.086*t;
       const nearest=temple.reduce((best,q)=>Math.hypot(q.p[1]-y,q.p[2]-z)<
         Math.hypot(best.p[1]-y,best.p[2]-z)?q:best);
       const curve=u=>{
         const f=nearest.i-u*(8+6*t),i=Math.floor(f),v=f-i;
         const p=skin(rows[i].map((n,k)=>n+(rows[i+1][k]-n)*v),nearest.angle+.10*u);
         return [side*(p[0]-.006+.011*u),p[1]+.011*u,p[2]-.035*u*u];
       };
       plumes.push([curve(0),curve(1),.022+.011*t,[side*.84,.54,0],curve]);
     }
   }
   featherTract(this,body,plumes);
   // Dorsal ridge and broad, nearly straight cutting edges narrow into
   // a downturned tip. The lower bill tucks inside the upper tomium.
   this.mesh(body,clay,lod=>bill(lod,[
     [1.408,2.729,2.527,.151],[1.517,2.728,2.517,.156],
     [1.619,2.704,2.517,.143],[1.714,2.661,2.509,.118],
     [1.779,2.607,2.467,.087],[1.815,2.547,2.420,.063],
     [1.823,2.477,2.385,.038],[1.811,2.411,2.366,.016],
     [1.790,2.366,2.354,.002]]));
   this.mesh(body,clay,lod=>bill(lod,[
     [1.395,2.546,2.457,.139],[1.515,2.537,2.459,.139],
     [1.629,2.534,2.474,.115],[1.719,2.514,2.468,.078],
     [1.770,2.490,2.469,.020]],true));
   for(const s of [-1,1]){
     const eye=joint(body,s*.192,2.634,1.386);eye.rotation.y=s*.95;eye.name="orbit";
     this.oval(eye,0x908f8b,0,0,0,.079,.055,.037);
     this.oval(eye,0x74716a,0,.001,.031,.044,.043,.014);
     this.oval(eye,0x373632,0,.001,.043,.022,.026,.007);
     // Brow and lower orbital rim follow the cheek in depth. The front
     // corner dips over the eye toward the cere.
     this.loft(eye,clay,[[-.072,.004,-.006,.008,.010],[-.035,.036,.008,.012,.013],
       [.023,.038,.012,.011,.013],[.070,.009,-.004,.007,.009]]);
     this.loft(eye,clay,[[-.072,-.003,-.004,.008,.013],[-.038,-.039,.008,.012,.014],
       [.028,-.042,.008,.011,.013],[.074,-.011,-.005,.007,.009]]);
     // The commissure curves into feathered cheek behind the cere.
     this.loft(body,clay,[[s*.180,2.532,1.324,.009,.009],[s*.157,2.518,1.414,.015,.014],
       [s*.144,2.514,1.51,.012,.012],[s*.126,2.509,1.602,.006,.008]]);
     const naris=this.oval(body,0x84837d,s*.115,2.648,1.563,.009,.012,.024);
     naris.rotation.z=-s*.53;
     this.hindLeg(s);
     this.foreLeg(s);
   }
   this.mesh(body,clay,lod=>tailHair(lod)).name="tail";
   this.folded=buildWing(this,false);this.extended=buildWing(this,true);
   this.update(0,0,'Idle');
 }
 hindLeg(s){
   const leg=joint(this.body,s*.29,0,s*.058);leg.name="hind";
   // Use the centaur's rest profile from hip through the coronet,
   // fitted under the existing croup and the staggered C.3 stance.
   const rows=hindProfile.map(([y,z,w,d,offset])=>{
     const thigh=Math.max(0,Math.min(1,(y-.93)/.58));
     // Add volume through the thigh and taper it into the hip and stifle.
     const fullness=y<=1.055||y>=1.84?0:Math.sin(Math.PI*(y-1.055)/.785)**2;
     return [s*(.03+offset),y,z-.222,
       w*(1.08+.15*thigh)*(1+.18*fullness),d*(1.07+.22*thigh)*(1+.30*fullness)];
   });
   this.mesh(leg,clay,lod=>{
     const geom=sweep(rows,[36,24,14][lod],new T.Vector3(0,-1,0));
     const attr=geom.attributes.position;
     // Paired gaskin bellies, a lean Achilles line behind the hock,
     // and long digital flexors descending the back of the cannon.
     for(let i=0;i<attr.count;i++){
       const y=attr.getY(i),z=attr.getZ(i);
       let k=1;
       while(k<rows.length-1 && rows[k][1]>y)k++;
       const a=rows[k-1],b=rows[k],t=Math.max(0,Math.min(1,(y-a[1])/(b[1]-a[1])));
       const station=a.map((v,j)=>v+(b[j]-v)*t);
       const side=(attr.getX(i)-station[0])/station[3],back=(station[2]-z)/station[4];
       const lump=(v,w)=>Math.exp(-(v*v)/(w*w));
       const volume=.037*lump(y-1.35,.29)*lump(back+.38,.52)
         +.020*lump(y-.89,.16)*lump(back-.4,.46)+.009*lump(y-.41,.16)*lump(back-.58,.24);
       attr.setX(i,attr.getX(i)+side*volume);
     }
     geom.computeVertexNormals();return geom;
   });
   this.loft(leg,clay,[[s*.03,.117,-.920,.054,.067],[s*.03,.097,-.912,.064,.076],
     [s*.03,.076,-.904,.068,.082],[s*.03,.023,-.883,.083,.109],
     [s*.03,.013,-.880,.082,.110]],[0,-1,0]);

 }
 foreLeg(s){
   const leg=joint(this.body,s*.278,0,s*.065);leg.name="fore";
   const profile=[[-s*.038,1.93,.37,.115,.19],[0,1.69,.48,.201,.242],
    [s*.028,1.39,.58,.183,.207],[s*.044,1.16,.49,.144,.171],
    [s*.046,.986,.432,.111,.127],[s*.047,.84,.48,.086,.100],
    [s*.05,.681,.539,.080,.088],[s*.06,.45,.606,.067,.071],
    [s*.07,.221,.665,.063,.071],[s*.07,.114,.70,.084,.100]];
   this.loft(leg,clay,profile,[0,-1,0]);
   const sections=smoothSections(profile,5),plates=[],upper=[];
   for(let band=0;band<12;band++){
     const t=band/11,y=.166+.64*t**1.12,phase=Math.sin(band*2.41);
     plates.push((u,v,h)=>legSurface(sections,y+v*(.026+.010*t)+.011*u*u+.003*u*phase,u*(.88+.14*t)+.13*phase,h));
   }
   // Small staggered reticulate scales occupy the sides and back.
   for(let row=0;row<21;row++){
     for(let j=0;j<10;j++){
       const angle=1.05+((j+.5*(row%2))/10)*4.13;
       const y=.166+row*.032+.004*Math.sin(j*2.32+row);
       plates.push((u,v,h)=>legSurface(sections,y+.018*v,angle+.25*u,h*.67));
     }
   }
   scalePlates(this,leg,plates);
   // Overlapping contour feathers descend from the deltoid and triceps
   // and break into a short cuff where the bare tarsus emerges.
   for(let band=0;band<9;band++){
     const y=.97+band*.105,count=band<3?13:16;
     for(let i=0;i<count;i++){
       const phase=Math.sin(i*2.84+band*1.31);
       const angle=2*Math.PI*(i+.48*(band%2)+.12*phase)/count;
       const curve=t=>legSurface(sections,y-t*(.17+.055*band/8+.029*phase),
         angle+.15*s*t,-.003+.024*t*t);
       upper.push([curve(0),curve(1),(.046+band*.0017)*(1+.12*phase),
         [Math.sin(angle),.13,Math.cos(angle)],curve]);
     }
   }
   featherTract(this,leg,upper);
   const foot=joint(leg,s*.07,0,.70);foot.name="talons";
   foot.scale.x=s;
   this.mesh(foot,clay,plantarSkin);

 }
 update(dt,t,action){
   const pose=action==='Unfold'?this.extended:this.folded;
   if(this.pose===pose)return;
   this.folded.removeFromParent();this.extended.removeFromParent();
   this.body.add(pose);this.pose=pose;
 }
}
