import * as T from '../../vendor/three.module.js';
import {Owl} from '../../species/owl.js';

const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
const counts=[1,5,10,25,50];
const warmup=24,measured=90;
function median(samples){
  const sorted=[...samples].sort((a,b)=>a-b);
  const middle=Math.floor(sorted.length/2);
  return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
}

export async function measure(renderer,lod,count,warm,frames){
  const scene=new T.Scene(),camera=new T.OrthographicCamera();
  scene.background=new T.Color(0x686d67);
  const key=new T.DirectionalLight(0xfff5e8,2.8);
  key.position.set(-.42,.70,.85);
  scene.add(key,new T.HemisphereLight(0xf5f6ff,0xb4a89b,1.18));
  const owls=[],gl=renderer.getContext(),pixel=new Uint8Array(4);
  const columns=Math.ceil(Math.sqrt(count*16/9)),rows=Math.ceil(count/columns);
  const height=Math.max(.64*rows,.94*columns*9/16);
  camera.top=height/2;camera.bottom=-height/2;
  camera.right=height*8/9;camera.left=-camera.right;camera.near=.01;camera.far=30;
  camera.updateProjectionMatrix();
  const target=new T.Vector3(),direction=new T.Vector3();
  try{
    for(let i=0;i<count;i++){
      const owl=new Owl();
      owls.push(owl);
      owl.setLOD(lod);owl.update(2,2,'Fly');
      // Grid offsets are in the camera plane. Preserve the identical specimen pose at every count.
      const cell=new T.Group();
      cell.add(owl.root);scene.add(cell);
      cell.userData.offset=new T.Vector3(((i%columns)-(columns-1)/2)*.94,((rows-1)/2-Math.floor(i/columns))*.64,0);
      if(i%5===4)await nextFrame();
    }
    const elapsed=[],updates=[];
    for(let i=0;i<warm+frames;i++){
      await nextFrame();
      if(document.hidden||gl.isContextLost())throw Error('Measurement interrupted by a hidden tab or lost WebGL context.');
      const start=performance.now();
      for(const owl of owls)owl.update(1/60,2+i/60,'Fly');
      const animated=performance.now(),lead=owls[0];
      target.set(0,.414,.085).applyQuaternion(lead.root.quaternion).add(lead.root.position);
      direction.set(.58,.22,1).applyQuaternion(lead.root.quaternion).normalize();
      camera.position.copy(target).addScaledVector(direction,4);camera.lookAt(target);
      for(const owl of owls){
        const cell=owl.root.parent;
        // Offsets stay screen aligned while the specimens follow their circular flight paths.
        cell.position.copy(cell.userData.offset).applyQuaternion(camera.quaternion);
      }
      renderer.render(scene,camera);
      gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      if(i>=warm){elapsed.push(performance.now()-start);updates.push(animated-start);}
    }
    const {calls,triangles}=renderer.info.render;
    if(calls!==14*count)throw Error('Unexpected draw count '+calls+' for '+count+' owls');
    return {count,lod,calls,triangles,medianMs:median(elapsed),p95Ms:[...elapsed].sort((a,b)=>a-b)[Math.ceil(.95*elapsed.length)-1],
      medianUpdateMs:median(updates),elapsedMs:elapsed,updateMs:updates};
  }finally{for(const owl of owls)owl.dispose();scene.clear();renderer.renderLists.dispose();}
}

const run=document.querySelector('#run'),status=document.querySelector('#status'),save=document.querySelector('#save');
run.onclick=async()=>{
  run.disabled=true;save.hidden=true;
  let renderer;
  try{
    renderer=new T.WebGLRenderer({canvas:document.querySelector('#view'),antialias:true,powerPreference:'high-performance'});
    renderer.setPixelRatio(1);renderer.setSize(1280,720,false);renderer.toneMapping=T.ACESFilmicToneMapping;
    const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
    const adapter=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unidentified';
    if(/swiftshader|software|llvmpipe|lavapipe|softpipe|warp\b|basic render/i.test(adapter)||
      !/nvidia|geforce|quadro|radeon|intel|apple|adreno|mali|powervr|arc\(tm\)/i.test(adapter))
      throw Error('Hardware adapter could not be verified. Renderer reported '+adapter);
    const lod=Number(document.querySelector('#lod').value);
    const result={adapter,vendor:gl.getParameter(debug.UNMASKED_VENDOR_WEBGL),browser:navigator.userAgent,
      date:new Date().toISOString(),adapterClass:'hardware',resolution:[1280,720],warmup,measured,
      method:'Fixed viewport, fitted grid, update + draw + synchronous pixel readback. Wall time in milliseconds. RAF wait excluded.',rows:[]};
    for(const count of counts){
      status.textContent=adapter+'\nMeasuring '+count+' owls at LOD'+lod;
      result.rows.push(await measure(renderer,lod,count,warmup,measured));
    }
    if(save.href)URL.revokeObjectURL(save.href);
    save.href=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}));
    save.hidden=false;status.textContent=result.rows.map(r=>r.count+' owls   '+r.medianMs.toFixed(2)+' ms median   '+r.p95Ms.toFixed(2)+' ms p95').join('\n');
  }catch(e){status.textContent=e.message;}
  finally{renderer?.dispose();run.disabled=false;}
};
