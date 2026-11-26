// Served by capture-owl-a3.py. Both revisions use the baseline root to frame a take.
import * as T from '/creature-lab/vendor/three.module.js';
import {Owl as BaselineOwl} from '/creature-lab/species/a2-owl.js';
import {Owl as RevisedOwl} from '/creature-lab/species/owl.js';
import {studioLights} from '/creature-lab/inspection.js';
const baseline=2;
const width=640,height=500,renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(width,height);renderer.setClearColor(0xb3b8b6);
const scene=new T.Scene(),camera=new T.OrthographicCamera(),V=v=>new T.Vector3(...v);
const clay=new T.MeshStandardMaterial({color:0xc5bbb0,roughness:.88,side:T.DoubleSide});
const silhouette=new T.MeshBasicMaterial({color:0x202a2a,side:T.DoubleSide});
scene.add(studioLights());
const perch=new T.Mesh(new T.CylinderGeometry(.017,.019,.44,32),new T.MeshStandardMaterial({color:0x76614f}));
perch.rotation.z=Math.PI/2;perch.position.set(0,-.006,.011);scene.add(perch);
const views={
  headFront:[[0,.24,.046],[0,.015,1],.16],headSide:[[0,.24,.046],[1,.02,0],.16],
  front:[[0,.145,0],[0,.025,1],.36],side:[[0,.145,-.018],[1,.025,0],.36],
  rear:[[0,.145,0],[0,.025,-1],.36],quarter:[[0,.145,0],[.82,.14,1],.36],
  face:[[0,baseline>=4?.235:.246,.044],[.14,.06,1],.147],breast:[[0,.148,.037],[.45,.045,1],.153],flying:[[0,.40,.085],[.21,.16,1],.84],
  folded:[[0,.153,-.062],[1,.34,-.30],.245],above:[[0,.19,-.08],[0,1,.005],.80],
  below:[[0,.19,-.08],[0,-1,.005],.80],silhouette:[[0,.141,-.025],[1,.04,.16],.36],
  legs:[[0,.057,0],[.93,.02,.38],.144],talons:[[0,.017,.010],[.75,.16,1],.094],travel:[[0,.29,.04],[.71,.18,1],.88],
  flight:[[0,.4,.085],[.58,.22,1],.84]
};
let birds,t;
function reset(){
  birds?.forEach(b=>b.dispose());birds=[new BaselineOwl(),new RevisedOwl()];t=0;
  for(const bird of birds)scene.add(bird.root);
}
function step(action,ctx){t+=1/60;for(const bird of birds)bird.update(1/60,t,action,ctx)}
function aim(view,version=0){
  const [center,dir,h]=views[view],wide=h*width/height;
  camera.left=-wide/2;camera.right=wide/2;camera.top=h/2;camera.bottom=-h/2;camera.near=.01;camera.far=12;
  const root=birds[version].root,target=V(center).applyQuaternion(root.quaternion).add(root.position);
  camera.position.copy(target).addScaledVector(V(dir).normalize().applyQuaternion(root.quaternion),2);camera.lookAt(target);camera.updateProjectionMatrix();
}
function capture(view,mode,bar){
  aim(view);perch.visible=!['above','below','flight','flying','face','breast','folded'].includes(view);
  scene.overrideMaterial=mode==='clay'?clay:mode==='silhouette'?silhouette:null;
  const c=document.createElement('canvas');c.width=2*width;c.height=height+34;const g=c.getContext('2d');
  g.fillStyle='#25312e';g.fillRect(0,0,c.width,34);g.font='18px system-ui';g.fillStyle='#f1ede4';
  for(let i=0;i<2;i++){
    birds.forEach((b,j)=>b.root.visible=i===j);renderer.render(scene,camera);
    g.drawImage(renderer.domElement,i*width,34);g.fillText('A.'+(i+baseline),i*width+18,23);
    if(bar){const m=views[view][2]>.60?.1:views[view][2]>.20?.05:.01;
      g.fillStyle='#2c322e';g.fillRect(i*width+15,height+14,m*height/views[view][2],2);
      g.font='14px system-ui';g.fillText(Math.round(m*100)+' cm',i*width+15,height+9);
      g.fillStyle='#f1ede4';g.font='18px system-ui'}
  }
  return c.toDataURL('image/jpeg',.94).split(',')[1];
}
window.plate=([view,mode])=>{
  reset();
  const frames=baseline===6&&!['above','below','flying'].includes(view)?0:120;
  for(let i=0;i<frames;i++)step(view==='flying'?'Fly':['above','below'].includes(view)?'Unfold':'Perch');
  return capture(view,['silhouette','flying'].includes(view)?'silhouette':mode,true);
};
window.frame=([action,i])=>{
  if(i===0){reset();if(['Fly','Bank','Glide','Land'].includes(action))for(let j=0;j<180;j++)step('Fly')}
  for(let j=0;j<3;j++)step(action==='Look'&&i<20?'Perch':action,{stimulus:V([.4*Math.sin(i/14),.29+.08*Math.sin(i/22),.34])});
  return capture(action==='Look'?'quarter':['Takeoff','Land'].includes(action)?'travel':'flight','material',false);
};
window.measure=(reverse=false)=>{
  const gl=renderer.getContext(),readback=new Uint8Array(4),rows=[];
  for(let lod=0;lod<3;lod++)for(const version of reverse?[1,0]:[0,1]){
    reset();birds.forEach((b,i)=>{b.root.visible=i===version;b.setLOD(lod)});
    const bird=birds[version];for(let j=0;j<180;j++)step('Fly');
    scene.overrideMaterial=null;perch.visible=false;
    const times=[],updates=[];
    for(let i=0;i<44;i++){
      // Advance the shared camera clock outside the timed section.
      if(version===1)birds[0].update(1/60,t+1/60,'Fly');
      const start=performance.now();
      bird.update(1/60,t+=1/60,'Fly');
      const updateMs=performance.now()-start;
      aim('flight',baseline===6?version:0);
      renderer.render(scene,camera);gl.readPixels(320,250,1,1,gl.RGBA,gl.UNSIGNED_BYTE,readback);
      if(i>=12){
        times.push(performance.now()-start);
        updates.push(updateMs);
      }
    }
    times.sort((a,b)=>a-b);updates.sort((a,b)=>a-b);
    let textureBytes=0;
    for(const map of bird.maps){
      let w=map.image.width,h=map.image.height;
      for(;;){textureBytes+=4*w*h;if(w===1&&h===1)break;w=Math.max(1,w>>1);h=Math.max(1,h>>1)}
    }
    let vertices=0,geometryBytes=0,morphBytes=0;
    const seen=new Set();
    bird.root.traverse(o=>{
      if(!o.isMesh || seen.has(o.geometry))return;
      const g=o.geometry;
      seen.add(g);
      vertices+=g.attributes.position.count;
      geometryBytes+=g.index?.array.byteLength??0;
      for(const attr of Object.values(g.attributes))geometryBytes+=attr.array.byteLength;
      for(const attrs of Object.values(g.morphAttributes))for(const attr of attrs)morphBytes+=attr.array.byteLength;
    });
    rows.push({revision:'A.'+(version+baseline),lod,triangles:renderer.info.render.triangles,
      vertices,geometryBytes,morphBytes,samples:times,updateSamples:updates,calls:renderer.info.render.calls,textureBytes,medianMs:(times[15]+times[16])/2,p95Ms:times[30],medianAnimationMs:(updates[15]+updates[16])/2});
  }
  reset();const bounds=()=>birds.map(b=>new T.Box3().setFromObject(b.root,true).getSize(new T.Vector3()).toArray());
  const perched=bounds();for(let i=0;i<180;i++)step('Unfold');
  const adapter=gl.getExtension('WEBGL_debug_renderer_info');
  return {width,height,perched,spread:bounds(),rows,renderer:adapter?gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL):'Unidentified'};
};

