import * as T from '/creature-lab/vendor/three.module.js';
import {Owl as A7} from '/creature-lab/species/a7-owl.js';
import {Owl as A8} from '/creature-lab/species/owl.js';
import {OwlTimeline,inspectOwlContact} from '/creature-lab/species/owl-inspection.js';

const V=(...p)=>new T.Vector3(...p);
const lights={
  studio:{background:0x686d67,sky:0xf5f6ff,ground:0xb4a89b,ambient:1.18,key:[0xfff5e8,2.8,[-.42,.70,.85]],fill:[0xe3eeff,1.0,[.50,.31,-.47]],exposure:1},
  daylight:{background:0x535e45,sky:0xd8eaff,ground:0x776347,ambient:1.34,key:[0xfff2d9,3.15,[-.51,.84,.53]],fill:[0xdce9ff,.45,[.26,.48,-.37]],exposure:1},
  overcast:{background:0x60696a,sky:0xebf2ff,ground:0x968b80,ambient:1.90,key:[0xf5f7ff,1.12,[-.66,.72,.57]],fill:[0xc7d6e1,.68,[.51,.64,-.37]],exposure:1},
  sunset:{background:0x574739,sky:0xb8c7ec,ground:0x8b5e45,ambient:.88,key:[0xffb16b,3.35,[.72,.39,-.58]],fill:[0xe6d7c5,.80,[-.42,.25,.80]],exposure:1},
  moonlit:{background:0x202b37,sky:0x98b8ea,ground:0x343c49,ambient:.46,key:[0xc4d9ff,1.95,[-.50,.75,.28]],fill:[0x6d97c9,.44,[.27,.28,-.66]],exposure:1},
  candlelight:{background:0x30251c,sky:0xb39379,ground:0x68433a,ambient:.52,point:[0xffbf7b,.82,[-.29,.23,.36]],fill:[0x9ea9c7,.42,[.24,.37,-.36]],exposure:1}
};
const views={
  front:[[0,.152,.012],[0,.035,1],.356],
  side:[[0,.151,-.023],[1,.065,0],.358],
  rear:[[0,.156,-.022],[0,.065,-1],.355],
  quarter:[[0,.149,.004],[.78,.18,1],.362],
  face:[[0,.244,.073],[.20,.07,1],.143],
  eye:[[.024,.232,.105],[.28,.09,1],.049],
  breast:[[0,.159,.058],[.37,.10,1],.144],
  dorsal:[[0,.172,-.060],[.55,.72,-.88],.165],
  folded:[[0,.158,-.038],[1,.25,-.24],.272],
  spread:[[0,.205,-.063],[0,1,.13],.77],
  ventral:[[0,.202,-.086],[0,-1,.13],.77],
  legs:[[0,.063,.012],[.84,.13,.65],.135],
  talons:[[0,.017,.011],[.73,.20,1],.088]
};
const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);
renderer.toneMapping=T.ACESFilmicToneMapping;
const gl=renderer.getContext();
const scene=new T.Scene(),camera=new T.OrthographicCamera();
const branch=new T.Mesh(new T.CylinderGeometry(.017,.019,.44,32),new T.MeshStandardMaterial({color:0x69513c,roughness:.94}));
branch.rotation.z=Math.PI/2;
branch.position.set(0,-.006,.011);
scene.add(branch);
const rig=new T.Group();
scene.add(rig);
const specimens=[new A7(),new A8()];
const timelines=specimens.map(owl=>new OwlTimeline(owl));
specimens.forEach(owl=>scene.add(owl.root));

let activeLighting;
function lighting(name){
  if(name===activeLighting)return;
  activeLighting=name;
  const {background,sky,ground,ambient,key,fill,point,exposure}=lights[name];
  rig.clear();
  scene.background=new T.Color(background);
  rig.add(new T.HemisphereLight(sky,ground,ambient));
  for(const [color,intensity,position] of [key,fill].filter(Boolean)){
    const lamp=new T.DirectionalLight(color,intensity);
    lamp.position.set(...position);
    rig.add(lamp);
  }
  if(point){
    const [color,intensity,position]=point;
    const lamp=new T.PointLight(color,intensity,0,2);
    lamp.position.set(...position);
    rig.add(lamp);
  }
  renderer.toneMappingExposure=exposure;
}

