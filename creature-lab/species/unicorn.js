import {Specimen,joint} from './form.js';
import {equine} from './equine.js';

export class Unicorn extends Specimen {
  constructor(){
    super();
    const coat=0xd7cfc2,hair=0xaba392,muzzle=0xb5a89b;
    this.horse=equine(this,{coat,hair,hoof:0x665d54,slender:.87,length:1.08});
    const n=this.neck=joint(this.horse.base,0,1.57,.65);
    this.loft(n,coat,[[0,-.12,-.06,.30,.33],[0,.14,.095,.29,.36],[0,.37,.23,.225,.30],[0,.59,.37,.165,.23],[0,.78,.49,.122,.166],[0,.85,.53,.116,.12]]);
    for(let i=0;i<9;i++){
      const t=i/9;
      this.loft(n,hair,[[0,.18+t*.68,-.17+t*.60,.052,.095],[-.068,.19+t*.68,-.19+t*.60,.075,.1],[-.14,.08+t*.68,-.17+t*.60,.064,.085],[-.16,-.04+t*.68,-.15+t*.60,.009,.016]]);
    }
    const h=this.head=joint(n,0,.78,.51);
    this.loft(h,coat,[[0,.02,-.11,.12,.12],[0,.02,0,.166,.19],[0,-.004,.13,.14,.177],[0,-.073,.27,.104,.135],[0,-.13,.42,.084,.099],[0,-.145,.47,.082,.084]]);
    this.oval(h,muzzle,0,-.144,.464,.10,.094,.10);
    for(const s of [-1,1]){
      this.oval(h,0x423d39,s*.078,-.124,.506,.024,.021,.035);
      this.oval(h,0x252a2a,s*.135,.057,.122,.021,.028,.035);
      this.loft(h,coat,[[s*.082,.13,-.035,.054,.052],[s*.097,.215,-.048,.051,.063],[s*.11,.32,-.055,.012,.018]]);
    }
    this.loft(h,0xc2ac78,[[0,.15,.118,.053,.056],[0,.26,.155,.045,.045],[0,.43,.211,.03,.029],[0,.62,.277,.003,.003]]);
  }
  update(dt,t,action){
    const walk=action==='Walk'?1:0;
    this.horse.animate(t,walk);
    const aim=action==='Graze'?1.72:action==='Alert'?-.22:.04;
    this.neck.rotation.x+=(aim-this.neck.rotation.x)*(1-Math.exp(-dt*3.5));
    this.head.rotation.x=.05*Math.sin(t*(walk?5:1.25))+(action==='Graze'?.36:0);
    this.head.rotation.y=.08*Math.sin(.8*t);
    this.horse.base.scale.y=1+.002*Math.sin(t*2);
  }
}
