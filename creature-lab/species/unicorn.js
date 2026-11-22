import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';
import {equine} from './equine.js';

export class Unicorn extends Specimen {
  constructor(){
    super();
    const coat=0xd7cfc2,hair=0xaba392,muzzle=0xb5a89b;
    this.horse=equine(this,{kind:'unicorn',pivot:[0,1.57,.65],foreColor:coat,coat,hair,hoof:0x665d54,slender:.87,length:1.08});
    const n=this.neck=this.horse.neck;
    // Locks root along the poll and fall across the outside of the crest.
    for(let i=0;i<9;i++){
      const t=i/8,y=.65+.25*t,z=.11+.32*t,x=-.08-.026*Math.sin(i*1.7);
      this.loft(n,hair,[[x*.4,y,z,.040,.052],[x,y+.008,z-.04,.057,.064],
        [x-.058,y-.076,z-.095,.055,.071],[x-.093,y-.17,z-.10,.033,.048],
        [x-.093,y-.24-.035*Math.cos(i),z-.114,.005,.008]]);
    }
    const h=this.head=joint(n,0,.78,.51);
    this.loft(h,coat,[[0,.02,-.11,.12,.12],[0,.02,0,.166,.19],[0,-.004,.13,.14,.177],[0,-.073,.27,.104,.135],[0,-.13,.42,.084,.099],[0,-.145,.47,.082,.084]]);
    this.loft(h,muzzle,[[0,-.127,.39,.087,.086],[0,-.15,.447,.101,.089],[0,-.16,.495,.095,.073],[0,-.157,.525,.071,.048]],[0,0,1]);
    this.ears=[];
    for(const s of [-1,1]){
      this.oval(h,0x423d39,s*.078,-.124,.506,.024,.021,.035);
      this.oval(h,0x252a2a,s*.135,.057,.122,.021,.028,.035);
      const ear=joint(h,s*.082,.13,-.035);
      this.ears.push(ear);
      this.loft(ear,coat,[[0,0,0,.050,.047],[s*.015,.087,-.015,.043,.054],[s*.028,.19,-.02,.006,.009]]);
    }
    const horn=this.mesh(h,0xc2ac78,lod=>{
      const sides=[20,12,8][lod],rings=[33,21,12][lod],pos=[],idx=[];
      for(let i=0;i<=rings;i++){
        const t=i/rings;
        for(let j=0;j<sides;j++){
          const angle=2*Math.PI*j/sides;
          const radius=.051*(1-.986*t)**.91*(1+.065*Math.cos(angle-6*Math.PI*t));
          pos.push(radius*Math.cos(angle),t*.414,radius*Math.sin(angle));
          if(i){const k=i*sides+j,n=i*sides+(j+1)%sides;idx.push(k-sides,k,n-sides,n-sides,k,n)}
        }
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));
      g.setIndex(idx);g.computeVertexNormals();return g;
    });
    horn.position.set(0,.147,.108);horn.rotation.x=.32;
  }
  update(dt,t,action,context){
    this.horse.advance(dt,action,context);
    const walk=action==='Walk'?1:0;
    this.horse.animate(t,walk);
    const aim=action==='Graze'?1.72:action==='Alert'?-.22:.04;
    this.neck.rotation.x+=(aim-this.neck.rotation.x)*(1-Math.exp(-dt*3.5));
    this.head.rotation.x=.05*Math.sin(t*(walk?5:1.25))-.30*Math.max(0,this.neck.rotation.x-.04);
    this.ears.forEach((ear,i)=>ear.rotation.z=(i?1:-1)*(.10+.09*Math.sin(t*(1.2+i*.2)+i)));
    this.head.rotation.y=.08*Math.sin(.8*t);
    this.horse.base.scale.y=1+.002*Math.sin(t*2);
  }
}
