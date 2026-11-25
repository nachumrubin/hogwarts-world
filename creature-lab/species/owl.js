import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';
import {feather,plumage} from './avian.js';
import {owlWing} from './owl-wing.js';
import {plumageMap} from './owl-plumage.js';

const clamp=T.MathUtils.clamp;
const smooth=t=>{t=clamp(t,0,1);return t*t*(3-2*t)};
const cream=0xf1e5d1;
export const actions={Perch:'Perched idle',Look:'Track target',Unfold:'Unfold wings',Fold:'Fold wings',Takeoff:'Leave perch',Fly:'Powered flight',Glide:'Glide',Bank:'Bank and turn',Land:'Land and grip'};

// A shallow continuous radial surface. Both orbital hollows, the medial
// ridge and the lower point belong to one disc, with no loose eye cards.
function disc(level){
  const n=[96,64,40][level],rings=[28,18,11][level],p=[],uv=[],idx=[];
  for(let j=0;j<=rings;j++)for(let i=0;i<=n;i++){
    const r=j/rings,t=i/n*2*Math.PI,s=Math.sin(t),c=Math.cos(t);
    const x=.057*r*s*(.96+.18*c);
    const y=.050*r*c-r*.012*Math.exp(-13*s*s)*Math.max(0,c)-r*.003*Math.max(0,-c)**6;
    const hollow=Math.exp(-(((Math.abs(x)-.022)/.016)**2+((y-.008)/.017)**2));
    const bridge=.010*Math.exp(-((x/(.002+.009*clamp((y+.014)/.044,0,1)))**2)) * smooth((y+.022)/.017);
    const z=bridge+.044-.012*(x/.059)**2-.005*r*r-.012*r**4-.005*hollow+.0016*Math.exp(-(((r-.93)/.075)**2));
    p.push(x,y,z);uv.push(.25+.244*r*s,.5+.49*r*c);
    if(i&&j){const a=j*(n+1)+i;idx.push(a-n-2,a-1,a,a-n-2,a,a-n-1)}
  }
  // Roll the outer feathers around the cheek into the crown and throat.
  // This closes the profile even when the lower heart is seen edge-on.
  const edge=rings*(n+1);
  for(let row=0;row<=8;row++)for(let i=0;i<=n;i++){
    const k=(edge+i)*3,u=row/8;
    const taper=1-.30*u*u;
    p.push(p[k]*taper,p[k+1]*taper+.002*u,p[k+2]*(1-u)-.030*u);
    uv.push(.503+.494*i/n,.004+.99*u);
    if(i&&row){const a=edge+(row+1)*(n+1)+i;idx.push(a-n-2,a-1,a,a-n-2,a,a-n-1)}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}

function foot(owl,s){
  const ankle=joint(owl.body,s*.021,.083,-.001);
  owl.loft(ankle,cream,[[0,.045,-.012,.009,.012],[0,.016,-.011,.018,.022],[0,-.012,-.006,.014,.016],[0,-.033,.003,.008,.010],[0,-.064,.012,.0045,.005]]);
  const legPlumes=[];
  for(let i=0;i<16;i++){
    const a=i*Math.PI/8,x=Math.cos(a),z=Math.sin(a);
    legPlumes.push([[x*.014,-.008,-.005+z*.015],[x*.007,-.041+.003*Math.cos(a*3),.006+z*.007],.004,[x,0,z]]);
  }
  plumage(owl,ankle,0xe7dbca,legPlumes);
  const pad=joint(ankle,0,-.065,.012),toes=[];
  owl.oval(pad,0xbba89c,0,0,0,.008,.005,.010);
  for(const [yaw,length] of [[-.38,.033],[.31,.038],[2.58,.032],[-2.87,.028]]){
    const toe=joint(pad);toe.rotation.y=yaw*s;
    const knuckle=joint(toe);
    owl.loft(knuckle,0xb8a496,[[0,0,0,.0038,.0035],[0,.001,length*.25,.0035,.003],[0,0,length*.48,.003,.003]]);
    const tip=joint(knuckle,0,0,length*.43);
    owl.loft(tip,0xa58f80,[[0,0,0,.0033,.003],[0,0,length*.23,.003,.003],[0,-.001,length*.43,.0024,.002]]);
    owl.loft(tip,0x4b4038,[[0,.0005,length*.33,.0029,.0029],[0,-.001,length*.53,.0025,.0024],[0,-.005,length*.64,.0017,.0015],[0,-.012,length*.63,.0002,.0002]]);
    toes.push([knuckle,tip]);
  }
  return (air,grip)=>{ankle.rotation.x=air*.95;for(const [a,b] of toes){a.rotation.x=.03+.22*grip;b.rotation.x=.04+.68*grip}};
}

export class Owl extends Specimen{
  constructor(){
    super();this.maps=['body','crown','disc','vane','mantle'].map(plumageMap);
    const torso=this.oval(this.body,0xfffffe,0,.148,-.020,.062,.116,.060);
    torso.rotation.x=.55;torso.material.map=this.maps[0];
    const contours=[];
    // Short shingles follow the ellipsoid meridians. Place the shafts
    // inside the surface so only the soft distal hems break silhouette.
    for(let row=0;row<6;row++)for(let i=0;i<36;i++){
      const a=(i+.5*(row%2))*Math.PI/18,lat=.96+row*.25;
      const point=(l,r)=>[.062*Math.sin(l)*Math.cos(a)*r,.116*Math.cos(l),.060*Math.sin(l)*Math.sin(a)*r];
      contours.push([point(lat,.98),point(lat+.34,1.007),.006,[Math.cos(a),.16,Math.sin(a)]]);
    }
    const groom=joint(this.body,0,.148,-.020);groom.rotation.x=.55;
    const pale=contours.filter(v=>v[3][2]>.0);
    plumage(this,groom,0xeae0cc,pale);
    this.tail=joint(this.body,0,.106,-.055);this.rectrices=[];
    for(let i=0;i<12;i++){
      const t=(i-5.5)/5.5,shaft=joint(this.tail,t*.012,-.002*Math.abs(t),0);
      const blade=feather(this,shaft,0xd4b48b,[0,0,0],[0,-.062,-.096+.009*t*t],.011,[0,1,-.6]);
      this.rectrices.push({shaft,t});blade.rotation.z=.03*t;
    }
    this.neck=joint(this.body,0,.209,.012);this.atlas=joint(this.neck,0,.022,.006);
    this.head=joint(this.atlas,0,.017,.004);
    this.oval(this.head,0xfffefd,0,.001,-.007,.059,.054,.043).material.map=this.maps[1];
    this.mesh(this.head,0xfffeff,disc).material.map=this.maps[2];
    this.eyes=[];
    for(const s of [-1,1]){
      const orbit=joint(this.head,s*.022,.008,.0357);orbit.rotation.y=s*.20;
      this.oval(orbit,0x49372e,0,0,0,.0093,.010,.004);
      const eye=this.oval(orbit,0x191516,0,.0001,.002,.0078,.0079,.0040);
      eye.material.roughness=.24;const lid=this.oval(orbit,0x58473a,0,-.005,.002,.0083,.0092,.0049);this.eyes.push(lid);
    }
    this.loft(this.head,0xc8b69f,[[0,.004,.042,.0055,.005],[0,-.003,.047,.005,.005],[0,-.010,.049,.0032,.003],[0,-.016,.046,.0005,.0006]]);
    this.fineCoverts=[];this.wings=[-1,1].map(s=>owlWing(this,s,this.maps[3]));this.feet=[-1,1].map(s=>foot(this,s));
    this.open=0;this.air=0;this.bank=0;this.yaw=0;this.pitch=0;this.phase=0;this.route=0;
    this.update(0,0,'Perch');
  }
  update(dt,t,action,context={}){
    if(action!==this.action){this.action=action;this.elapsed=0;this.startAir=this.air;this.startOpen=this.open;
      this.approachStart=this.route;this.approachDuration=clamp((2*Math.PI-this.route)/1.18,1.30,2.12);
    }
    this.elapsed+=dt;
    const e=this.elapsed,launch=action==='Takeoff';
    const land=action==='Land'||(['Perch','Fold','Look','Unfold'].includes(action)&&this.startAir>.03);
    const progress=clamp(e/this.approachDuration,0,1);
    const flying=['Fly','Glide','Bank'].includes(action),tracking=action==='Look';
    const targetAir=land?this.startAir*(1-smooth((progress-.34)/.66)):launch?this.startAir+(1-this.startAir)*smooth((e-.25)/.98):Number(flying);
    const targetOpen=launch?this.startOpen+(1-this.startOpen)*smooth(e/.56):land?this.startOpen+(Number(action==='Unfold')-this.startOpen)*smooth((e-this.approachDuration+.06)/.79):Number(flying||action==='Unfold');
    const blend=1-Math.exp(-dt*5);
    this.air+=(targetAir-this.air)*(launch||land?1:blend);
    this.open+=(targetOpen-this.open)*(launch||land?1:blend);
    this.bank+=((action==='Bank'?.48*Math.sin(.86*e):0)-this.bank)*blend;
    // A level circuit carries the specimen through the roost. Landing
    // completes the current arc and decelerates into the original perch.
    if(land&&this.approachStart>0){
      const u=progress*(2-progress);
      this.route=progress===1?0:this.approachStart+(2*Math.PI-this.approachStart)*u;
    }else if(launch||flying)this.route=(this.route+dt*this.air*(action==='Bank'?1.18:.94))%(2*Math.PI);
    else this.route=0;
    this.root.rotation.y=this.route;
    this.root.position.copy(this.origin);
    this.root.position.x+=2.4*(1-Math.cos(this.route));
    this.root.position.z+=2.4*Math.sin(this.route);
    this.root.position.y+=this.air*.42*Math.sin(this.route*.5);
    this.phase+=dt*Math.PI*2*(2.55+.09*Math.sin(t*.9));
    const powered=action==='Fly'||launch||land;
    const stroke=powered?Math.sin(this.phase)*.48:this.bank*.055;
    const recovery=powered?(1+Math.cos(this.phase))/2:0;
    const squat=launch?.018*Math.sin(Math.PI*clamp(e/.36,0,1)):0;
    this.body.rotation.set(this.air*.96,this.bank*.66,this.bank,'YXZ');
    this.body.position.set(this.bank*.08,this.air*.31-squat+.0013*Math.sin(t*2.1)+this.air*(powered?.007*Math.cos(this.phase):0),this.air*.12);
    this.body.scale.y=1+.004*Math.sin(t*2.1);
    let yaw=.075*Math.sin(t*.75),pitch=.025*Math.sin(t*.93);
    if(tracking){
      const target=context.stimulus||context.playerPosition;
      if(target){const dx=target.x-this.root.position.x,dz=target.z-this.root.position.z;
        const bearing=Math.atan2(dx,dz)-this.route;
        yaw=clamp(Math.atan2(Math.sin(bearing),Math.cos(bearing)),-2.05,2.05);pitch=-clamp(Math.atan2(target.y-this.root.position.y-.25,Math.hypot(dx,dz)),-.45,.45);
      }else yaw=1.05*Math.tanh(2*Math.sin(t*1.12));
    }
    this.yaw+=(yaw-this.yaw)*blend;this.pitch+=(pitch-this.pitch)*blend;
    const tilt=(tracking?.19:.035)*Math.sin(1.27*t);
    for(const [node,share] of [[this.neck,.35],[this.atlas,.38],[this.head,.27]])
      node.rotation.set((this.pitch-this.air*.88)*share,this.yaw*share,tilt*share-this.bank*.45*share,'YXZ');
    const blink=Math.min(1,Math.abs((t+1.37)%3.89-.15)/.085);
    for(const lid of this.eyes){lid.scale.y=.0092*(1-.97*smooth(blink));lid.position.y=-.0086*smooth(blink)}
    this.wings.forEach((pose,i)=>pose(this.open,this.open*(stroke+(i?1:-1)*this.bank*.24),recovery,this.body.rotation.x));
    this.tail.rotation.set(-.20*this.air-(land?.24*this.air:0),this.bank*.42,0);
    for(const {shaft,t:spread} of this.rectrices)shaft.rotation.y=-spread*(.16+this.air*(land?.48:.22)+Math.abs(this.bank)*.3);
    const grip=land?smooth((progress-.88)/.12):launch?1-smooth((e-.16)/.16):1-this.air;
    this.feet.forEach(pose=>pose(this.air*(land?smooth((.72-progress)/.47):1),grip));
  }
  setLOD(level){
    super.setLOD(level);
    for(const mesh of this.fineCoverts)mesh.visible=level<2;
  }
  dispose(){this.maps.forEach(m=>m.dispose());super.dispose()}
}
