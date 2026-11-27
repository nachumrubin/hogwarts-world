import * as T from '../vendor/three.module.js';
import {Centaur} from './centaur.js';
import {loadTexturedGLB,texturedMaterial} from './textured-glb.js';

export function loadCentaurAsset(){
  return loadTexturedGLB(new URL('./static/centaur-meshy.glb',import.meta.url));
}

// Meshy exports a standing archery pose with a diagonal heading and an offset origin.
const scale=2.24/(.95057708+.95186007);
const bindSpace=new T.Matrix4().makeTranslation(.102,.95186007,.267).premultiply(
  new T.Matrix4().makeScale(scale,scale,scale));
const sourceToBind=bindSpace.clone().multiply(new T.Matrix4().makeRotationY(-.70));
const point=(x,y,z)=>new T.Vector3(x,y,z).applyMatrix4(bindSpace);
const smooth=(lo,hi,value)=>T.MathUtils.smoothstep(value,lo,hi);
const blend=(a,b,t)=>[[a,1-t],[b,t]];
const leg=(x,stations,homeZ)=>({
  ref:stations.map(([y,z])=>point(x,y,z)),
  home:point(x,-.95186007,homeZ)
});
const fit={
  pelvis:point(-.12,-.005,-.61),waist:point(-.14,.105,.275),
  chest:point(-.15,.37,.275),neck:point(-.087,.665,.245),head:point(-.067,.735,.243),
  tail:[[-.13,.02,-.77],[-.14,-.18,-.866],[-.15,-.40,-.901],
    [-.17,-.62,-.965],[-.19,-.83,-1.012]].map(p=>point(...p)),
  legs:[
    leg(-.249,[[-.084,-.600],[-.31,-.549],[-.482,-.703],[-.834,-.723],[-.893,-.691]],-.67),
    leg(-.248,[[-.119,.223],[-.328,.112],[-.557,.137],[-.836,.105],[-.898,.125]],.148),
    leg(.012,[[-.087,-.619],[-.32,-.539],[-.484,-.754],[-.837,-.791],[-.895,-.765]],-.725),
    leg(.057,[[-.123,.256],[-.333,.142],[-.56,.154],[-.835,.126],[-.898,.153]],.177),
  ]
};

function tailVertices(positions,indices){
  const weld=new Map(),vertices=[],keys=[];
  for(let i=0;i<positions.count;i++){
    const x=positions.getX(i)/scale-.102,y=positions.getY(i)/scale-.95186007,
      z=positions.getZ(i)/scale-.267;
    const key=[x,y,z].map(v=>Math.round(v*1e5)).join(',');
    if(!weld.has(key)){
      weld.set(key,vertices.length);
      vertices.push({y,z,neighbors:new Set()});
    }
    keys.push(weld.get(key));
  }
  for(let i=0;i<indices.length;i+=3)for(let corner=0;corner<3;corner++){
    const a=keys[indices[i+corner]],b=keys[indices[i+(corner+1)%3]];
    vertices[a].neighbors.add(b);
    vertices[b].neighbors.add(a);
  }
  // The dock joins the rump above this slice. Below it, connectivity
  // separates the tail from the nearby hind leg, including across UV seams.
  const cut=-.08,seen=new Set(),tail=new Set();
  for(let i=0;i<vertices.length;i++){
    if(seen.has(i)||vertices[i].y>cut)continue;
    const component=[i];
    seen.add(i);
    for(const id of component)for(const next of vertices[id].neighbors){
      if(seen.has(next)||vertices[next].y>cut)continue;
      seen.add(next);
      component.push(next);
    }
    let front=-Infinity,back=Infinity;
    for(const id of component){
      front=Math.max(front,vertices[id].z);
      back=Math.min(back,vertices[id].z);
    }
    if(front<-.79&&back<-.86)for(const id of component)tail.add(id);
  }
  return keys.map(key=>tail.has(key));
}

