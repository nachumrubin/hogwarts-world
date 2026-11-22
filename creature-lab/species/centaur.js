import {Specimen,joint} from './form.js';
import {equine} from './equine.js';
export class Centaur extends Specimen {
  constructor(){
    super();
    const skin=0xac7457,hair=0x36251f,coat=0x855138;
    this.horse=equine(this,{coat,hair,hoof:0x38312d});
    const trunk=this.trunk=joint(this.horse.base,0,1.65,.65);
    this.loft(trunk,skin,[[0,-.24,-.05,.31,.31],[0,0,0,.32,.31],[0,.21,.045,.25,.19],[0,.40,.04,.275,.17],[0,.62,.04,.345,.205],[0,.78,.025,.37,.177],[0,.85,.02,.24,.135],[0,.89,.025,.111,.105],[0,1,.03,.10,.105]]);
    const head=this.head=joint(trunk,0,.96,.03);
    this.loft(head,skin,[[0,-.035,.045,.074,.09],[0,.025,.07,.109,.113],[0,.11,.05,.144,.137],[0,.21,.025,.15,.145],[0,.29,.015,.133,.132],[0,.34,.01,.064,.085]]);
    this.oval(head,hair,0,.262,.003,.152,.116,.147);
    this.oval(head,hair,0,.12,-.077,.147,.18,.097);
    this.oval(head,skin,0,.136,.179,.035,.057,.044);
    this.oval(head,0x794e40,0,.058,.166,.051,.012,.012);
    this.arms=[];
    for(const s of [-1,1]){
      this.oval(head,skin,s*.145,.143,.02,.027,.052,.029);
      this.oval(head,0x332722,s*.065,.177,.154,.032,.014,.012);
      this.oval(head,hair,s*.067,.205,.15,.045,.012,.014).rotation.z=s*.09;
      const arm=joint(trunk,s*.323,.738,.025);arm.rotation.z=s*.13;
      this.loft(arm,skin,[[0,.078,0,.082,.087],[s*.02,-.015,0,.103,.103],[s*.03,-.17,-.017,.078,.084],[s*.03,-.31,-.034,.055,.057],[s*.028,-.39,-.012,.069,.07],[s*.02,-.56,.033,.039,.042]]);
      this.oval(arm,skin,s*.02,-.604,.04,.044,.068,.031);
      for(let f=0;f<4;f++)this.oval(arm,skin,s*(f*.019-.009),-.666+Math.abs(f-1)*.006,.048,.012,.047,.015);
      this.oval(arm,skin,-s*.024,-.604,.069,.018,.046,.02);this.arms.push(arm);
    }
  }
  update(dt,t,action){
    const walk=action==='Walk'||action==='Turn'?1:0;
    this.horse.animate(t,walk);this.trunk.scale.y=1+.009*Math.sin(2*t);
    this.head.rotation.y=.18*Math.sin(t*.72);
    this.arms.forEach((arm,i)=>arm.rotation.x=walk*.23*Math.sin(t*5+i*Math.PI));
    if(action==='Turn')this.body.rotation.y+=dt*.42;
  }
}
