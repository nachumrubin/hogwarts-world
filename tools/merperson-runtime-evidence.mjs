import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Run the normal Lab application and use its existing controls and renderer.
export async function openMerperson() {
  const {Lab}=await import(new URL('./lab.js',location.href));
  const control=document.querySelector('[data-creature="merperson"]');
  if(!document.querySelector('#load')?.hidden || !control?.onclick) return false;
  const setAction=Lab.prototype.setAction;
  let lab;
  Lab.prototype.setAction=function(...args) {
    lab=this;
    return setAction.apply(this,args);
  };
  try {
    control.click();
    if(document.querySelector('#viewState').textContent==='LIVE') document.querySelector('#play').click();
    const action=document.querySelector('#action');
    action.value='Idle';
    action.dispatchEvent(new Event('change'));
    if(!lab) throw Error('Merperson controls did not reach the Lab.');
  } finally {
    Lab.prototype.setAction=setAction;
  }
  // Paused Lab frames otherwise continue rendering in the background.
  lab.loop=()=>{};
  window.reviewLab=lab;
  for(let i=0;i<60;i++) lab.advance(1/60);
  lab.setAngle('three-quarter');
  lab.target.set(0,1.38,-.72);
  lab.spherical.theta=.73;
  lab.spherical.phi=1.42;
  lab.spherical.radius=4.13;
  lab.orbit();
  lab.render();
  return true;
}

async function measurements() {
  const lab=window.reviewLab;
  const configs=[
    {lod:0,copies:1,radius:4.13},
    {lod:1,copies:1,radius:8.26},
    {lod:2,copies:1,radius:15.28},
    {lod:1,copies:2,radius:8.26}
  ];
  const duration=values=>{
    const sorted=values.toSorted((a,b)=>a-b);
    const pick=q=>Number(sorted[Math.floor(q*(sorted.length-1))].toFixed(4));
    return {median:pick(.5),p95:pick(.95)};
  };
  const runs=[];
  for(const config of configs) {
    lab.switchCreature('merperson');
    lab.setAction('Swim');
    lab.setLOD(config.lod);
    lab.setCopies(config.copies);
    lab.setInspection('neutral');
    lab.renderer.setPixelRatio(1);
    lab.renderer.setSize(640,480,false);
    lab.camera.aspect=4/3;
    lab.camera.updateProjectionMatrix();
    lab.target.set(0,1.35,-.73);
    lab.spherical.set(config.radius,1.38,config.copies===2?-.52:.77);
    if(config.copies===2) lab.target.x=1.45;
    lab.orbit();
    const geometry=new Map();
    for(const actor of [lab.actor,lab.extra]) actor?.root.traverse(node=>{
      if(node.isMesh && node.visible) geometry.set(node,node.geometry);
    });
    const geometryBytes=()=>{
      const buffers=new Set();
      for(const [node] of geometry) {
        const g=node.geometry;
        for(const a of [g.index,...Object.values(g.attributes)]) {
          if(a) buffers.add(a.array.buffer);
        }
      }
      return Array.from(buffers).reduce((sum,b)=>sum+b.byteLength,0);
    };
    for(let i=0;i<24;i++) lab.advance(1/60);
    lab.render();
    // Batch high-resolution sampling for short CPU updates. Keep frame setup,
    // GPU submission and readback outside the timed actor work.
    const cpuSamples=[];
    const batches=20, batchSize=120;
    for(let i=0;i<batches;i++) {
      const start=performance.now();
      for(let j=0;j<batchSize;j++) lab.advance(1/60);
      cpuSamples.push((performance.now()-start)/batchSize);
    }
    const changedGeometry=Array.from(geometry).filter(([node,before])=>node.geometry!==before).length;
    runs.push({...config,animationAndLabUpdateMs:duration(cpuSamples),
      animationSamples:cpuSamples.length*batchSize,
      triangles:lab.renderer.info.render.triangles,drawCalls:lab.renderer.info.render.calls,
      geometryBytes:geometryBytes(),changedGeometry});
  }
  const renderer=lab.rendererName;
  const software=/swiftshader|llvmpipe|software/i.test(renderer);
  return {viewport:[640,480],mode:'neutral',renderer,software,
    browser:navigator.userAgent,gpuMs:null,gpuTimingStatus:software?'Software renderer. Hardware timing unmeasured.':'Hardware GPU timing was not sampled.',
    runs};
}

