import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';

export class Merperson extends Specimen {
  constructor(){
    super();
    const hide=0x577773,ventral=0x8c9e88,fin=0x556956,crest=0x434f38;
    const b=this.body;b.position.y=1.25;
    this.loft(b,hide,[[0,-.35,-.42,.19,.18],[0,-.27,-.30,.24,.21],[0,-.12,-.15,.27,.23],[0,.10,.01,.32,.25],[0,.30,.12,.42,.28],[0,.43,.17,.41,.24],[0,.51,.22,.28,.18],[0,.61,.30,.21,.16]]);
    const h=this.head=joint(b,0,.55,.27);
    this.loft(h,hide,[[0,-.06,-.04,.16,.16],[0,.02,.04,.222,.20],[0,.13,.075,.253,.20],[0,.23,.035,.242,.194],[0,.33,-.018,.178,.15],[0,.36,-.04,.105,.098]]);
    this.oval(h,ventral,0,.04,.214,.162,.068,.076);
    this.oval(h,0x3c504a,0,.080,.278,.133,.013,.016);
    this.arms=[];
    for(const s of [-1,1]){
      this.oval(h,0xbcac55,s*.153,.185,.21,.063,.049,.038);
      this.oval(h,0x202b27,s*.157,.186,.245,.018,.033,.009);
      this.oval(h,hide,s*.153,.224,.194,.093,.031,.053).rotation.z=s*.23;
      for(let j=0;j<3;j++){
        this.loft(h,fin,[[s*.166,.18-j*.063,.12,.029,.036],[s*.24,.17-j*.068,.05,.035,.047],[s*.30,.145-j*.065,-.067,.029,.045],[s*.34,.12-j*.068,-.16,.006,.008]]);
      }
      const arm=joint(b,s*.335,.365,.11);this.arms.push(arm);
      this.loft(arm,hide,[[0,.08,0,.103,.128],[s*.09,.005,-.015,.136,.14],[s*.17,-.14,-.09,.088,.09],[s*.24,-.30,-.16,.067,.075],[s*.27,-.36,-.085,.083,.098],[s*.32,-.45,.07,.065,.078],[s*.33,-.52,.17,.048,.054]]);
      const hand=joint(arm,s*.33,-.53,.185);
      this.oval(hand,ventral,0,-.028,.019,.082,.05,.078);
      const fingers=[];
      for(let i=0;i<5;i++){
        const x=s*(i-2)*.033,dx=x*1.85,z=.17-.028*Math.abs(i-2);
        this.loft(hand,ventral,[[x,0,.04,.019,.021],[dx,-.06,z,.016,.018],[dx*1.24,-.10,z+.043,.009,.012],[dx*1.27,-.109,z+.05,.003,.004]]);
        fingers.push([dx,-.06,z]);
      }
      this.mesh(hand,fin,()=>{
        const p=[],idx=[];
        for(let i=0;i<4;i++){p.push(0,-.02,.05,...fingers[i],(fingers[i][0]+fingers[i+1][0])/2,-.048,(fingers[i][2]+fingers[i+1][2])*.40,...fingers[i+1]);const k=i*4;idx.push(k,k+1,k+2,k,k+2,k+3)}
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(idx);g.computeVertexNormals();return g;
      });
    }
    for(let i=-3;i<=3;i++){
      const x=i*.057;
      this.loft(h,crest,[[x,.27,-.01,.046,.064],[x*1.06,.37,-.09,.046,.07],[x*1.15,.40,-.20,.039,.055],[x*1.21,.34,-.37+Math.abs(i)*.024,.009,.015]]);
    }
    const tail=this.loft(b,hide,[[0,-.19,-.28,.23,.20],[0,-.32,-.43,.225,.21],[0,-.46,-.66,.212,.186],[0,-.56,-.95,.164,.148],[0,-.59,-1.23,.106,.12],[0,-.59,-1.51,.064,.094],[0,-.57,-1.77,.042,.070]]);
    this.flex=[tail];
    for(const [dy,end] of [[.45,-2.34],[-.33,-2.17]]){
      this.flex.push(this.loft(b,fin,[[0,-.586,-1.57,.049,.075],[0,-.57+dy*.17,-1.74,.054,.135],[0,-.57+dy*.43,-1.91,.043,.139],[0,-.57+dy*.79,end+.15,.025,.084],[0,-.57+dy,end,.003,.01]]));
    }
    this.rest=new WeakMap();this.heading=0;
  }
  update(dt,t,action){
    this.lastPose=[t,action];
    const fast=action==='Swim',turn=action==='Turn';
    this.body.position.y=1.25+.046*Math.sin(t*1.55);
    if(fast||turn){
      const rate=turn?.86:.24;this.heading+=dt*rate;
      const step=dt*(fast?.48:.16);
      this.root.position.x+=step*Math.sin(this.heading);this.root.position.z+=step*Math.cos(this.heading);
    }
    this.body.rotation.y=this.heading+.035*Math.sin(2*t);
    this.body.rotation.x=.045*Math.sin(1.6*t)+(fast?.11:0);
    this.head.rotation.y=.09*Math.sin(1.15*t);
    this.arms.forEach((arm,i)=>{arm.rotation.x=(fast?.29:.13)*Math.sin(t*2.5+i*.8);arm.rotation.z=(i?1:-1)*.12*Math.cos(t*2)});
    for(const mesh of this.flex){
      const g=mesh.geometry,p=g.attributes.position;
      if(!this.rest.has(g))this.rest.set(g,p.array.slice());
      const rest=this.rest.get(g);
      for(let i=0;i<p.count;i++){
        const z=rest[i*3+2],u=Math.max(0,(-z-.30)/2);
        p.setX(i,rest[i*3]+u*u*(fast?.49:.25)*Math.sin(t*(fast?5:2.5)-u*4));
      }
      p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingSphere();
    }
  }
  setLOD(level){super.setLOD(level);if(this.lastPose)this.update(0,...this.lastPose)}
}
