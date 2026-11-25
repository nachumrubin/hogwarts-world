// Metres. Define the opened wing in its horizontal flight frame and the
// folded wing on the flank. The forearm doubles back between elbow and wrist.
import * as T from '../vendor/three.module.js';
import {joint} from './form.js';
const V=(...v)=>new T.Vector3(...v);
function basis(span,chord){
  const x=span.clone().normalize(),y=chord.clone().cross(x).normalize(),z=x.clone().cross(y);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z));
}
const frames=[
  [V(.088,0,-.054),V(.007,-.068,-.075)],
  [V(.132,0,.052),V(.002,.079,.115)],
  [V(.095,0,.004),V(.001,-.074,-.059)]
];
const openFrames=frames.map(([v])=>basis(v,V(0,0,1)));
const restFrames=frames.map(([,v])=>basis(v,v.clone().cross(V(1,0,0))));
function blades(lod,segment,count,row,under){
  const positions=[],uv=[],index=[],folded=[];
  const n=[12,8,5][lod],cross=[-1,-.5,0,.5,1];
  for(let i=0;i<count;i++){
    const t=(i+.35)/count,arm=frames[segment][0].length();
    const length=segment===2?.182+.064*Math.sin(Math.PI*t*.84)-.01*t:.152+.019*Math.sin(Math.PI*t);
    const angle=segment===2?-1.00+.87*t:-1.43+.30*t;
    const factor=[1,.69,.46][row];
    const shift=(under?-.003:.003)+row*(under?-.002:.003)+(.5-t)*.003;
    const start=V(t*arm,shift,(row*.005)-.004);
    const extended=V(Math.cos(angle),0,Math.sin(angle)).applyQuaternion(openFrames[segment].clone().invert());
    const tucked=V(-.04-.03*t,-.76+.10*t,-.77).normalize().applyQuaternion(restFrames[segment].clone().invert());
    const offset=positions.length/3;
    for(let j=0;j<=n;j++){
      const u=(1-Math.cos(Math.PI*j/n))/2;
      const width=(segment===2?.026:.022)*(row===2?1.16:1)*Math.pow(Math.sin(Math.PI*u),.57)+.00028;
      for(const k of cross){
        for(const [out,dir,tuck] of [[positions,extended,false],[folded,tucked,true]]){
          const side=V(-dir.z,0,dir.x).normalize();
          const p=start.clone().addScaledVector(dir,length*factor*u*(tuck?.82:1))
            .addScaledVector(side,width*k*(k>0?.8:1)*(tuck?.83:1));
          p.y+=.003*(1-k*k)*Math.sin(Math.PI*u)-.004*u*u;
          out.push(...p.toArray());
        }
        uv.push((k+1)/2,u);
      }
      if(j)for(let k=0;k<4;k++){
        const a=offset+(j-1)*5+k;index.push(a,a+5,a+1,a+1,a+5,a+6);
      }
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
  const f=g.clone();f.setAttribute('position',new T.Float32BufferAttribute(folded,3));f.computeVertexNormals();
  g.morphAttributes.position=[f.attributes.position];g.morphAttributes.normal=[f.attributes.normal];
  return g;
}
// A continuous scapular field roofs the folded remiges. Its narrow end
// follows the trailing tips while the shoulder stays full and rounded.
function mantle(lod){
  const g=new T.SphereGeometry(1,[40,26,16][lod],[28,18,12][lod]);
  const p=g.attributes.position,rest=[],turn=restFrames[0].clone().invert();
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i),t=(1-y)/2;
    const f=V(.002+x*.015+.012*Math.sin(t*Math.PI),.022-.143*t+z*.031,.002-.152*t-z*.031);
    f.applyQuaternion(turn);rest.push(...f.toArray());
    p.setXYZ(i,.049+y*.077,.004+x*.012,-.022+z*.047);
  }
  g.computeVertexNormals();const folded=g.clone();folded.setAttribute('position',new T.Float32BufferAttribute(rest,3));folded.computeVertexNormals();
  g.morphAttributes.position=[folded.attributes.position];g.morphAttributes.normal=[folded.attributes.normal];return g;
}
export function owlWing(owl,s,map){
  const mount=joint(owl.body,s*.046,.202,-.011);mount.scale.x=s;
  const joints=[],layers=[];
  for(let seg=0;seg<3;seg++){
    const bone=joint(seg?joints[seg-1]:mount,seg?frames[seg-1][0].length():0);
    joints.push(bone);
    const arm=frames[seg][0].length();
    if(seg===0){const coat=owl.mesh(bone,0xfffffb,mantle);coat.material.map=owl.maps[4];layers.push(coat)}
    const cushion=owl.oval(bone,0xfdfcfc,arm*.47,.008,-.012,arm*.59,.008-seg*.0015,.025-seg*.005);
    cushion.material.map=owl.maps[4];
    for(const [row,under,color] of [[0,false,0xf2e9de],[1,false,0xdcc9ac],[2,false,0xc8bcae],[1,true,0xf3ebd7]]){
      const mesh=owl.mesh(bone,color,l=>blades(l,seg,[7,13,10][seg],row,under));
      if(!under)mesh.material.map=map;
      if(row===2||under)owl.fineCoverts.push(mesh);
      layers.push(mesh);
    }
  }
  const q=new T.Quaternion(),previous=new T.Quaternion(),base=new T.Quaternion();
  const e=new T.Euler();
  return (open,stroke,recovery,pitch)=>{
    // A 93 cm spread on the adult British specimen.
    mount.scale.x=s*(1-.19*open);
    mount.rotation.x=-pitch*open;
    mount.rotation.z=s*.47*Math.sin(Math.PI*open);
    previous.identity();
    joints.forEach((bone,i)=>{
      base.copy(restFrames[i]).slerp(openFrames[i],open);
      q.setFromEuler(e.set(0,(i*.12)*recovery,stroke*(1+i*.18)-i*.11*recovery,'ZYX')).multiply(base);
      bone.quaternion.copy(previous).invert().multiply(q);previous.copy(q);
    });
    for(const mesh of layers)mesh.morphTargetInfluences[0]=1-open+open*.13*recovery;
  };
}
