import * as T from '../../vendor/three.module.js';
import {Owl} from '../../species/owl.js';
import {owlFrame} from '../../species/owl-motion.js';
import {OwlTimeline, owlScenes, owlLastFrame, inspectOwlContact} from '../../species/owl-inspection.js';
import {studioLights} from '../../inspection.js';

const byId=id=>document.getElementById(id);
const owl=new Owl(),timeline=new OwlTimeline(owl);
const renderer=new T.WebGLRenderer({canvas:byId('owl'),antialias:true,preserveDrawingBuffer:true});
renderer.setClearColor(0x66776e);
const scene=new T.Scene(),camera=new T.OrthographicCamera();
scene.add(studioLights(),owl.root);
const perch=new T.Mesh(new T.CylinderGeometry(.017,.019,.44,32),new T.MeshStandardMaterial({color:0x76614f,roughness:.95}));
perch.rotation.z=Math.PI/2;
perch.position.set(0,-.006,.011);
scene.add(perch);

const markers=(count,color)=>{
  const group=new T.Group();
  const material=new T.MeshBasicMaterial({color,depthTest:false});
  for(let i=0;i<count;i++){
    const dot=new T.Mesh(new T.SphereGeometry(.0045,10,8),material);
    dot.renderOrder=3;
    group.add(dot);
  }
  group.visible=false;
  scene.add(group);
  return group;
};
const wingMarkers=[markers(3,0xffc673),markers(3,0x9ce8f4)];
const padMarkers=markers(2,0xd1f3ab);
const wingLinks=wingMarkers.map(group=>{
  const geom=new T.BufferGeometry();
  geom.setAttribute('position',new T.BufferAttribute(new Float32Array(9),3));
  const link=new T.Line(geom,new T.LineBasicMaterial({color:group.children[0].material.color,depthTest:false}));
  link.frustumCulled=false;
  link.renderOrder=2;
  scene.add(link);
  return link;
});
const directions={front:[0,.19,1],side:[1,.12,0],quarter:[.78,.23,1],perch:[.88,.21,.86],feet:[.80,.15,1]};
let view='quarter',playing=false,speed=1,viewWidth,viewHeight;
let playAt=0,fromFrame=0,playRequest=0;

function frameCamera(){
  const p=owl.motion.pose;
  const center=new T.Vector3(),direction=new T.Vector3(...directions[view]).normalize();
  const close=view==='perch'||view==='feet';
  const open=close?0:owl.open;
  const height=close?(view==='feet'?.182:.48):.36+open*.64;
  if(close){
    const pad=new T.Vector3();
    owl.feet.forEach(({pad:joint})=>center.add(joint.getWorldPosition(pad)));
    center.multiplyScalar(.5);
    center.y+=view==='feet'?.005:.14;
  }else{
    center.set(0,.146+p.air*.24,.019+p.air*.06).applyQuaternion(owl.root.quaternion).add(owl.root.position);
    direction.applyQuaternion(owl.root.quaternion);
  }
  camera.position.copy(center).addScaledVector(direction,2);
  camera.lookAt(center);
  const wide=height*viewWidth/viewHeight;
  camera.left=-wide/2;
  camera.right=wide/2;
  camera.top=height/2;
  camera.bottom=-height/2;
  camera.near=.05;
  camera.far=9;
  camera.updateProjectionMatrix();
}

function render(){
  owl.root.updateMatrixWorld(true);
  frameCamera();
  const hasWings=byId('wings').checked;
  const hasContact=byId('contact').checked;
  const data=hasContact?inspectOwlContact(owl):null;
  wingMarkers.forEach((group,side)=>{
    const link=wingLinks[side];
    group.visible=link.visible=hasWings;
    if(!hasWings)return;
    const points=link.geometry.attributes.position;
    group.children.forEach((marker,i)=>{
      owl.wings[side].joints[i].getWorldPosition(marker.position);
      points.setXYZ(i,...marker.position.toArray());
    });
    points.needsUpdate=true;
  });
  padMarkers.visible=hasContact;
  byId('diagnostics').hidden=!hasContact;
  if(data){
    const names={pad:'Toe pad',toeBase:'Proximal toes',toeTip:'Distal toes',claw:'Claws'};
    byId('clearance').replaceChildren(...Object.entries(data.clearanceMm).map(([region,values])=>{
      const row=document.createElement('tr');
      [names[region],...values.map(n=>Number.isFinite(n)?n.toFixed(2):'Beyond perch')].forEach(value=>{row.insertCell().textContent=value});
      return row;
    }));
    padMarkers.children.forEach((marker,i)=>marker.position.fromArray(data.pads[i]));
  }
  renderer.render(scene,camera);
}