function weightsAt(actor,x,y,z,isTail){
  // These landmarks use the rotated source coordinates. The bow, arrow,
  // arms and quiver share chest motion to keep the authored grip intact.
  if(y>=.32){
    const center=Math.hypot((x+.061)*1.35,z-.244);
    const head=smooth(.685,.755,y)*(1-smooth(.095,.15,center));
    return blend(actor.chest,actor.head,head);
  }
  const upper=smooth(.16,.32,y);
  const junction=smooth(-.01,.23,y)*smooth(.02,.21,z);
  const torso=Math.max(T.MathUtils.lerp(junction,1,upper),smooth(.40,.55,z));
  if(isTail||y>-.08&&z<-.72){
    const dock=(1-smooth(-.94,-.72,z))*(1-smooth(-.08,.055,y));
    const grain=1-smooth(-.20,-.08,y);
    const tail=isTail?T.MathUtils.lerp(dock,1,grain):dock;
    const station=T.MathUtils.clamp((.02-y)/.21,0,4);
    const i=Math.min(Math.floor(station),3),fraction=station-i;
    return [[actor.pelvis,1-tail],[actor.tailChain[i],tail*(1-fraction)],[actor.tailChain[i+1],tail*fraction]];
  }
  const fore=z>-.22,side=x>-.10, index=2*Number(side)+Number(fore);
  const {bones,helpers,ref}=actor.horse.legs[index];
  const pelvis=(1-smooth(-.53,-.25,z))*smooth(-.30,-.01,y);
  const medial=smooth(.018,.085,Math.abs(x+.10));
  const proximal=(1-smooth(-.36,-.10,y))*medial
    *(fore?smooth(-.10,.07,z):1-smooth(-.44,-.25,z));
  let limb=[[bones[0],1]];
  for(let k=1;k<5;k++){
    const center=ref[k].y/scale-.95186007;
    const radius=[0,.082,.063,.039,.028][k];
    const t=1-smooth(center-radius,center+radius,y);
    if(t<=0)break;
    limb=k===4?blend(bones[3],bones[4],t):t<.5
      ?blend(bones[k-1],helpers[k],2*t):blend(helpers[k],bones[k],2*t-1);
    if(t<1)break;
  }
  const body=fore?actor.chest:actor.pelvis;
  const bodyWeight=fore?torso:T.MathUtils.lerp(pelvis,1,torso);
  return [...limb.map(([bone,w])=>[bone,w*proximal*(1-bodyWeight)]),
    [actor.core,(1-proximal)*(1-bodyWeight)],[body,bodyWeight]];
}

export class ImportedCentaur extends Centaur {
  constructor(asset){
    super(fit);
    const geometry=new T.BufferGeometry();
    geometry.setAttribute('position',new T.BufferAttribute(asset.positions.slice(),3));
    geometry.setAttribute('normal',new T.BufferAttribute(asset.normals.slice(),3));
    geometry.setAttribute('uv',new T.BufferAttribute(asset.uv,2));
    geometry.setIndex(new T.BufferAttribute(asset.indices,1));
    geometry.applyMatrix4(sourceToBind);
    const position=geometry.attributes.position;
    const tail=tailVertices(position,asset.indices);
    const ids=new Uint16Array(position.count*4),weights=new Float32Array(position.count*4);
    for(let i=0;i<position.count;i++){
      const x=position.getX(i)/scale-.102,y=position.getY(i)/scale-.95186007,z=position.getZ(i)/scale-.267;
      for(const [j,[bone,weight]] of weightsAt(this,x,y,z,tail[i]).entries()){
        ids[4*i+j]=bone.userData.index;
        weights[4*i+j]=weight;
      }
    }
    geometry.setAttribute('skinIndex',new T.BufferAttribute(ids,4));
    geometry.setAttribute('skinWeight',new T.BufferAttribute(weights,4));
    const {material,textures}=texturedMaterial(asset);
    this.textures=textures;
    this.materials.set('Meshy centaur',material);
    this.model=new T.SkinnedMesh(geometry,material);
    this.model.name='Meshy centaur';
    this.model.frustumCulled=false;
    this.body.add(this.model);
    this.root.updateMatrixWorld(true);
    this.skeleton=new T.Skeleton(this.bones);
    this.model.bind(this.skeleton);
    this.parts.push({mesh:this.model,levels:[geometry]});
    this.update(0,0,'Idle');
  }

  setLOD(level){this.level=level}

  dispose(){
    super.dispose();
    this.textures.forEach(texture=>texture.dispose());
  }
}
