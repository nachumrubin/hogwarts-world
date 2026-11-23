import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';
import {equine} from './equine.js';

export class Unicorn extends Specimen {
  constructor(){
    super();
    const coat=0xd7cfc2,hair=0xaba392,muzzle=0xb5a89b;
    this.horse=equine(this,{kind:'unicorn',pivot:[0,1.57,.65],foreColor:coat,coat,hair,hoof:0x665d54,slender:.87,length:1.08});
    this.graze=0;
    const n=this.neck=this.horse.neck;
    // Locks root along the poll and fall across the outside of the crest.
    for(const [i,station] of [8.667,9,9.5,10,10.5,11,11.5,12,12.667].entries()){
      const root=this.cervical.crest(station);
      this.loft(root,hair,[[.012,-.014,.012,.040,.052],[-.023,.008,-.04,.057,.064],
        [-.081,-.076,-.095,.055,.071],[-.116,-.17,-.10,.033,.048],
        [-.116,-.24-.035*Math.cos(i),-.114,.005,.008]]);
    }
    const h=this.head=joint(n,0,.83,.596);
    this.loft(h,coat,[[0,.02,-.11,.12,.12],[0,.02,0,.166,.19],[0,-.004,.13,.14,.177],[0,-.073,.27,.104,.135],[0,-.13,.42,.084,.099],[0,-.145,.47,.082,.084]]);
    const nose=this.loft(h,muzzle,[[0,-.127,.39,.087,.086],[0,-.15,.447,.101,.089],[0,-.16,.495,.095,.073],[0,-.157,.525,.071,.048]],[0,0,1]);
    // The ventral lip spans the three rings around the widest muzzle
    // station. Store its lowest vertices and neighbours on each side.
    this.lip=[];
    for(const ring of [5,6,7,9])for(const side of [14,15,16]){
      this.lip.push(new T.Vector3().fromBufferAttribute(nose.geometry.attributes.position,ring*20+side));
    }
    this.lipPoint=new T.Vector3();this.baseInverse=new T.Matrix4();
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
  fitLipToTerrain(terrain,reach){
    // Keep the flat-ground vertical trajectory while accounting for the
    // local relief between the support polygon and the browsing point.
    const head=this.head,restPitch=head.rotation.x,base=this.horse.base;
    base.updateWorldMatrix(true,false);
    this.baseInverse.copy(base.matrixWorld).invert();
    let reference=Infinity;
    const clearance=(sampleReference)=>{
      head.updateWorldMatrix(true,false);
      let lowest=Infinity;
      for(const point of this.lip){
        const p=this.lipPoint.copy(point).applyMatrix4(head.matrixWorld);
        lowest=Math.min(lowest,p.y-this.origin.y-terrain(p.x,p.z));
        if(sampleReference){
          p.applyMatrix4(this.baseInverse);
          reference=Math.min(reference,p.y-.028-.08*reach);
        }
      }
      return lowest;
    };
    const initial=clearance(true);
    const influence=T.MathUtils.smoothstep(reach,.65,.96);
    const target=T.MathUtils.lerp(initial,reference,influence);
    if(Math.abs(target-initial)<.0001)return;
    head.rotation.x=restPitch+.012;
    const slope=(clearance(false)-initial)/.012;
    if(slope>-.08){head.rotation.x=restPitch;return}
    const correct=(error)=>T.MathUtils.clamp(error/slope,-.42,.42);
    head.rotation.x=restPitch+correct(target-initial);
    const residual=target-clearance(false);
    head.rotation.x=restPitch+T.MathUtils.clamp(head.rotation.x-restPitch+correct(residual),-.42,.42);
  }
  update(dt,t,action,context){
    this.horse.advance(dt,action,context);
    const walk=action==='Walk'?1:0;
    this.graze+=((action==='Graze'?1:0)-this.graze)*(1-Math.exp(-dt*2.8));
    const reach=this.graze;
    this.horse.animate(t,walk,0,reach);
    const rest=action==='Alert'?-.22:.04;
    const bend=this.cervical.pose(reach,rest*(1-reach));
    const browse=.561+.009*Math.sin(t*2.1);
    this.head.rotation.x=.05*Math.sin(t*(walk?5:1.25))*(1-reach)+(browse-bend)*reach;
    this.ears.forEach((ear,i)=>ear.rotation.z=(i?1:-1)*(.10+.09*Math.sin(t*(1.2+i*.2)+i)));
    this.head.rotation.y=.08*Math.sin(.8*t);
    if(context?.terrainHeight && reach>.65)this.fitLipToTerrain(context.terrainHeight,reach);

  }
}
