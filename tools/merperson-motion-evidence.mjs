import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {openMerperson} from './merperson-runtime-evidence.mjs';

const side={name:'side',view:'side',length:3.5,warmup:2,timeline:[[0,'Swim']]};
const clips=[
  side,
  {name:'three-quarter',view:'three-quarter',length:8.2,warmup:0,
    timeline:[[0,'Idle'],[.65,'Cruise'],[2.45,'Swim'],[4.60,'Cruise'],[6.1,'Glide']]},
  {name:'maneuvers',view:'maneuvers',length:7.7,warmup:1.8,
    timeline:[[0,'Cruise'],[.55,'Turn'],[2.08,'TurnRight'],[3.7,'Swim'],[4.8,'Brake'],[6.25,'Idle']]},
  {name:'hands',view:'hands',length:6.2,warmup:0,
    timeline:[[0,'Idle'],[1.55,'Cruise'],[2.6,'Swim'],[3.75,'Brake'],[4.95,'Idle']]}
];

function frameAt(clip,frame) {
  const lab=window.reviewLab;
  if(frame===0) {
    lab.setInspection('material');
    lab.switchCreature('merperson');
    lab.renderer.setPixelRatio(1);
    lab.renderer.setSize(512,384,false);
    lab.camera.aspect=4/3;
    lab.camera.updateProjectionMatrix();
    lab.setAction(clip.timeline[0][1]);
    for(let i=0;i<Math.round(clip.warmup*60);i++) lab.advance(1/60);
  }
  const current=clip.timeline.findLast(([start])=>start<=frame/20)[1];
  lab.setAction(current);
  for(let i=0;i<3;i++) lab.advance(1/60);
  const {actor}=lab;
  const {x,z}=actor.root.position;
  lab.target.set(x,1.18,z-.60);
  if(clip.view==='side') lab.spherical.set(3.86,1.47,Math.PI/2);
  else if(clip.view==='hands') {
    const hand=actor.arms[1], thumb=hand.digits[0][0], index=hand.digits[1][1];
    hand.wrist.getWorldPosition(lab.target);
    const center=new lab.target.constructor();
    thumb.getWorldPosition(center);
    lab.target.lerp(center,.23);
    index.getWorldPosition(center);
    lab.target.lerp(center,.48);
    const wristFrame=hand.wrist.getWorldQuaternion(hand.wrist.quaternion.clone());
    const forward=center.set(.26,.89,.43).normalize().applyQuaternion(wristFrame);
    lab.camera.position.copy(lab.target).addScaledVector(forward,.60);
    lab.camera.up.set(.26,.04,-1).applyQuaternion(wristFrame).normalize();
    lab.camera.lookAt(lab.target);
  } else if(clip.view==='maneuvers') {
    lab.spherical.set(4.20,1.36,.93+.57*actor.motion.heading);
  } else lab.spherical.set(3.88,1.30,.88);
  if(clip.view!=='hands') {
    lab.camera.up.set(0,1,0);
    lab.orbit();
  }
  lab.render();
  return lab.canvas.toDataURL('image/png').split(',')[1];
}

async function saveClip(out,clip,name,evaluate) {
  await evaluate('window.motionFrame='+frameAt.toString());
  const call=frame=>'motionFrame('+JSON.stringify(clip)+','+frame+')';
  const video=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','20',
    '-c:v','png','-i','pipe:0','-an','-c:v','libx264','-threads','2','-preset','fast','-crf','18',
    '-pix_fmt','yuv420p','-movflags','+faststart',join(out,name+'.mp4')],{stdio:['pipe','ignore','inherit']});
  const complete=new Promise((resolve,reject)=>{
    video.on('error',reject);
    video.on('exit',code=>code===0?resolve():reject(Error('ffmpeg exited with status '+code)));
  });
  try {
    for(let frame=0;frame<Math.ceil(clip.length*20);frame++){
      const data=await evaluate(call(frame));
      await new Promise((resolve,reject)=>video.stdin.write(Buffer.from(data,'base64'),err=>err?reject(err):resolve()));
    }
    video.stdin.end();
    await complete;
  } finally {
    if(video.exitCode===null) video.kill();
  }
}

export async function captureMerpersonMotion({evaluate,retry,out,revision}) {
  await retry(async()=>{
    if(!await evaluate('('+openMerperson.toString()+')()')) throw Error('Waiting for application controls');
  });
  const selected=process.env.CREATURE_CAPTURE_MOTION_CLIP;
  for(const clip of revision==='before'?[side]:clips) {
    if(selected&&selected!==clip.name) continue;
    const name=revision==='before'?'side-before':clip.name;
    await saveClip(out,clip,name,evaluate);
    console.log('Merperson motion',name,'complete');
  }
}