function seek(frame){
  const value=timeline.seek(frame);
  byId('timeline').value=value;
  byId('clock').textContent=(value*owlFrame).toFixed(2)+' s · f'+value;
  byId('state').textContent=({Fly:'Powered flight',Look:'Tracking',Perch:'Perched',Land:'Landing'})[owl.motion.state]??owl.motion.state;
  for(const [i,button] of [...byId('chapters').children].entries())button.setAttribute('aria-current',i===timeline.scene);
  render();
}

function setPlaying(active){
  cancelAnimationFrame(playRequest);
  playing=active;
  byId('play').textContent=active?'Pause':'Play';
  byId('play').setAttribute('aria-label',active?'Pause animation':'Play animation');
  if(active){
    if(timeline.frame===owlLastFrame)seek(0);
    playAt=performance.now();
    fromFrame=timeline.frame;
    playRequest=requestAnimationFrame(playFrame);
  }
}
function playFrame(now){
  if(!playing)return;
  const frame=Math.min(owlLastFrame,fromFrame+Math.floor((now-playAt)*.06*speed));
  if(frame!==timeline.frame)seek(frame);
  if(frame===owlLastFrame)setPlaying(false);
  else playRequest=requestAnimationFrame(playFrame);
}

function size(width,height){
  viewWidth=width;viewHeight=height;
  renderer.setSize(width,height,false);
}
function fit(){
  const {clientWidth,clientHeight}=byId('owl');
  if(clientWidth&&clientHeight){size(clientWidth,clientHeight);render()}
}

byId('timeline').max=owlLastFrame;
for(const {name,frame} of owlScenes){
  const button=document.createElement('button');
  button.textContent=name;
  button.onclick=()=>{setPlaying(false);seek(frame)};
  byId('chapters').append(button);
}
byId('play').onclick=()=>setPlaying(!playing);
const step=delta=>{setPlaying(false);seek(timeline.frame+delta)};
byId('back').onclick=()=>step(-1);
byId('next').onclick=()=>step(1);
byId('timeline').oninput=e=>{setPlaying(false);seek(Number(e.target.value))};
byId('speed').onchange=e=>{speed=Number(e.target.value);playAt=performance.now();fromFrame=timeline.frame};
byId('lod').onchange=e=>{owl.setLOD(Number(e.target.value));render()};
byId('view').onchange=e=>{view=e.target.value;render()};
byId('wings').onchange=render;
byId('contact').onchange=render;
window.addEventListener('keydown',event=>{
  if(event.target.matches?.('button,input,select,a'))return;
  if(event.code==='Space'){event.preventDefault();setPlaying(!playing)}
  if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();step(event.key==='ArrowRight'?1:-1)}
});
const resizeObserver=new ResizeObserver(fit);
resizeObserver.observe(byId('owl'));
fit();
seek(0);

const captureCanvas=document.createElement('canvas');
captureCanvas.width=640;
captureCanvas.height=360;
const ink=captureCanvas.getContext('2d');

window.owlReview={
  capture(frame,angle,wings=false,contact=false){
    resizeObserver.disconnect();
    size(640,360);
    view=angle;byId('wings').checked=wings;byId('contact').checked=contact;
    seek(frame);
    ink.drawImage(renderer.domElement,0,0);
    const heading=byId('state').textContent+'  ·  '+byId('clock').textContent;
    ink.font='14px system-ui';
    const label=(text,x,y,color='#f5f2e9')=>{
      ink.fillStyle='#192523e8';
      ink.fillRect(x,y-17,ink.measureText(text).width+16,24);
      ink.fillStyle=color;
      ink.fillText(text,x+8,y);
    };
    label(heading,12,28);
    if(wings)label('Shoulder  →  Elbow  →  Wrist',12,340,'#ffd093');
    if(contact){
      const {clearanceMm:c}=inspectOwlContact(owl);
      const value=ns=>Number.isFinite(Math.min(...ns))?Math.min(...ns).toFixed(2):'—';
      label('Minimum clearance · pad '+value(c.pad)+' · toe '+value(c.toeTip)+' · claw '+value(c.claw)+' mm',12,340,'#d1f3ab');
    }
    return captureCanvas.toDataURL('image/jpeg',.91).split(',')[1];
  }
};
