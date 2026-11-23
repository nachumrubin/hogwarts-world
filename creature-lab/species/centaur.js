import * as T from '../vendor/three.module.js';
import {Specimen,joint,smoothSections} from './form.js';
import {equine} from './equine.js';
export class Centaur extends Specimen {
  constructor(){
    super();
    const skin=0xac7457,hair=0x36251f,coat=0x855138;
    this.horse=equine(this,{kind:'centaur',pivot:[0,1.65,.65],foreColor:skin,coat,hair,hoof:0x38312d});
    const trunk=this.trunk=this.horse.neck;
    const head=this.head=joint(trunk,0,.905,.03);
    // Horizontal skull sections fix the jaw plane. Front-facing relief
    // follows the same surface through cheeks, sockets, lips and nose.
    this.mesh(head,skin,lod=>{
      const sides=[64,40,24][lod],rows=smoothSections([
        [-.032,.052,.075,.086],[.009,.089,.061,.113],[.042,.107,.043,.122],
        [.085,.131,.032,.128],[.133,.144,.022,.136],[.18,.148,.017,.139],
        [.22,.15,.012,.143],[.275,.14,.010,.135],[.321,.108,.006,.107],
        [.349,.035,.004,.044]
      ],[6,4,2][lod]);
      const pos=[],idx=[];
      const relief=(d,spread)=>Math.exp(-((d/spread)**2));
      for(const [i,[y,w,center,depth]] of rows.entries()){
        for(let j=0;j<sides;j++){
          const angle=j*2*Math.PI/sides,x=w*Math.cos(angle),front=Math.sin(angle);
          const sx=Math.abs(x);
          let z=center+depth*front;
          if(front>0){
            const ridge=.040*relief(x,.023)*relief(y-.15,.071);
            const tip=.052*relief(x,.033)*relief(y-.115,.021);
            const cheek=.024*relief(sx-.091,.042)*relief(y-.132,.029);
            const brow=.018*relief(sx-.064,.041)*relief(y-.201,.017);
            const socket=.018*relief(sx-.064,.035)*relief(y-.174,.016);
            const lips=relief(x,.049)*(.019*relief(y-.066,.008)+.022*relief(y-.049,.009));
            z+=front*(ridge+tip+cheek+brow-socket+lips);
          }
          pos.push(x,y,z);
          if(i){const k=i*sides+j,n=i*sides+(j+1)%sides;idx.push(k-sides,k,n-sides,n-sides,k,n)}
        }
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
      const end=(rows.length-1)*sides;
      for(let j=1;j<sides-1;j++)idx.push(0,j,j+1,end,end+j+1,end+j);
      g.setIndex(idx);g.computeVertexNormals();return g;
    });
    this.oval(head,hair,0,.267,-.014,.153,.102,.148);
    this.oval(head,hair,0,.127,-.089,.145,.192,.085);
    // Long swept locks fall behind the jaw and over the trapezius.
    for(const side of [-1,1])for(let i=0;i<3;i++){
      const x=side*(.07+.026*i),z=-.10+.032*i;
      this.loft(head,hair,[[x,.26,z,.041,.06],[x*1.27,.13,z-.036,.052,.054],
        [x*1.31,-.03,z-.055,.044,.045],[x*1.43,-.15,z-.08,.039,.034],
        [x*1.56,-.24+.032*i,z-.067,.005,.008]]);
    }
    this.arms=[];
    for(const s of [-1,1]){
      this.oval(head,skin,s*.145,.143,.02,.027,.052,.029);
      this.oval(head,0x332722,s*.063,.174,.134,.031,.011,.012);
      this.oval(head,hair,s*.063,.203,.143,.036,.009,.011).rotation.z=s*.09;
      const arm=trunk.getObjectByName(s<0?'leftShoulder':'rightShoulder');
      const hand=joint(arm,s*.082,-.681,.032);
      this.oval(hand,skin,0,-.036,.004,.044,.064,.032);
      for(let f=0;f<4;f++)this.oval(hand,skin,s*(f*.019-.025),-.092+Math.abs(f-1)*.006,.010,.012,.047,.015);
      this.oval(hand,skin,-s*.033,-.046,.026,.018,.044,.019);
      this.arms.push(arm);
    }
  }
  update(dt,t,action,context){
    this.horse.advance(dt,action,context);
    const walk=action==='Walk'||action==='Turn'?1:0;
    this.horse.animate(t,walk);this.trunk.rotation.x=.011*Math.sin(2*t)+walk*.023*Math.cos(t*5);
    this.trunk.rotation.z=walk*.018*Math.sin(t*5);
    this.head.rotation.y=.18*Math.sin(t*.72);
    this.arms.forEach((arm,i)=>arm.rotation.x=walk*.23*Math.sin(t*5+i*Math.PI));
  }
}
