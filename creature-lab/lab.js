import {habitatFinish,surfaceAttribute} from './hippogriff-surface.js';
import {MotionStudio} from './hippogriff-studio.js';
import {inspectionMaterials,studioLights,background,comparisonPlates} from './inspection.js';
import {catalog} from './species/catalog.js';
import * as THREE from './vendor/three.module.js';
import {Squid} from './squid.js';
import {Aragog} from './aragog.js';
import {createHabitat} from './habitats.js';

const V=THREE.Vector3;
const species={squid:Squid,aragog:Aragog,...Object.fromEntries(Object.entries(catalog).map(([k,s])=>[k,s.model]))};
const directions={'three-quarter':[.32,.19,1],habitat:[.38,.28,1],above:[.001,1,.001],left:[0,.05,1],right:[0,.05,-1],front:[1,.08,.001],rear:[-1,.08,.001],'close-up':[.24,.08,1]};
const merpersonViews={'three-quarter':[.78,.18,1],'close-up':[.37,.075,1]};
const spiderViews={front:[0,.19,1],rear:[0,.19,-1],left:[1,.2,0],right:[-1,.2,0],'three-quarter':[.56,.32,1],habitat:[.7,.4,1],'close-up':[.15,.12,1]};
export class Lab{
 constructor(canvas,onFrame){
  this.canvas=canvas;this.onFrame=onFrame;this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true,powerPreference:'high-performance'});
  this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.06;
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));this.camera=new THREE.PerspectiveCamera(39,1,.035,180);this.scene=new THREE.Scene();this.target=new V();this.free=false;this.keys=new Set();
  this.clock=0;this.speed=1;this.running=true;this.actor=null;this.extra=null;this.level=0;this.wire=false;this.normals=false;this.normalMat=new THREE.MeshNormalMaterial();this.original=new WeakMap();this.metric={};this.samples=[];this.lastLabel=0;this.context={};this.spherical=new THREE.Spherical();
  const gl=this.renderer.getContext(),dbg=gl.getExtension('WEBGL_debug_renderer_info');this.gl=gl;this.gpuExt=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.queries=[];this.gpuMs=null;this.rendererName=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
  this.mode='habitat';this.inspectionMaterials=inspectionMaterials();
  this.studio=studioLights();this.studio.visible=false;this.scene.add(this.studio);
  this.resize();new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);this.bindCamera();
 }
 resize(){const box=this.canvas.parentElement.getBoundingClientRect();if(!box.width||!box.height)return;this.renderer.setSize(Math.round(box.width),Math.round(box.height),false);this.camera.aspect=box.width/box.height;this.camera.updateProjectionMatrix();if(this.actor&&!this.drag&&!this.free)this.setAngle(this.angle||'three-quarter')}
 thumbnail(kind){
  const out=document.querySelector('#thumb-'+kind),actor=new species[kind](),scene=new THREE.Scene();actor.setLOD(1);scene.add(actor.root);
  scene.add(new THREE.HemisphereLight(0xffebe2,0x627571,2));for(const [x,y,z,power,c] of [[-4,7,8,3,0xffdbaf],[2,4,-5,3,0xc3e6dc]]){let l=new THREE.DirectionalLight(c,power);l.position.set(x,y,z);scene.add(l)}
  const cam=new THREE.PerspectiveCamera(29,2.05,.1,80),look=kind==='squid'?new V(1,0,0):new V(0,1.05,0);
  cam.position.copy(look).add(kind==='squid'?new V(5,4.5,15.2):new V(4,2.8,5.5));if(catalog[kind]){
    const box=new THREE.Box3().setFromObject(actor.root),size=box.getSize(new V());
    box.getCenter(look);cam.position.copy(look).addScaledVector(new V(.92,.19,.73).normalize(),Math.max(size.y*2.45,size.z*1.55));
  }cam.lookAt(look);if(kind==='squid')cam.rotateZ(-.095);
  const r=this.renderer;r.setPixelRatio(1);r.setSize(460,224,false);r.setClearColor(0,0);r.render(scene,cam);out.width=460;out.height=224;out.getContext('2d').drawImage(this.canvas,0,0,460,224);actor.dispose();r.setPixelRatio(Math.min(devicePixelRatio,1.65));this.resize()
 }
 switchCreature(kind){if(this.actor){this.setCopies(1);this.restoreMaterials(this.actor);this.actor.dispose();this.hab.dispose()}this.kind=kind;this.actor=new species[kind]();if(kind==='hippogriff'){this.actor.prepare();habitatFinish(this.actor)}this.scene.add(this.actor.root);this.hab=createHabitat(this.scene,kind);this.context={obstacles:this.hab.obstacles,terrainHeight:this.hab.terrainHeight,playerPosition:this.camera.position,habitatRadius:3};
  this.bounds=kind==='hippogriff'?new THREE.Box3(new V(-.67,0,-1.74),new V(.67,2.86,1.85)):catalog[kind]?new THREE.Box3().setFromObject(this.actor.root):null;
  this.clock=0;this.action=catalog[kind]?Object.keys(catalog[kind].actions)[0]:kind==='squid'?'Swim':'Idle';this.level=0;this.angle='three-quarter';this.setAngle(this.angle);this.applyDebug();this.calculateMemory();this.render();
 }
 widePose(action){return this.kind==='hippogriff'?['Unfold','Fly','Glide','Bank','Takeoff','Descend','Land','Sequence'].includes(action):this.kind==='owl'&&['Unfold','Flap','Fly'].includes(action)}
 setAction(action){
  const reframe=this.widePose(action)!==this.widePose(this.action);
  this.action=action;
  if(reframe&&!this.free)this.setAngle(this.angle);
 }
 setAngle(angle){
  this.free=false;this.angle=angle;this.target.set(this.kind==='squid'?1.25:0,this.kind==='squid'?0:1.05,0);let radius=this.fit();
  if(angle==='close-up'){this.target.set(this.kind==='squid'?-.55:0,this.kind==='squid'?-.03:1.18,this.kind==='squid'?.25:1);radius=this.kind==='squid'?4.8:2.7}
  else if(angle==='habitat')radius*=1.44;
  if(this.bounds){
    this.bounds.getCenter(this.target);
    if(this.kind==='owl'&&this.widePose(this.action))this.target.y+=.24;
    if(angle==='close-up'){const size=this.bounds.getSize(new V());this.target.y+=size.y*.28;this.target.z+=size.z*.22;radius=this.fit()*.48}
  }
  if(this.kind==='merperson'&&angle==='close-up'){
    this.actor.head.getWorldPosition(this.target);this.target.y+=.20;this.target.z+=.06;radius=.98;
  }else this.target.add(this.actor?.root.position||new V());
  const dir=(this.kind==='merperson'&&merpersonViews[angle])||(this.kind!=='squid'&&spiderViews[angle])||directions[angle]||directions['three-quarter'];
  this.spherical.setFromVector3(new V(...dir).normalize().multiplyScalar(radius));this.orbit()
 }
 fit(){if(this.bounds){const s=this.bounds.getSize(new V());if(this.kind==='hippogriff'&&this.widePose(this.action))s.x=7.92;if(this.kind==='owl'&&this.widePose(this.action)){s.x=1.55;s.y+=.48}return Math.max(s.y*1.95,Math.max(s.x,s.z)*1.9/this.camera.aspect)+s.z*.32}const width=this.kind==='squid'?18.3:7.8;return Math.max(width/(2*Math.tan(THREE.MathUtils.degToRad(19.5))*this.camera.aspect),this.kind==='squid'?9.2:5.6)}
 orbit(){this.camera.position.copy(this.target).add(new V().setFromSpherical(this.spherical));this.camera.lookAt(this.target);if(this.kind==='squid')this.camera.rotateZ(-.085)}
 bindCamera(){
  const c=this.canvas;c.addEventListener('pointerdown',e=>{c.focus({preventScroll:true});c.setPointerCapture(e.pointerId);this.drag=[e.clientX,e.clientY]});c.addEventListener('pointerup',()=>this.drag=null);c.addEventListener('pointercancel',()=>this.drag=null);
  c.addEventListener('pointermove',e=>{if(!this.drag)return;let dx=e.clientX-this.drag[0],dy=e.clientY-this.drag[1];this.drag=[e.clientX,e.clientY];if(this.free){this.camera.rotation.order='YXZ';this.camera.rotation.y-=dx*.005;this.camera.rotation.x=THREE.MathUtils.clamp(this.camera.rotation.x-dy*.005,-1.5,1.5)}else{this.spherical.theta-=dx*.006;this.spherical.phi=THREE.MathUtils.clamp(this.spherical.phi-dy*.006,.03,Math.PI-.03);this.orbit()}});
  c.addEventListener('wheel',e=>{e.preventDefault();if(this.free)this.camera.translateZ(e.deltaY*.01);else{this.spherical.radius=THREE.MathUtils.clamp(this.spherical.radius*Math.exp(e.deltaY*.001),this.bounds?this.fit()*.09:1,95);this.orbit()}},{passive:false});
  c.addEventListener('dblclick',e=>{let r=c.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,1-(e.clientY-r.top)/r.height*2),this.camera);this.context.stimulus=ray.ray.at(this.camera.position.distanceTo(this.target),new V());this.onStimulus?.()});
  window.addEventListener('keydown',e=>{if(document.activeElement===c)this.keys.add(e.code)});window.addEventListener('keyup',e=>this.keys.delete(e.code));window.addEventListener('blur',()=>this.keys.clear())
 }
 setDistance(d){this.setAngle('three-quarter');this.spherical.radius*=({near:1,medium:2,far:3.7})[d]||1;this.orbit()}
 setCopies(n){if(this.extra){this.restoreMaterials(this.extra);this.extra.dispose();this.extra=null}if(n===2){this.extra=new species[this.kind]();if(this.kind==='hippogriff'){this.extra.prepare();habitatFinish(this.extra)}this.extra.setLOD(this.level);this.extra.setPosition(new V(this.kind==='squid'?1:3,0,this.kind==='squid'?-4:-2));this.scene.add(this.extra.root);this.applyDebug()}this.calculateMemory()}
 setLOD(l){this.auto=l==='auto';if(this.auto)return;let v=Number(l);if(this.level===v)return;this.actor.setLOD(v);this.extra?.setLOD(v);this.level=v;if(this.kind==='hippogriff')for(const actor of [this.actor,this.extra])if(actor)for(const {mesh} of actor.parts)surfaceAttribute(mesh,v);this.applyDebug();this.calculateMemory()}
 restoreMaterials(actor){actor.root.traverse(o=>{if(this.original.has(o))o.material=this.original.get(o)})}
 applyDebug(){for(const a of [this.actor,this.extra])a?.root.traverse(o=>{if(!o.isMesh)return;if(!this.original.has(o))this.original.set(o,o.material);const m=this.original.get(o);o.material=this.normals?this.normalMat:(this.inspectionMaterials[this.mode]||m);for(const mat of [].concat(o.material))mat.wireframe=this.wire})}
 calculateMemory(){const seen=new Set();let size=0;this.scene.traverse(o=>{for(const a of [o.instanceMatrix,o.instanceColor,o.geometry?.index,...Object.values(o.geometry?.attributes||{})]){const b=a?.array?.buffer;if(b&&!seen.has(b)){size+=b.byteLength;seen.add(b)}}});this.bytes=size}
 advance(dt){const previous=this.actor.root.position.clone();this.clock+=dt;const context=this.kind==='hippogriff'&&this.mode!=='habitat'?{...this.context,studio:true,terrainHeight:()=>0}:this.context;
this.actor.update(dt,this.clock,this.action,context);this.extra?.update(dt,this.clock+.82,this.action,context);this.hab.update(dt,this.clock);if(!this.free&&this.kind!=='squid'){const travel=this.actor.root.position.clone().sub(previous);this.target.add(travel);this.camera.position.add(travel)}}
 plates(kind,mode){return comparisonPlates(this.renderer,kind,species[kind],mode)}
 setInspection(mode){
  if(this.kind==='hippogriff' && (mode==='habitat')!==(this.mode==='habitat')){
    for(const actor of [this.actor,this.extra])actor?.contacts.forEach(c=>{c.anchor=null});
  }
  this.mode=mode;
  if(['motion','silver','woodland'].includes(mode)&&this.kind==='hippogriff')this.motionStudio??=new MotionStudio(this.canvas);
  if(this.motionStudio)this.motionStudio.canvas.style.display=['motion','silver','woodland'].includes(mode)&&this.kind==='hippogriff'?'block':'none';
  this.applyDebug()
 }
 get nativeMotion(){return ['motion','silver','woodland'].includes(this.mode)&&this.kind==='hippogriff'&&!this.extra&&!this.wire&&!this.normals&&this.motionStudio&&!this.motionStudio.error}
 get captureCanvas(){return this.nativeMotion?this.motionStudio.canvas:this.canvas}
 renderMotion(width=this.canvas.width,height=this.canvas.height){
   if(this.motionFrame)return this.motionFrame;
   this.motionStudio.finish=this.mode!=='motion';this.motionStudio.woodland=this.mode==='woodland';
   this.motionFrame=this.motionStudio.draw(this.actor,this.camera,width,height).finally(()=>this.motionFrame=null);
   return this.motionFrame;
 }
 render(){
  if(this.motionStudio)this.motionStudio.canvas.style.display=this.nativeMotion?'block':'none';
  if(this.nativeMotion){
    if(!this.motionFrame)this.renderMotion().catch(()=>{this.setInspection('neutral')});return;
  }
  if(this.mode==='habitat'){this.renderer.render(this.scene,this.camera);return}
  const scene=this.scene,fog=scene.fog,back=scene.background;
  this.hab.group.visible=false;this.studio.visible=true;scene.fog=null;scene.background=background;
  try{this.renderer.render(scene,this.camera)}
  finally{this.hab.group.visible=true;this.studio.visible=false;scene.fog=fog;scene.background=back}
 }
 loop=(stamp)=>{
  requestAnimationFrame(this.loop);if(!this.actor)return;const delta=this.previous?stamp-this.previous:16.67;this.previous=stamp;let dt=Math.min(.06,delta/1000);
  if(this.free){let k=this.keys,v=dt*(k.has('ShiftLeft')?12:4);this.camera.translateZ(v*(+k.has('KeyS')-k.has('KeyW')));this.camera.translateX(v*(+k.has('KeyD')-k.has('KeyA')));this.camera.position.y+=v*(+k.has('KeyE')-k.has('KeyQ'))}
  if(this.auto){const r=this.spherical.radius,f=this.fit(),lvl=this.level;const next=r>f*(lvl===2?2.7:3.2)?2:r>f*(lvl>=1?1.45:1.7)?1:0;if(next!==lvl){this.setLOD(next);this.auto=true}}
  const start=performance.now();if(this.running)this.advance(dt*this.speed);const anim=performance.now()-start;
  const gl=this.gl,ext=this.nativeMotion?null:this.gpuExt;let q;if(ext){if(gl.getParameter(ext.GPU_DISJOINT_EXT)){for(const p of this.queries)gl.deleteQuery(p);this.queries.length=0;this.gpuMs=null}else if(this.queries.length&&gl.getQueryParameter(this.queries[0],gl.QUERY_RESULT_AVAILABLE)){const p=this.queries.shift();this.gpuMs=gl.getQueryParameter(p,gl.QUERY_RESULT)/1e6;gl.deleteQuery(p)}if(this.queries.length<4){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q)}}
  this.render();if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);this.queries.push(q)}
  const r=this.renderer.info.render;this.metric={cpuMs:performance.now()-start,animationMs:anim,frameMs:delta,gpuMs:this.nativeMotion?null:this.gpuMs,triangles:this.nativeMotion?(this.motionStudio.triangles??0):r.triangles,drawCalls:this.nativeMotion?(this.actor.open>0?3:2):r.calls,geometryBytes:this.bytes,renderer:this.nativeMotion?this.motionStudio.adapter:this.rendererName};this.samples.push(delta);if(this.samples.length>24)this.samples.shift();if(stamp-this.lastLabel>280){this.lastLabel=stamp;this.onFrame(this.metric,this.samples.reduce((a,b)=>a+b,0)/this.samples.length)}
 }
}