function aim(target,direction,height,widthPixels,heightPixels){
  camera.position.copy(target).addScaledVector(direction.normalize(),2);
  camera.lookAt(target);
  const half=height*.5,right=half*widthPixels/heightPixels;
  camera.left=-right;camera.right=right;camera.top=half;camera.bottom=-half;
  camera.near=.02;camera.far=20;
  camera.updateProjectionMatrix();
}

function panel(width,height,labelHeight=0){
  const canvas=document.createElement('canvas');
  canvas.width=2*width;canvas.height=height+labelHeight;
  const ctx=canvas.getContext('2d');
  if(labelHeight){ctx.fillStyle='#263330';ctx.fillRect(0,0,canvas.width,labelHeight);}
  return {canvas,ctx};
}

function pair(width,height,tag='',labels=true){
  const h=labels?32:0,{canvas,ctx}=panel(width,height,h);
  renderer.setSize(width,height,false);
  for(const i of specimens.keys()){
    specimens.forEach((candidate,j)=>{candidate.root.visible=i===j;});
    renderer.render(scene,camera);
    ctx.drawImage(renderer.domElement,i*width,h);
    if(labels){ctx.fillStyle='#f4eadc';ctx.font='15px system-ui';ctx.fillText((i?'A8':'A7')+(tag?' · '+tag:''),14+i*width,21);}
  }
  return canvas;
}
const jpeg=canvas=>canvas.toDataURL('image/jpeg',.94).split(',')[1];

function stage(action){
  specimens.forEach((owl,i)=>{
    timelines[i].seek(0);
    owl.resetMotion();
    owl.setLOD(0);
    if(action==='Unfold')owl.update(2,2,action);
  });
}

function plate(view,light='studio',width=680,height=510){
  stage(['spread','ventral'].includes(view)?'Unfold':'Perch');
  branch.visible=['front','side','rear','quarter','legs','talons'].includes(view);
  lighting(light);
  const [position,dir,scale]=views[view];
  aim(V(...position),V(...dir),scale,width,height);
  return jpeg(pair(width,height,light));
}

function motion(frame,view,light='daylight'){
  if(frame===0)stage('Perch');
  timelines.forEach(timeline=>timeline.seek(frame));
  const root=specimens[0].root,pose=specimens[0].motion.pose,width=560,height=320;
  lighting(light);
  let focus,direction,scale;
  if(view==='perch'){
    focus=V();
    for(const {pad} of specimens[0].feet)focus.add(pad.getWorldPosition(V()));
    focus.multiplyScalar(.5);focus.y+=.150;
    direction=V(.85,.15,.87);scale=.54;
  }else{
    focus=V(0,.195+pose.air*.201,.045).applyQuaternion(root.quaternion).add(root.position);
    direction=V(.66,.22,1).applyQuaternion(root.quaternion);scale=.95;
  }
  branch.visible=view==='perch';
  aim(focus,direction,scale,width,height);
  const state={Fly:'Powered flight',Look:'Tracking',Perch:'Perched',Land:'Landing'}[pose.state]??pose.state;
  return jpeg(pair(width,height,`${state} · ${(frame/60).toFixed(2)} s`));
}

function geometryBytes(owl){
  const found=new Set();
  let geometry=0,morph=0,vertices=0;
  for(const {mesh} of owl.parts){
    const g=mesh.geometry;
    if(found.has(g))continue;
    found.add(g);
    vertices+=g.attributes.position.count;
    geometry+=g.index?.array.byteLength??0;
    for(const attr of Object.values(g.attributes))geometry+=attr.array.byteLength;
    for(const attrs of Object.values(g.morphAttributes))for(const attr of attrs)morph+=attr.array.byteLength;
  }
  let texture=0;
  for(const map of owl.maps){
    for(let w=map.image.width,h=map.image.height;;w=Math.max(1,w>>1),h=Math.max(1,h>>1)){
      texture+=4*w*h;
      if(w===1&&h===1)break;
    }
  }
  return {vertices,geometryBytes:geometry,morphBytes:morph,textureBytes:texture};
}