window.tractPlate=()=>{
  const palette={scapulars:0xb76756,primaries:0x425d84,secondaries:0x719fc7,greater:0x558269,median:0xcb9c48,lesser:0xcdbfa3};
  const c=document.createElement('canvas');c.width=width*2;c.height=height+34;
  const ctx=c.getContext('2d');ctx.fillStyle='#25312e';ctx.fillRect(0,0,c.width,34);ctx.fillStyle='white';ctx.font='18px system-ui';
  for(const [i,view] of ['folded','above'].entries()){
    reset();for(let j=0;j<180;j++)step(i?'Unfold':'Perch');
    birds[0].root.visible=false;perch.visible=false;scene.overrideMaterial=null;aim(view);
    const study=new T.MeshBasicMaterial({side:T.DoubleSide,vertexColors:true});
    birds[1].root.traverse(part=>{
      if(!part.isMesh)return;
      if(!part.geometry.userData.tracts){part.material=clay;return}
      const color=part.geometry.attributes.color;
      for(const tract of part.geometry.userData.tracts){
        const ink=new T.Color(palette[tract.name]);
        for(let j=tract.first;j<tract.end;j++)color.setXYZ(j,ink.r,ink.g,ink.b);
      }
      color.needsUpdate=true;part.material=study;
    });
    renderer.render(scene,camera);ctx.drawImage(renderer.domElement,i*width,34);
    ctx.fillText(i?'Extended':'Folded',i*width+18,24);study.dispose();
  }
  return c.toDataURL('image/jpeg',.96).split(',')[1];
};
