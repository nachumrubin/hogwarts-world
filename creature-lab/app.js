import {catalog} from './species/catalog.js';
import {Lab} from './lab.js';
import {icons,svg} from './icons.js';
icons();
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const spec={
 squid:{name:'Giant Squid',latin:'Architeuthis dux',id:'001',lab:'Underwater Lake Lab',taxon:'Cephalopoda',size:'17.5 m',zone:'Freshwater',mood:'Curious',actions:{Swim:'Slow swim',Rest:'Resting',Feed:'Feeding extension',Turn:'Turning',Dive:'Diving',Investigate:'Investigate',Retreat:'Retreat'}},
 aragog:{name:'Aragog',latin:'Acromantula',id:'002',lab:'Ancient Forest Lab',taxon:'Arachnida',size:'6.3 m',zone:'Woodland',mood:'Territorial',actions:{Idle:'Idle breathing',Walk:'Deliberate walk',Turn:'Turn in place',Raise:'Raise front legs',Threat:'Threat display'}}
};
Object.assign(spec,catalog);
for(const [id,s] of Object.entries(catalog)){
 const card=document.querySelector('[data-creature="aragog"]').cloneNode(true);
 card.dataset.creature=id;card.querySelector('canvas').id='thumb-'+id;
 card.querySelector('strong').textContent=s.name;card.querySelector('small').textContent=s.zone;
 card.querySelector('.plate').textContent='SP–'+s.id;
 $('.spec-data').before(card);
}
$('.count').textContent=String(Object.keys(spec).length).padStart(2,'0');
const defaults=kind=>({action:Object.keys(spec[kind].actions)[0],speed:1,light:80,night:false,lod:'0',mode:kind==='hippogriff'?'silver':'habitat',wire:false,normals:false,running:true});
let prefs=Object.fromEntries(Object.keys(spec).map(key=>[key,defaults(key)])),lab,kind='squid',tab='workspace',captures=[],recording=null,toastTimer,surveying=false;
function toast(t){$('#toast').textContent=t;$('#toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').style.display='none',3300)}
function metric(m,ms){$('#fps').textContent=(1000/ms).toFixed(ms>150?1:0);$('#frame').textContent=ms.toFixed(1);$('#tri').textContent=m.triangles>=1000?(m.triangles/1000).toFixed(1)+'k':m.triangles;$('#calls').textContent=m.drawCalls;const t=Math.floor(lab.clock);$('#time').textContent=String(t/60|0).padStart(2,'0')+':'+String(t%60).padStart(2,'0');$('.timeline span').style.width=(lab.clock%60)/60*100+'%'}
function setRunning(v){lab.running=v;prefs[kind].running=v;$('#play').innerHTML=svg(v?'pause':'play');$('#play').setAttribute('aria-label',v?'Pause animation':'Resume animation');$('#play').title=v?'Pause (Space)':'Resume (Space)';$('#viewState').textContent=v?'LIVE':'PAUSED'}
function setAction(v){lab.setAction(v);prefs[kind].action=v;$('#action').value=v;$('#motionname').textContent=spec[kind].actions[v]}
function showControls(){const p=prefs[kind];
 for(const [value,label] of [['motion','Motion study · WebGPU'],['silver','Silver-grey · studio'],['woodland','Silver-grey · woodland']]){
   const option=$('#inspection option[value="'+value+'"]');
   if(kind==='hippogriff'&&!option)$('#inspection').add(new Option(label,value));
   if(kind!=='hippogriff')option?.remove();
 }
 $('#action').innerHTML=Object.entries(spec[kind].actions).map(([v,t])=>'<option value="'+v+'">'+t+'</option>').join('');setAction(p.action);
 for(const [id,out,format] of [['speed','speedV',v=>v.toFixed(1)+'×'],['light','lightV',v=>v+'%']]){const inp=$('#'+id);inp.value=p[id];$('#'+out).textContent=format(p[id]);inp.style.setProperty('--p',((inp.value-inp.min)/(inp.max-inp.min)*100)+'%')}
 all('[data-night]').forEach(b=>b.classList.toggle('chosen',!!Number(b.dataset.night)===p.night));$('#lod').value=p.lod;$('#wire').checked=p.wire;$('#normals').checked=p.normals;$('#view').dataset.inspection=p.mode;$('#inspection').value=p.mode;lab.setInspection(p.mode);lab.wire=p.wire;lab.normals=p.normals;lab.applyDebug();lab.speed=p.speed;lab.hab.setLighting(p.light/80,p.night);lab.setLOD(p.lod);setRunning(p.running)
}
function selectCreature(v){kind=v;lab.switchCreature(v);const s=spec[v];all('[data-creature]').forEach(b=>{b.classList.toggle('selected',b.dataset.creature===v);b.setAttribute('aria-pressed',b.dataset.creature===v)});$('#name').textContent=s.name;$('#latin').textContent=s.latin;$('#habitatLabel').textContent=s.lab;$('#specId').textContent='SPECIMEN '+s.id;$('#camera').selectedIndex=0;for(const id of ['taxon','size','zone','mood'])$('#'+id).textContent=s[id];$('#sizeLabel').textContent=v==='squid'?'Length':v==='aragog'?'Leg span':v==='merperson'?'Length':'Height';showControls()}
function modal(html){$('#dialogbody').innerHTML=html;$('#dialog').showModal()}
async function blobCanvas(){lab.render();await lab.motionFrame;return new Promise((resolve,reject)=>lab.captureCanvas.toBlob(b=>b?resolve(b):reject(Error('Capture failed.')),'image/png'))}
function addCapture(blob,label,filename){const url=URL.createObjectURL(blob),video=blob.type.startsWith('video');captures.unshift({url,label,video,name:filename||kind+'-'+Date.now()+(video?'.webm':'.png')});$('#capCount').textContent=captures.length;toast(label+' saved to Captures');if(tab==='captures')showTab(tab)}
async function fourViews(){
 const key=kind,mode=prefs[key].mode==='silhouette'?'silhouette':'neutral';
 const plates=lab.plates(key,mode);lab.render();
 for(const {canvas,angle} of plates){
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   addCapture(blob,spec[key].name+' · '+angle+' · '+mode,key+'-'+angle+'-'+mode+'.png');
 }
 toast('Four comparison views saved to Captures');
}
async function capture(){addCapture(await blobCanvas(),spec[kind].name+' · '+(lab.angle||'orbit'))}
function record(){if(recording){recording.stop();return}if(!window.MediaRecorder||!lab.captureCanvas.captureStream){toast('Clip recording is unavailable in this browser.');return}
 const stream=lab.captureCanvas.captureStream(30),rec=new MediaRecorder(stream),chunks=[];recording=rec;let label=spec[kind].name+' · '+spec[kind].actions[lab.action];rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};rec.onstop=()=>{stream.getTracks().forEach(t=>t.stop());recording=null;$('#record').innerHTML=svg('video')+'Record clip';addCapture(new Blob(chunks,{type:rec.mimeType}),label)};rec.start();$('#record').textContent='Stop recording';setTimeout(()=>{if(rec.state==='recording')rec.stop()},6000)
}
function showTab(v){tab=v;all('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===v));const o=$('#overlay');o.hidden=v==='workspace';if(o.hidden)return;
 if(v==='notes'){o.innerHTML='<div class="kicker">RESEARCH NOTEBOOK</div><h1>Field notes</h1><h2>Giant Squid</h2><p>Watch the outline where the mantle narrows into the paired fins. During feeding, follow the two clubs past the shorter arm crown. Double-click the water to give the squid a point to investigate.</p><h2>Aragog</h2><p>Use the side view during a deliberate walk to inspect each planted foot. Turn in place to see the stance anchors change across uneven ground.</p><h2>Barn owl</h2><p>Double-click a point in the roost to direct the owl’s gaze.</p><p><a href="review/owl-a6/index.html" target="_blank">Barn Owl A.6 anatomical measurements</a> · <a href="review/owl-a7/index.html" target="_blank">Barn Owl A7 motion review</a> · <a href="review/owl-a8/index.html" target="_blank">Barn Owl A8 materials review</a> · <a href="review/owl-a7/inspect.html" target="_blank">Animation inspector</a></p><h2>Technical documents</h2><p><a href="review/equine-correction/index.html" target="_blank">Equine anatomy and grazing review</a></p><p><a href="review/stage-1b/index.html" target="_blank">Stage 1B structural review and clips</a></p><p><a href="audit.md" target="_blank">Abyssal Garden source audit</a> &nbsp;·&nbsp; <a href="review/report.md" target="_blank">Phase B technical report</a> &nbsp;·&nbsp; <a href="review/index.html" target="_blank">Comparison gallery</a></p><h2>Inspection angles</h2><div class="tools">'+Object.keys(angles).map(k=>'<button class="outline" data-angle="'+k+'">'+angles[k]+'</button>').join('')+'</div>';if(location.protocol==='file:'){
   for(const link of o.querySelectorAll('a')){
     const path=link.getAttribute('href').replace('review/index.html','review/README.md');
     link.href=path.endsWith('/index.html')?'https://nachumrubin.github.io/hogwarts-world/'+path:'https://github.com/nachumrubin/hogwarts-world/blob/creature-lab/creature-lab/'+path;
   }
 }all('[data-angle]').forEach(b=>b.onclick=()=>{showTab('workspace');lab.setAngle(b.dataset.angle);$('#camera').selectedIndex=0});return}
 o.innerHTML='<div class="kicker">OBSERVATION ARCHIVE</div><h1>Captures</h1><p>Save the current view, record motion, or export a survey of all seven specimens with eight habitat angles, four neutral comparison views, and measured frame timings per species.</p><div class="tools"><button class="outline" id="saveView">Capture current view</button><button class="outline" id="survey">Export full survey</button><a href="review/baselines.json" id="resultLink">Recorded baselines</a></div><p id="surveyStatus" role="status"></p><div class="gallery">'+captures.map(c=>'<article>'+(c.video?'<video controls src="'+c.url+'"></video>':'<img src="'+c.url+'" alt="'+c.label+'">')+'<small>'+c.label+'</small><a href="'+c.url+'" download="'+c.name+'">Save</a></article>').join('')+'</div>';if(location.protocol==='file:')$('#resultLink').href='https://github.com/nachumrubin/hogwarts-world/blob/creature-lab/creature-lab/review/baselines.json';$('#saveView').onclick=capture;$('#survey').onclick=survey
}
const angles={front:'Front',rear:'Rear',left:'Left',right:'Right',above:'Above','three-quarter':'Three-quarter','close-up':'Close-up',habitat:'Natural habitat'};
const api={switchCreature:selectCreature,setAction,setAngle:v=>lab.setAngle(v),setDistance:v=>lab.setDistance(v),setLOD:v=>lab.setLOD(v),setCopies:v=>lab.setCopies(v),get canvas(){return lab.canvas},metrics:()=>({...lab.metric}),setRunning,plates:(key,mode)=>lab.plates(key,mode)};
function save(b,name){let a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000)}
async function survey(){
 if(surveying)return;surveying=true;const saved=structuredClone(prefs),initial=kind,angle=lab.angle;$('#survey')?.setAttribute('disabled','');
 try{prefs=Object.fromEntries(Object.keys(spec).map(key=>[key,defaults(key)]));const {runSurvey}=await import('./evidence.js');const result=await runSurvey(api,t=>{if($('#surveyStatus'))$('#surveyStatus').textContent=t});save(result.blob,result.filename);toast('Survey archive exported')}
 catch(e){console.error(e);toast(e.message)}finally{lab.setCopies(1);prefs=saved;selectCreature(initial);lab.setAngle(angle);surveying=false;if(tab==='captures')showTab(tab)}
}
async function start(){
 lab=new Lab($('#world'),metric);selectCreature(new URLSearchParams(location.search).get('specimen')==='owl'?'owl':'squid');$('#load').hidden=true;requestAnimationFrame(lab.loop);
 for(const key of Object.keys(spec))lab.thumbnail(key);lab.render();lab.onStimulus=()=>{if(kind==='squid'){setAction('Investigate');toast('Stimulus placed in the lake')}else if(kind==='owl'){setAction('Look');toast('Owl tracking target')}};
 all('[data-creature]').forEach(b=>b.onclick=()=>{if(!surveying&&b.dataset.creature!==kind){selectCreature(b.dataset.creature);showTab('workspace')}});
 all('[data-tab]').forEach(b=>b.onclick=()=>showTab(b.dataset.tab));$('#help').onclick=()=>modal('<h2>Camera & animation</h2><p>Drag to orbit and scroll to zoom. In free camera mode, click the scene and use W/A/S/D to move, Q/E to descend or rise, and Shift to move faster.</p><p>Space pauses animation. Use the step button for one 1/60-second interval. Double-click the lake to place a stimulus. Field notes includes eight inspection angles.</p>');$('#closedialog').onclick=()=>$('#dialog').close();
 $('#plates').onclick=fourViews;$('#inspection').onchange=e=>{prefs[kind].mode=e.target.value;$('#view').dataset.inspection=e.target.value;lab.setInspection(e.target.value)};
 $('#action').onchange=e=>setAction(e.target.value);$('#play').onclick=()=>setRunning(!lab.running);$('#step').onclick=()=>{setRunning(false);lab.advance(1/60);lab.render()};$('#speed').oninput=e=>{prefs[kind].speed=+e.target.value;showControls()};$('#light').oninput=e=>{prefs[kind].light=+e.target.value;showControls()};all('[data-night]').forEach(b=>b.onclick=()=>{prefs[kind].night=!!Number(b.dataset.night);showControls()});for(const id of ['wire','normals','lod'])$('#'+id).onchange=e=>{prefs[kind][id]=id==='lod'?e.target.value:e.target.checked;showControls()};
 $('#camera').onchange=e=>{lab.free=e.target.selectedIndex===1;if(!lab.free)lab.setAngle(lab.angle);else{lab.canvas.focus();toast('WASD to move · Q/E for height')}};$('#resetcam').onclick=()=>{lab.setAngle('three-quarter');$('#camera').selectedIndex=0};$('#reset').onclick=()=>{prefs[kind]=defaults(kind);showControls();toast('Specimen controls reset')};
 $('#fullscreen').onclick=async()=>{const el=$('.stage');try{if(document.fullscreenElement)await document.exitFullscreen();else await el.requestFullscreen()}catch{el.classList.toggle('expanded')}};
 $('#capture').onclick=$('#shot').onclick=capture;$('#record').onclick=record;window.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','BUTTON','SELECT'].includes(document.activeElement.tagName)&&tab==='workspace'&&!$('#dialog').open){e.preventDefault();setRunning(!lab.running)}});
}
start().catch(e=>{$('#load').textContent='Viewport unavailable · '+e.message;console.error(e)});
