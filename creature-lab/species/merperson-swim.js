import * as T from '../vendor/three.module.js';
import {tailCenterline} from './merperson-anatomy.js';

const {clamp,lerp,smoothstep}=T.MathUtils;
const TAU=2*Math.PI;
const damp=(value,target,rate,dt)=>lerp(value,target,1-Math.exp(-rate*dt));

const actions={
  Idle:      {speed:0,    stroke:.24, frequency:.72, pitch:.075, hover:1, turn:0, coast:0},
  Cruise:    {speed:.82,  stroke:.69, frequency:1.06,pitch:.69,  hover:0, turn:0, coast:0},
  Swim:      {speed:1.94, stroke:1,   frequency:1.46,pitch:.91,  hover:0, turn:0, coast:0},
  Turn:      {speed:.83,  stroke:.67, frequency:1.04,pitch:.59,  hover:0, turn:1, coast:0},
  TurnRight: {speed:.83,  stroke:.67, frequency:1.04,pitch:.59,  hover:0, turn:-1,coast:0},
  Glide:     {speed:0,    stroke:0,   frequency:.70,pitch:.79,  hover:0, turn:0, coast:1},
  Brake:     {speed:0,    stroke:.24, frequency:.81,pitch:.18,  hover:.42,turn:0, coast:0}
};

export class SwimMotion {
  constructor() {
    const {speed,stroke,frequency,pitch,hover,turn,coast}=actions.Idle;
    Object.assign(this,{speed,stroke,frequency,pitch,hover,turn,coast,
      brake:0,surge:0,heading:0,phase:.36,flow:0,brakeEntry:0,previous:'Idle'});
  }

  update(dt,action) {
    const target=actions[action]||actions.Idle;
    if(action==='Brake'&&this.previous!=='Brake') this.brakeEntry=this.speed;
    this.previous=action;
    const brakeTarget=action==='Brake'?clamp(this.brakeEntry*.72,0,1)*smoothstep(this.speed,.022,.34):0;
    this.brake=damp(this.brake,brakeTarget,brakeTarget>this.brake?9:3.2,dt);
    this.turn=damp(this.turn,target.turn,3.6,dt);
    this.coast=damp(this.coast,target.coast,3.7,dt);
    this.hover=damp(this.hover,target.hover,2.9,dt);
    this.stroke=damp(this.stroke,target.stroke,action==='Glide'?4.8:3.2,dt);
    this.frequency=damp(this.frequency,target.frequency,2.7,dt);
    this.phase=(this.phase+dt*TAU*this.frequency)%TAU;
    const oldSpeed=this.speed;
    const drag=action==='Brake'?3.85:action==='Glide'?.48:action==='Idle'?2.4:1.35;
    const pulse=.955+.045*Math.cos(2*this.phase-1.45);
    this.speed=damp(this.speed,target.speed*pulse,drag,dt);
    this.surge=damp(this.surge,dt>0?clamp((this.speed-oldSpeed)/dt,-3,2):0,5,dt);
    const floatUp=action==='Glide'?.28*(1-smoothstep(this.speed,.06,.55)):0;
    this.pitch=damp(this.pitch,target.pitch-floatUp,3.2,dt);
    this.flow=damp(this.flow,this.speed,3.3,dt);
    this.heading+=dt*this.turn*(.67+.30*this.speed);
  }
}

const rest=tailCenterline.map(([x,y,z])=>new T.Vector3(x,y,z));
const cumulative=[0];
for(let i=1;i<rest.length;i++) cumulative.push(cumulative[i-1]+rest[i].distanceTo(rest[i-1]));
const length=cumulative.at(-1);
const poseEuler=new T.Euler(0,0,0,'YXZ');

function coordinates(z) {
  if(z>=rest[0].z) return [0,0];
  let a=0,b=rest.length-1;
  while(b-a>1) {
    const m=(a+b)>>1;
    if(z>rest[m].z) b=m;
    else a=m;
  }
  return [a,clamp((rest[a].z-z)/(rest[a].z-rest[b].z),0,1)];
}

export class SwimTail {
  constructor() {
    this.centers=rest.map(p=>p.clone());
    this.frames=rest.map(()=>new T.Quaternion());
    this.segment=new T.Vector3();
    this.blend=new T.Quaternion();
    this.frame=new T.Quaternion();
    this.center=new T.Vector3();
    this.station=new T.Vector3();
    this.point=new T.Vector3();
    this.meshes=new WeakMap();
  }