async function gpuMeasurements() {
  const lab=window.reviewLab;
  const gl=lab.gl,ext=lab.gpuExt;
  if(!ext || /swiftshader|llvmpipe|software/i.test(lab.rendererName)) return null;
  const runs=[];
  for(const [lod,copies,radius] of [[0,1,4.13],[1,1,8.26],[2,1,15.28],[1,2,8.26]]) {
    lab.switchCreature('merperson');
    lab.setLOD(lod);
    lab.setCopies(copies);
    lab.setInspection('neutral');
    lab.setAction('Swim');
    lab.renderer.setSize(640,480,false);
    lab.camera.aspect=4/3;
    lab.camera.updateProjectionMatrix();
    lab.target.set(copies===2?1.45:0,1.35,-.73);
    lab.spherical.set(radius,1.38,copies===2?-.52:.77);
    lab.orbit();
    const values=[];
    for(let i=0;i<20;i++) {
      lab.advance(1/60);
      const query=gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT,query);
      lab.render();
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      for(let j=0;j<20 && !gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE);j++) {
        await new Promise(resolve=>requestAnimationFrame(resolve));
      }
      if(!gl.getParameter(ext.GPU_DISJOINT_EXT) && gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)) {
        values.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);
      }
      gl.deleteQuery(query);
    }
    runs.push({lod,copies,samples:values});
  }
  return runs;
}

function movieFrame(frame) {
  const lab=window.reviewLab;
  if(frame===0) {
    // Use the production materials under the Lab's inspection lighting.
    lab.setInspection('material');
    lab.switchCreature('merperson');
    lab.renderer.setPixelRatio(1);
    lab.renderer.setSize(480,360,false);
    lab.camera.aspect=4/3;
    lab.camera.updateProjectionMatrix();
    lab.target.set(0,1.34,-.80);
    lab.spherical.set(4.23,1.41,1.11);
    lab.orbit();
  }
  const label=frame<20?'Idle':frame<63?'Swim':frame<97?'Turn':'Idle';
  lab.setAction(label);
  for(let i=0;i<3;i++) lab.advance(1/60);
  lab.render();
  return lab.canvas.toDataURL('image/png').split(',')[1];
}

export async function captureMerpersonRuntime({send,evaluate,retry,out,revision,webUrl}) {
  if(revision==='published') {
    const navigation=await send('Page.navigate',{url:webUrl});
    if(navigation.errorText) throw Error(navigation.errorText);
    await retry(async()=>{
      if(await evaluate('location.href')!==webUrl) throw Error('Waiting for the published Lab');
      if(!await evaluate('document.querySelector("#load")?.hidden')) throw Error('Waiting for published application controls');
    });
  }
  await retry(async()=>{
    if(!await evaluate('('+openMerperson.toString()+')()')) throw Error('Waiting for application controls');
  });
  if(revision!=='before'){
    const screenshot=await send('Page.captureScreenshot',{format:'png'});
    await writeFile(join(out,'runtime-'+revision+'.png'),Buffer.from(screenshot.data,'base64'));
  }
  if(revision==='published') return;
  const timings=await evaluate('('+measurements.toString()+')()');
  const gpu=await evaluate('('+gpuMeasurements.toString()+')()');
  if(gpu?.some(run=>run.samples.length)){
    timings.gpuMs=gpu;
    timings.gpuTimingStatus='WebGL elapsed-time queries on the identified hardware renderer.';
  }
  await writeFile(join(out,'performance-'+revision+'.json'),JSON.stringify(timings,null,2)+'\n');
  if(revision!=='after' || process.env.CREATURE_CAPTURE_SKIP_CLIP==='1') return;
  const video=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','20',
    '-c:v','png','-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','fast',
    '-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',join(out,'merperson-swim.mp4')],{stdio:['pipe','ignore','inherit']});
  const complete=new Promise((resolve,reject)=>{
    video.on('error',reject);
    video.on('exit',code=>code===0?resolve():reject(Error('ffmpeg exited with status '+code)));
  });
  try {
    await evaluate('window.movieFrame='+movieFrame.toString());
    for(let i=0;i<122;i++){
      const data=await evaluate('movieFrame('+i+')');
      await new Promise((resolve,reject)=>video.stdin.write(Buffer.from(data,'base64'),err=>err?reject(err):resolve()));
      if((i+1)%40===0) console.log('Captured',i+1,'swim frames');
    }
    video.stdin.end();
    await complete;
  } finally {
    if(video.exitCode===null) video.kill();
  }
}
