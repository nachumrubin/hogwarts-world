// Called from the running Creature Lab with its actor, camera and lighting.
import {MotionStudio} from '../../hippogriff-studio.js';
import {SurfaceStudy} from './study.js';
const views={
 face:[-.93,.86,.12,0,2.60,1.32],chest:[-.72,1.58,.08,0,1.77,.71],
 coat:[-1.38,1.85,.10,0,1.43,-.68],tail:[-2.18,2.32,.11,0,1.05,-1.32]
};
export async function captureStudy(lab,region,save){
 const study=new SurfaceStudy(region),renderer=new MotionStudio(lab.canvas,study);
 await renderer.ready;
 renderer.finish=true;renderer.woodland=false;const info={region,adapter:renderer.adapter,timestamp:!!study.query,textureBytes:study.textureBytes,maskFill:study.fill,frames:[]};
 try{
 for(const mode of ['macro','game']){
  const macro=mode==='macro',w=macro?1280:960,h=macro?800:600;
  lab.setLOD(macro?0:1);lab.camera.aspect=w/h;lab.camera.updateProjectionMatrix();
  const [angle,r,elev,x,y,z]=macro?views[region]:[region==='tail'?-2.15:-1.14,6.0,.14,0,1.45,0];
  lab.target.copy(lab.actor.root.position);lab.target.x+=x;lab.target.y+=y;lab.target.z+=z;
  lab.spherical.set(r,Math.PI/2-elev,angle);lab.orbit();
  for(const revision of ['e2','e3']){
   study.control=revision==='e2';renderer.actor=null;study.profile=false;
   await renderer.draw(lab.actor,lab.camera,w,h);
   const display=renderer.image;for(let i=3;i<display.data.length;i+=4)display.data[i]=255;
   renderer.cpuCanvas.putImageData(display,0,0);await save(region+'-'+mode+'-'+revision,renderer.canvas);
   const timing=[];study.profile=true;
   for(let i=0;i<(macro?3:6);i++){
    await renderer.draw(lab.actor,lab.camera,w,h);if(i)timing.push(study.timing);
   }
   info.frames.push({mode,revision,triangles:renderer.triangles,draws:3+Number(renderer.runs[4]>0),studyTriangles:renderer.runs[4]/3,
    overdraw:study.control?null:await study.overlap(renderer),vertexBytes:renderer.vb.size,indexBytes:renderer.ib.size,timing});
   if(!macro&&!study.control&&study.mixed){
    const specialized=study.pipeline;study.pipeline=study.mixed;info.uniformDispatch=[];
    for(let i=0;i<6;i++){await renderer.draw(lab.actor,lab.camera,w,h);if(i)info.uniformDispatch.push(study.timing);}
    study.pipeline=specialized;
   }
  }
 }
 }finally{renderer.canvas.remove();renderer.device.destroy();}
 return info;
}