  update(motion,pitch) {
    const {phase,stroke,hover,turn,coast,brake}=motion;
    for(let i=0;i<rest.length;i++) {
      const u=cumulative[i]/length;
      const height=u*smoothstep(u,0,.30);
      const crest=phase-5.7*u;
      const bend=stroke*height*(.97*Math.sin(crest)+.13*Math.sin(2*crest-.64))
        + .064*hover*smoothstep(u,.22,1)*Math.sin(phase-3.7*u);
      const trim=-(1.02*pitch+.12*coast)*smoothstep(u,0,.77);
      const yaw=turn*(.48*smoothstep(u,.06,1))+.08*hover*u*Math.sin(phase-3*u);
      const roll=.095*turn*u+.05*stroke*height*Math.sin(crest-.8);
      this.frames[i].setFromEuler(poseEuler.set(bend+trim-.18*brake*u,yaw,roll));
      if(i>0) {
        this.blend.slerpQuaternions(this.frames[i-1],this.frames[i],.5);
        this.segment.subVectors(rest[i],rest[i-1]).applyQuaternion(this.blend);
        this.centers[i].copy(this.centers[i-1]).add(this.segment);
      }
    }
  }

  sample(i,f) {
    this.frame.slerpQuaternions(this.frames[i],this.frames[i+1],f);
    this.center.lerpVectors(this.centers[i],this.centers[i+1],f);
    this.station.lerpVectors(rest[i],rest[i+1],f);
  }

  attach(object,restPosition,coordinate) {
    this.sample(...coordinate);
    object.quaternion.copy(this.frame);
    object.position.copy(restPosition).sub(this.station).applyQuaternion(this.frame).add(this.center);
  }

  deform(mesh,motion,flex=0) {
    const g=mesh.geometry;
    const position=g.attributes.position,normal=g.attributes.normal;
    let cache=this.meshes.get(g);
    if(!cache) {
      const original=position.array.slice(), normals=normal.array.slice();
      const stationSources=g.userData.tailStations;
      const stations=new Map();
      for(let i=0;i<position.count;i++) {
        const z=stationSources?stationSources[i]:original[i*3+2];
        if(z>rest[0].z+.0001) continue;
        if(!stations.has(z)) stations.set(z,{coordinate:coordinates(z),indices:[]});
        stations.get(z).indices.push(i);
      }
      cache={original,normals,stations:Array.from(stations.values())};
      this.meshes.set(g,cache);
      position.setUsage(T.DynamicDrawUsage);
      normal.setUsage(T.DynamicDrawUsage);
    }
    const {original,normals,stations}=cache;
    for(const {coordinate,indices} of stations) {
      this.sample(coordinate[0],coordinate[1]);
      for(const i of indices) {
        const p=this.point.fromArray(original,i*3);
        if(flex) {
          const edge=Math.abs(p.x)*2+Math.max(0,p.y+.38)*2;
          p.y+=flex*edge*edge*(.038*Math.sin(motion.phase-3+p.x*4)+.029*motion.turn);
        }
        p.sub(this.station).applyQuaternion(this.frame).add(this.center).toArray(position.array,i*3);
        this.point.fromArray(normals,i*3).applyQuaternion(this.frame).toArray(normal.array,i*3);
      }
    }
    position.needsUpdate=true;
    normal.needsUpdate=true;
  }

  coordinate(z) {return coordinates(z)}
}

export function bendFluke(mesh,motion) {
  const g=mesh.geometry,p=g.attributes.position;
  if(!g.userData.flukeRest) {
    g.userData.flukeRest=p.array.slice();
    p.setUsage(T.DynamicDrawUsage);
    g.attributes.normal.setUsage(T.DynamicDrawUsage);
  }
  const rest=g.userData.flukeRest;
  const pitch=(.13+.25*motion.stroke)*Math.sin(motion.phase-6.44)-.13*motion.brake+.05*motion.coast;
  for(let i=0;i<p.count;i++) {
    const k=i*3,x=rest[k],y=rest[k+1],z=rest[k+2];
    const aft=smoothstep(-z,-.035,.43), span=smoothstep(Math.abs(x),.045,.41);
    const angle=aft*(pitch+.13*span*Math.sin(motion.phase-7.1)+.25*motion.turn*x);
    const c=Math.cos(angle),s=Math.sin(angle);
    p.setXYZ(i,x,y*c-z*s,y*s+z*c);
  }
  p.needsUpdate=true;
  g.computeVertexNormals();
}
