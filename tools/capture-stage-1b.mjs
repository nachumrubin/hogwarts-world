// node tools/capture-stage-1b.mjs <creature-lab directory> before|after [species]
// Use merperson-runtime instead of merperson to capture and measure the Lab itself.
// The published runtime is captured with: node tools/capture-stage-1b.mjs creature-lab published merperson-runtime
// Requires Chromium (CHROME_PATH may override) and ffmpeg for the after clips.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureMerpersonRuntime} from './merperson-runtime-evidence.mjs';

const [source,revision,selected]=process.argv.slice(2);
const runtime=selected==='merperson-runtime';
if(!source||!(['before','after'].includes(revision)||(runtime&&revision==='published'))) {
  throw Error('Supply a lab directory and before or after, or published for merperson-runtime.');
}
const gallery=runtime||selected==='merperson'?'merperson-redesign':'stage-1b';
const root=resolve(source),out=fileURLToPath(new URL('../creature-lab/review/'+gallery+'/',import.meta.url));
const profile=await mkdtemp(join(tmpdir(),'creature-capture-'));
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'&&!runtime){res.setHeader('content-type','text/html');res.end('<!doctype html><title>Clay capture</title>');return}
  const file=resolve(root,pathname==='/'?'index.html':'.'+pathname);
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':null;
  if(!file.startsWith(root+sep)||!type){res.writeHead(404).end();return}
  try{const bytes=await readFile(file);res.setHeader('content-type',type);res.end(bytes)}
  catch{res.writeHead(404).end()}
});
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const endpoint='http://127.0.0.1:'+server.address().port;
const gpuFlags=process.env.CREATURE_CAPTURE_HARDWARE==='1'?[]:['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
const proxy=process.env.CREATURE_CAPTURE_PROXY;
const browser=spawn(process.env.CHROME_PATH||'chromium',[
  '--headless','--no-sandbox','--disable-dev-shm-usage',...gpuFlags,
  ...(proxy?['--proxy-server='+proxy]:[]),'--window-size=1260,820',
  '--remote-debugging-port=0','--user-data-dir='+profile,endpoint
],{stdio:'ignore'});
async function retry(fn){
  for(let i=0;i<150;i++){try{return await fn()}catch(e){if(i===149)throw e;await new Promise(r=>setTimeout(r,100))}}
}
async function captureSession(kind){
  const T=await import('/vendor/three.module.js');
  const {catalog}=await import('/species/catalog.js');
  const {studioLights,inspectionMaterials,background}=await import('/inspection.js');
  const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  renderer.setPixelRatio(1);renderer.setSize(640,480,false);
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.06;
  const scene=new T.Scene(),materials=inspectionMaterials();scene.background=background;scene.add(studioLights());
  let actor;
  function reset(){actor?.dispose();actor=new catalog[kind].model();scene.add(actor.root)}
  const isHip=kind==='hippogriff',isUni=kind==='unicorn',isMer=kind==='merperson';
  const move=isHip?'Unfold':isUni?'Graze':isMer?'Swim':'Walk';
  function step(frame,action){actor.update(1/24,(frame+1)/24,action)}
  function render(view,mode,motion=false){
    let half=isHip?1.62:1.70, y=isHip?1.10:1.47,z=.08;
    let dir=view==='front'?[0,.055,1]:view==='side'?[1,.04,0]:[.84,.25,.64];
    let x=0;
    if(isMer){
      [half,y,z]=[1.31,1.36,-.85];
      dir=view==='front'?[0,0,1]:view==='side'?[1,0,0]:[.79,.20,1];
      if(view==='front') z=0;
      if(view==='face') { [half,y,z]=[.32,2.02,.42]; dir=[.39,.06,1]; }
      if(view==='shoulder-hand') { [half,x,y,z]=[.56,.40,1.42,.21]; dir=[.45,.09,1]; }
      if(view==='tail-junction') { [half,y,z]=[.52,1.01,-.43]; dir=[.94,.11,.35]; }
    }
    if(view==='detail'){
      [half,y,z]=isHip?[.99,1.48,-.14]:isUni?[.99,1.96,.62]:[.76,2.21,.68];
      dir=isHip?[1,.16,-.32]:isUni?[1,.13,.35]:[.58,.12,1];
    }
    if(motion && isHip){half=1.95;y=1.34;dir=[.50,.38,.96]}
    if(motion && isUni){half=1.62;y=1.38;z=.24;dir=[1,.075,.14]}
    if(motion && kind==='centaur'){dir=[1,.085,.38]}
    const target=new T.Vector3(x,y,z).add(actor.root.position);
    const cam=new T.OrthographicCamera(-half*4/3,half*4/3,half,-half,.01,40);
    cam.position.copy(target).addScaledVector(new T.Vector3(...dir).normalize(),10);
    cam.lookAt(target);scene.overrideMaterial=materials[mode==='clay'?'neutral':'silhouette'];
    renderer.render(scene,cam);
    return renderer.domElement.toDataURL('image/png').split(',')[1];
  }
  window.still=(view,mode)=>{
    reset();const motion=view==='motion';
    const count=motion?(isHip?72:isUni?92:7):24;
    for(let i=0;i<count;i++)step(i,motion?move:'Idle');
    return render(view,mode,motion);
  };
  window.movie=(frame)=>{
    if(frame===0)reset();
    // Rest, open, hold, return to folded. The graze begins and ends upright.
    const action=isHip?(frame>=18&&frame<96?'Unfold':'Idle'):
      isUni?(frame>=18&&frame<116?'Graze':'Idle'):'Walk';
    step(frame,action);return render('motion','clay',true);
  };
  window.release=()=>{actor?.dispose();Object.values(materials).forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss()};
}
try{
  const port=await retry(async()=>(await readFile(join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);
  const target=await retry(async()=>{const tabs=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const target=tabs.find(t=>t.url.startsWith(endpoint));if(!target)throw Error('Waiting for capture tab');return target});
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
  const pending=new Map(),browserErrors=[];let id=0;
  ws.onmessage=event=>{const msg=JSON.parse(event.data);
    if(msg.method==='Runtime.consoleAPICalled'&&msg.params.type==='error'){
      browserErrors.push(msg.params.args.map(a=>a.value??a.description).join(' '));
    }
    if(!msg.id)return;const {resolve,reject}=pending.get(msg.id);pending.delete(msg.id);
    const detail=msg.result?.exceptionDetails;
    if(msg.error||detail)reject(Error(JSON.stringify(msg.error||detail)));else resolve(msg.result)};
  function send(method,params){return new Promise((resolve,reject)=>{
    pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  })}
  async function evaluate(expression){
    return (await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
  }
  if(runtime){
    await send('Runtime.enable',{});
    await captureMerpersonRuntime({send,evaluate,retry,out,revision,webUrl:'https://nachumrubin.github.io/hogwarts-world/'});
    const shaderError=browserErrors.find(error=>/THREE.WebGLProgram|Shader Error/i.test(error));
    if(shaderError) throw Error(shaderError);
    console.log('Merperson runtime',revision,'complete');
  }
  const names=runtime?[]:selected?[selected]:['centaur','unicorn','hippogriff'];
  for(const kind of names){
    await evaluate('('+captureSession.toString()+')('+JSON.stringify(kind)+')');
    const plates=kind==='merperson'
      ? ['front-clay','side-clay','three-quarter-clay','front-silhouette','side-silhouette','face-clay','shoulder-hand-clay','tail-junction-clay']
      : ['front-clay','side-clay','three-quarter-clay','detail-clay','front-silhouette','side-silhouette','motion-clay','motion-silhouette'];
    for(const plate of plates){
      const cut=plate.lastIndexOf('-'),view=plate.slice(0,cut),mode=plate.slice(cut+1);
      const data=await evaluate('still('+JSON.stringify(view)+','+JSON.stringify(mode)+')');
      await writeFile(join(out,kind+'-'+revision+'-'+plate+'.png'),Buffer.from(data,'base64'));
    }
    if(revision==='after' && kind!=='merperson'){
      const name={centaur:'centaur-walk',unicorn:'unicorn-graze',hippogriff:'hippogriff-fold-unfold'}[kind];
      const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','24','-c:v','png','-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',join(out,name+'.mp4')],{stdio:['pipe','ignore','inherit']});
      const done=new Promise((r,j)=>ff.on('exit',code=>code===0?r():j(Error('ffmpeg '+code))));
      const frames=kind==='centaur'?96:kind==='hippogriff'?168:180;
      for(let i=0;i<frames;i++){
        const data=await evaluate('movie('+i+')');
        await new Promise((r,j)=>ff.stdin.write(Buffer.from(data,'base64'),e=>e?j(e):r()));
      }
      ff.stdin.end();await done;
    }
    await evaluate('release()');console.log(kind,revision,'complete');
  }
  ws.close();
}finally{
  browser.kill();server.close();
  await new Promise(r=>setTimeout(r,150));await rm(profile,{force:true,recursive:true,maxRetries:5,retryDelay:100});
}