function configure(owl,variant){
  const material=owl.wings[0].joints[0].children.find(o=>o.isMesh).material;
  // Override only the wing program for the experimental rows.
  const compile=material.onBeforeCompile,key=material.customProgramCacheKey,defines=material.defines;
  if(variant==='A7 no transmission'){
    material.onBeforeCompile=function(shader,r){
      compile.call(this,shader,r);
      if(!shader.fragmentShader.includes('0.72*RECIPROCAL_PI'))throw new Error('A7 transmission term not found');
      shader.fragmentShader=shader.fragmentShader.replace('0.72*RECIPROCAL_PI','0.0*RECIPROCAL_PI');
    };
  }
  if(variant==='A8 full wing finish')material.defines={...defines,OWL_FINISH_DETAIL:1};
  if(variant==='A8 fold morph only'){
    material.onBeforeCompile=function(shader,r){
      compile.call(this,shader,r);
      for(const name of ['morphnormal_vertex','morphtarget_vertex']){
        const chunk=T.ShaderChunk[name].replace('i < MORPHTARGETS_COUNT','i < 1');
        shader.vertexShader=shader.vertexShader.replace(`#include <${name}>`,chunk);
      }
    };
  }
  material.customProgramCacheKey=function(){return key.call(this)+'/'+variant;};
  material.needsUpdate=true;
  return ()=>{
    material.onBeforeCompile=compile;material.customProgramCacheKey=key;material.defines=defines;
    material.needsUpdate=true;
  };
}

function benchmark(lod,variant,coverage){
  const baseline=variant.startsWith('A7'),owl=specimens[baseline?0:1];
  const width=640,height=500,physical=new Uint8Array(4);
  const startFrame=595,frames=42,warm=14;
  owl.resetMotion();
  owl.update(startFrame/60,startFrame/60,'Fly');
  owl.setLOD(lod);
  specimens.forEach(o=>{o.root.visible=o===owl;});
  const restore=configure(owl,variant);
  branch.visible=false;lighting('studio');renderer.setSize(width,height,false);
  const timing=[],cpu=[];
  try{
    for(let i=0;i<warm+frames;i++){
      const start=performance.now();
      owl.update(1/60,(startFrame+i)/60,'Fly');
      const animated=performance.now();
      const target=V(0,.414,.085).applyQuaternion(owl.root.quaternion).add(owl.root.position);
      const direction=V(.58,.22,1).applyQuaternion(owl.root.quaternion);
      aim(target,direction,coverage==='distant'?2.15:.84,width,height);
      renderer.render(scene,camera);
      gl.readPixels(320,250,1,1,gl.RGBA,gl.UNSIGNED_BYTE,physical);
      const elapsed=performance.now()-start;
      if(i>=warm){timing.push(elapsed);cpu.push(animated-start);}
    }
    const {triangles,calls}=renderer.info.render;
    return {lod,variant,coverage,triangles,calls,...geometryBytes(owl),samples:timing,updates:cpu};
  }finally{restore();}
}

function identity(){
  const checks=[];
  const shape=['position'];
  const morphs=['position','normal'];
  const same=(a,b)=>a.length===b.length&&a.every((n,i)=>n===b[i]);
  for(let lod=0;lod<3;lod++){
    stage('Perch');
    specimens.forEach(owl=>owl.setLOD(lod));
    const [a,b]=specimens;
    const exactMesh=a.parts.length===b.parts.length&&a.parts.every(({mesh},i)=>{
      const g=mesh.geometry,h=b.parts[i].mesh.geometry;
      return same(g.index.array,h.index.array)&&shape.every(name=>same(g.attributes[name].array,h.attributes[name].array))
        &&morphs.every(name=>{
          const m=g.morphAttributes[name]??[],n=h.morphAttributes[name]??[];
          return m.length===n.length&&m.every((x,j)=>same(x.array,n[j].array));
        });
    });
    let matchedMotion=true,matchedContact=true;
    for(const frame of [0,230,510,532,567,630,763,870,964,1089,1112,1140,1220]){
      timelines.forEach(t=>t.seek(frame));
      const matrices=specimens.map(owl=>{
        owl.root.updateMatrixWorld(true);
        const values=[];
        owl.root.traverse(object=>values.push(...object.matrixWorld.elements,...(object.morphTargetInfluences??[])));
        return values;
      });
      matchedMotion&&=same(...matrices);
      matchedContact&&=JSON.stringify(inspectOwlContact(a))===JSON.stringify(inspectOwlContact(b));
    }
    checks.push({lod,exactPositionIndexAndMorphBuffers:exactMesh,matchedPoseMatricesAndMorphWeights:matchedMotion,matchedFootPositionsAndClearance:matchedContact});
  }
  return checks;
}

const debug=gl.getExtension('WEBGL_debug_renderer_info');
window.owlA8={plate,motion,benchmark,identity,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'Unidentified'};
