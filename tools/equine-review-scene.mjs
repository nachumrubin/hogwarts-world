// Browser-side recording fixture. All camera transforms depend only on the clock.
import * as T from '/vendor/three.module.js';
import {catalog} from '/species/catalog.js';
import {studioLights,inspectionMaterials,background} from '/inspection.js';

const width=768, height=576, fps=24;
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.setSize(width,height,false);
renderer.outputColorSpace=T.SRGBColorSpace;
renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.06;
const scene=new T.Scene(),materials=inspectionMaterials();
scene.background=background;
scene.add(studioLights());
const grid=new T.GridHelper(18,72,0xacaea5,0xc6c7be);
grid.position.y=-.004;
scene.add(grid);
const cam=new T.OrthographicCamera(-1,1,1,-1,.01,50);
const overlay=document.createElement('canvas');
overlay.width=width;overlay.height=height;
const ctx=overlay.getContext('2d');
const up=new T.Vector3(0,1,0);
let actor,kind,legs,phaseTime;

function oldLandmarks(){
  const meshes=actor.parts.map(part=>part.mesh).filter(mesh=>mesh.isSkinnedMesh && mesh.skeleton.bones.length===4 && mesh.skeleton.bones[3].parent===mesh.skeleton.bones[2]);
  if(meshes.length!==4)throw Error('Expected the four archived limb skeletons');
  return meshes.map((mesh,index)=>{
    const [,upper,lower,cannon]=mesh.skeleton.bones,fore=Boolean(index%2),side=index<2?-1:1;
    // Only three pivots exist on the old rig; the sole is measured at its actual cap.
    const sole=new T.Object3D();sole.position.set(0,-.665,.14);cannon.add(sole);
    return {fore,side,joints:{upper,lower,cannon},sole,stance:false,anchor:new T.Vector3()};
  });
}
function reset(species){
  actor?.dispose();
  kind=species;
  actor=new catalog[kind].model();
  scene.add(actor.root);
  for(const {mesh} of actor.parts)mesh.material=materials.neutral;
  legs=actor.horse.legs||oldLandmarks();phaseTime=0;
}
function pose(action){
  const dt=1/fps;
  phaseTime+=dt;
  actor.update(dt,phaseTime,action);
  actor.root.updateMatrixWorld(true);
  if(!actor.horse.legs){
    for(const leg of legs){
      const phase=(phaseTime*.8+(leg.fore?.24:0)+(leg.side>0?.5:0))%1;
      const stance=action!=='Walk'||phase<.62;
      if(stance&&!leg.stance)leg.sole.getWorldPosition(leg.anchor);
      leg.stance=stance;
    }
  }
}
function aim(view,frame,neckLevel){
  const walk=['side','three-quarter','joints'].includes(view);
  let half=1.73,target=new T.Vector3(0,1.43,.10);
  let dir=new T.Vector3(1,.10,.035);
  if(walk){
    // Follow one reference path in both runs. Grid and strike marks stay world-locked.
    const t=(frame+1)/fps, yaw=.18*t;
    target.x+=.63*(1-Math.cos(yaw))/.18;
    target.z+=.63*Math.sin(yaw)/.18;
    if(view==='three-quarter')dir.set(.83,.22,.73);
    if(view==='joints'){dir.set(1,.16,.13);half=1.27;target.y=.84;}
    dir.applyAxisAngle(up,yaw);
  }else if(view==='graze'){
    half=1.64;target.set(0,1.41,.31);dir.set(1,.065,.12);
  }else{
    // Shared framing by anatomical phase for the matched neck close-ups.
    half=[.82,1.00,1.09][neckLevel];
    target.set(0,[2.13,1.62,.95][neckLevel],[1.02,1.37,1.48][neckLevel]);
    dir.set(-1,.08,.12);
  }
  cam.left=-half*width/height;cam.right=-cam.left;
  cam.top=half;cam.bottom=-half;cam.updateProjectionMatrix();
  cam.position.copy(target).addScaledVector(dir.normalize(),10);cam.lookAt(target);
  cam.updateMatrixWorld();
}
function screen(p){
  const v=p.clone().project(cam);
  return [(v.x+1)*width/2,(1-v.y)*height/2];
}
function jointOverlay(){
  ctx.drawImage(renderer.domElement,0,0);
  const point=new T.Vector3();
  for(const leg of [...legs].sort((a,b)=>a.side-b.side)){
    const far=leg.side<0, color=leg.fore?'#174d7d':'#953516';
    const path=Object.values(leg.joints).map(joint=>screen(joint.getWorldPosition(point)));
    const sole=screen(leg.sole.getWorldPosition(point));
    path.push(sole);
    ctx.globalAlpha=far?.54:1;ctx.strokeStyle=color;ctx.lineWidth=far?2:3;
    ctx.setLineDash(far?[5,4]:[]);
    ctx.beginPath();path.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
    ctx.setLineDash([]);
    for(const [x,y] of path.slice(0,-1)){
      ctx.beginPath();ctx.arc(x,y,far?3:4,0,2*Math.PI);
      ctx.fillStyle='#f7f3ea';ctx.fill();ctx.stroke();
    }
    if(leg.stance){
      const anchor=leg.anchor.clone();anchor.y=0;
      const [x,y]=screen(anchor);
      ctx.strokeStyle='#116337';ctx.lineWidth=2.6;
      ctx.beginPath();ctx.ellipse(x,y,12,3.5,0,0,2*Math.PI);ctx.stroke();
      ctx.beginPath();ctx.moveTo(x-5,y);ctx.lineTo(x+5,y);ctx.stroke();
    }
    ctx.beginPath();ctx.arc(...sole,3.5,0,2*Math.PI);
    ctx.fillStyle=leg.stance?'#126336':'#e38a0a';ctx.fill();
  }
  ctx.globalAlpha=1;
}
function shot(view,frame,neckLevel){
  aim(view,frame,neckLevel);
  grid.visible=view!=='neck';
  renderer.render(scene,cam);
  if(view==='joints')jointOverlay();
  const canvas=view==='joints'?overlay:renderer.domElement;
  return (view==='neck'?canvas.toDataURL('image/png'):canvas.toDataURL('image/jpeg',.97)).split(',')[1];
}
export {reset};
export function walk(frame){pose('Walk');return ['side','three-quarter','joints'].map(v=>shot(v,frame))}
export function graze(frame){
  pose(frame>=18&&frame<114?'Graze':'Idle');
  return shot('graze',frame);
}
export function neck(level){
  reset('unicorn');
  pose('Idle');
  if(level){
    const target=level===1?.5:.9995,dt=1/240;
    for(let i=1;i<=1200&&actor.graze<target;i++){
      phaseTime+=dt;actor.update(dt,phaseTime,'Graze');
    }
    if(actor.graze<target)throw Error('Could not reach neck phase '+target);
  }
  return shot('neck',0,level);
}
