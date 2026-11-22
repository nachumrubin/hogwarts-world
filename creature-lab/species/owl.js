import {Specimen,joint} from './form.js';
import {wing,feather,talon} from './avian.js';
export class Owl extends Specimen {
  constructor(){
    super();
    const buff=0xad8359,cream=0xe5d8bc,edge=0x805f44;
    this.loft(this.body,cream,[[0,.08,-.085,.064,.10],[0,.19,-.04,.139,.141],[0,.32,-.012,.159,.15],[0,.41,.018,.147,.133],[0,.48,.032,.105,.10]]);
    this.oval(this.body,buff,0,.31,-.091,.147,.171,.09);
    for(let i=-3;i<=3;i++)feather(this,this.body,buff,[i*.017,.25,-.07],[i*.024,.045,-.24+Math.abs(i)*.012],.029);
    this.head=joint(this.body,0,.46,.033);
    this.oval(this.head,buff,0,.028,0,.162,.143,.126);
    for(const s of [-1,1]){
      for(const [c,z,w,h] of [[edge,.066,.089,.126],[cream,.077,.083,.119]]){
        const disc=this.oval(this.head,c,s*.059,.022,z,w,h,.060);disc.rotation.z=-s*.37;
      }
      this.oval(this.head,0x503e2f,s*.064,.048,.131,.035,.040,.018);
      this.oval(this.head,0x191b1c,s*.064,.05,.143,.026,.031,.013);
    }
    this.loft(this.head,0xa8987c,[[0,.03,.129,.026,.023],[0,.001,.15,.021,.022],[0,-.027,.154,.012,.012],[0,-.046,.148,.003,.003]]);
    this.wings=[];this.feet=[];
    for(const s of [-1,1]){
      this.wings.push(wing(this,this.body,s,[s*.116,.385,-.022],.41,[buff,0xaa8a65,0x755f4d]));
      const shin=joint(this.body,s*.059,.15,.006);
      this.loft(shin,cream,[[0,.018,0,.039,.048],[0,-.054,-.003,.029,.037],[0,-.109,.026,.019,.022]]);
      talon(this,shin,s,.36).position.set(0,-.113,.024);this.feet.push(shin);
    }
    this.unfold=0;this.update(0,0,'Perch');
  }
  update(dt,t,action){
    const flight=action==='Fly',target=flight?1:0;
    this.unfold+=(target-this.unfold)*(1-Math.exp(-dt*4));
    this.body.rotation.x=this.unfold*.68;
    this.body.position.y=this.unfold*(.28+.036*Math.cos(t*7))+.003*Math.sin(2*t);
    this.head.rotation.x=-this.body.rotation.x*.85;
    this.head.rotation.y=Math.sin(t*.83)*(action==='Look'?1.75:.16);
    this.wings.forEach(pose=>pose(this.unfold,.78*Math.sin(t*7)));
    this.feet.forEach(foot=>foot.rotation.x=this.unfold*1.15);
  }
}
