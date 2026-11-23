import {Specimen,joint} from './form.js';
import {equine} from './equine.js';
import {raptorWing,plumage,talon} from './avian.js';
export class Hippogriff extends Specimen {
  constructor(){
    super();
    const coat=0x786b59,ruff=0xbab4a3,slate=0x737777;
    this.horse=equine(this,{kind:'hippogriff',pivot:[0,1.48,.58],foreColor:ruff,coat,hair:0x4d4840,hoof:0x484340,front:false,length:.95});
    const b=this.horse.base,n=this.neck=this.horse.neck;
    for(let row=0;row<3;row++){
      const vanes=[],count=20-row*3;
      for(let i=0;i<count;i++){
        const angle=2*Math.PI*(i+.46*row)/count,x=Math.sin(angle),z=Math.cos(angle);
        const h=.23+row*.198+.035*z,r=.33-row*.047;
        const reach=.27+.057*z+.025*Math.sin(angle*3+.7*row);
        vanes.push([[x*r,h,.14+.064*row+z*r],[x*(r+.068),h-reach,.12+.064*row+z*(r+.07)],.076-row*.006,[x,0,z]]);
      }
      plumage(this,n,row===1?0xafaa9b:ruff,vanes);
    }
    const h=this.head=joint(n,0,.74,.27);
    this.loft(h,ruff,[[0,.04,-.20,.081,.12],[0,.06,-.12,.173,.19],[0,.09,.032,.202,.20],[0,.08,.16,.178,.16],[0,.065,.26,.121,.112]]);
    this.loft(h,0xb99d69,[[0,.069,.184,.13,.09],[0,.074,.292,.114,.092],[0,.057,.393,.076,.076],[0,.002,.449,.045,.054],[0,-.088,.439,.012,.022],[0,-.112,.42,.004,.005]]);
    for(const s of [-1,1]){
      this.oval(h,0xc79844,s*.161,.127,.162,.029,.026,.032);
      this.oval(h,0x242722,s*.181,.129,.171,.013,.018,.014);
      this.oval(h,0x645a49,s*.095,.096,.306,.016,.012,.031);
      this.oval(h,slate,s*.147,.153,.158,.046,.020,.076).rotation.x=.15;
    }
    this.wings=[];this.forelegs=[];
    for(const s of [-1,1]){
      this.wings.push(raptorWing(this,b,s,[s*.427,1.76,.36]));
      // Nest the shoulder beneath the ruff, sweep the upper limb back
      // to the elbow, then return the tapered tarsus under the chest.
      const upper=joint(b,s*.292,1.61,.56);
      this.loft(upper,slate,[[-s*.10,.22,-.12,.06,.09],[-s*.055,.13,-.056,.155,.21],
        [-s*.017,-.055,.006,.164,.195],[0,-.23,-.025,.139,.173],
        [s*.018,-.42,-.106,.115,.147],[s*.017,-.58,-.135,.088,.102],
        [s*.008,-.69,-.115,.067,.077],[0,-.75,-.094,.049,.063]]);
      const shank=joint(upper,s*.008,-.715,-.105);
      this.loft(shank,0xa79161,[[0,.054,-.012,.057,.065],[0,0,.004,.072,.078],
        [0,-.115,.043,.065,.069],[0,-.28,.10,.052,.063],[0,-.48,.147,.042,.051],
        [0,-.65,.17,.038,.045],[0,-.762,.196,.048,.062],[0,-.82,.206,.052,.066]]);
      talon(this,shank,s,1.17).position.set(0,-.82,.206);
      this.forelegs.push({upper,shank});
    }
    this.open=0;this.flight=0;this.update(0,0,'Idle');
  }
  update(dt,t,action,context){
    this.horse.advance(dt,action,context);
    const fly=action==='Fly',flap=fly||action==='Flap',walk=action==='Walk'?1:0;
    const blend=1-Math.exp(-dt*3.2);
    this.open+=((flap||action==='Unfold'?1:0)-this.open)*blend;
    if(this.open<.001)this.open=0;
    if(this.open>.999)this.open=1;
    this.flight+=((fly?1:0)-this.flight)*blend;
    this.horse.animate(t,walk,this.flight);this.body.position.y=this.flight*(.65+.09*Math.cos(t*4.4));
    this.wings.forEach(pose=>pose(this.open,flap?.67*Math.sin(t*4.4):.36));
    this.neck.rotation.x=.036*Math.sin(t*(walk?5:1.7))+this.flight*.24;
    this.head.rotation.y=.12*Math.sin(t*.8);
    this.forelegs.forEach(({upper,shank},i)=>{
      const p=t*5+i*Math.PI;
      upper.rotation.x=walk*.27*Math.cos(p)+this.flight*.66;
      shank.rotation.x=walk*.33*Math.max(0,Math.sin(p))+this.flight*.44;
    });
  }
}
