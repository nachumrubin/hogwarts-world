import {Vector3} from '../vendor/three.module.js';
import {owlFrame} from './owl-motion.js';

export const owlScenes=[
  {name:'Perched',frame:0,action:'Perch'},
  {name:'Tracking',frame:360,action:'Look'},
  {name:'Takeoff',frame:510,action:'Takeoff'},
  {name:'Powered flight',frame:595,action:'Fly'},
  {name:'Glide',frame:715,action:'Glide'},
  {name:'Bank',frame:830,action:'Bank'},
  {name:'Landing',frame:960,action:'Land'},
  {name:'Settled',frame:1155,action:'Perch'}
];
export const owlLastFrame=1220;

export class OwlTimeline {
  constructor(owl){
    this.owl=owl;
    this.frame=0;
    this.scene=0;
    this.target=new Vector3();
    this.context={stimulus:this.target};
  }
  seek(frame){
    const end=Math.min(owlLastFrame,Math.max(0,Math.round(frame)));
    if(end<this.frame){
      this.owl.resetMotion();
      this.frame=0;
      this.scene=0;
    }
    while(this.frame<end){
      this.frame++;
      if(owlScenes[this.scene+1]?.frame===this.frame)this.scene++;
      const sec=this.frame*owlFrame;
      const gaze=Math.floor((this.frame-360)/42)%3;
      this.target.set(gaze===0?.28:gaze===1?-.32:.57,.26+.12*Math.sin(sec),.46);
      this.owl.update(owlFrame,sec,owlScenes[this.scene].action,this.context);
    }
    return this.frame;
  }
}

const radial=(p,origin)=>{
  const x=p.x-origin.x;
  if(Math.abs(x)>.22)return Infinity;
  return Math.hypot(p.y-origin.y+.006,p.z-origin.z-.011)-(.018+.002*x/.44);
};

export function inspectOwlContact(owl){
  owl.root.updateMatrixWorld(true);
  const skin=owl.parts.find(({mesh})=>mesh.isSkinnedMesh).mesh;
  const points=new Vector3(),minima={};
  for(const {region,side,first,end} of skin.geometry.userData.owlContact){
    const group=minima[region]??=[Infinity,Infinity];
    for(let i=first;i<end;i++){
      skin.getVertexPosition(i,points).applyMatrix4(skin.matrixWorld);
      group[side]=Math.min(group[side],1000*radial(points,owl.origin));
    }
  }
  return {clearanceMm:minima,pads:owl.feet.map(({pad})=>pad.getWorldPosition(new Vector3()).toArray())};
}
