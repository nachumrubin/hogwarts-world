// The same feather root belongs to the same wing bone in spread and repose.
// Rest coordinates run along the back (q) and down the flank (v).
import * as T from '../vendor/three.module.js';
import {joint} from './form.js';
const V=(...p)=>new T.Vector3(...p);
const clamp=T.MathUtils.clamp;
function basis(span,chord){
  const x=span.clone().normalize(),y=chord.clone().cross(x).normalize(),z=x.clone().cross(y);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(x,y,z));
}
const bones=[
  [V(.088,0,-.054),V(.007,-.068,-.075)],
  [V(.132,0,.052),V(.002,.079,.115)],
  [V(.095,0,.004),V(.001,-.074,-.059)]
];
const extended=bones.map(([v])=>basis(v,V(0,0,1)));
const folded=bones.map(([,v])=>basis(v,v.clone().cross(V(1,0,0))));
const shoulder=V(.046,.202,-.011);
const restOrigin=[shoulder];
for(let i=1;i<3;i++)restOrigin.push(restOrigin[i-1].clone().add(bones[i-1][1].clone().setLength(bones[i-1][0].length())));
function flank(q,v,height){
  const arch=Math.sin(Math.PI*clamp(q,0,1))**.65;
  const y=.224-.145*q+(.053-.096*v)*arch,z=.038-.238*q-.014*arch*(1-v);
  // Solve the breast cross-section at this station. Coverts drape over the
  // near flank and sink back through its margin at the dorsal leading edge.
  const dy=y-.151,dz=z+.036,det=.090*.058+.048*.093;
  const long=(.058*dy+.048*dz)/det,ventral=(-.093*dy+.090*dz)/det;
  const skin=(.051+.022*(1+long)/2)*Math.sqrt(Math.max(0,1-long*long-ventral*ventral));
  const seam=.006*Math.sin(Math.PI*clamp(v,0,1))-.002;
  const aft=.026+.019*arch+.026*Math.sin(Math.PI*(.08+.85*v))*arch-.012*q;
  return V(Math.max(aft,skin+seam)+height,y,z);
}
const restRanges=[
  [.006,.29,.29,.62],[.09,.36,.58,.83],[.26,.46,.74,1]
];
function wingSurface(lod,seg){
  const p=[],rest=[],bend=[],uv=[],rgb=[],idx=[];
  const length=bones[seg][0].length(),inv=folded[seg].clone().invert();
  const color=new T.Color(),convert=v=>v.sub(restOrigin[seg]).applyQuaternion(inv);
  const steps=[13,9,6][lod],web=lod===2?[-1,0,1]:[-1,-.49,0,.52,1];
  function vertex(point,tucked,warp,u,v,c){
    p.push(...point.toArray());rest.push(...tucked.toArray());bend.push(...point.clone().add(warp).toArray());
    uv.push(u,v);rgb.push(c.r,c.g,c.b);
  }
  function strip(base,rows,cols){
    for(let j=1;j<=rows;j++)for(let k=1;k<cols;k++){
      const a=base+j*cols+k;idx.push(a-cols-1,a-1,a,a-cols-1,a,a-cols);
    }
  }
  // Patagium: a curved leading edge with continuous dorsal and ventral
  // skin. It recedes under the scapular tract when the bones double back.
  const edgeBase=p.length/3,edgeRows=[14,10,6][lod],profile=[-.94,-.5,0,.47,.94];
  for(let j=0;j<=edgeRows;j++)for(const k of profile){
    const t=j/edgeRows,camber=1-k*k,station=(seg+t)/3;
    const v=V((t*1.08-.04)*length,.006*camber+.001,-.018+k*(.028-.013*station));
    const q=.035+.37*station;
    vertex(v,convert(flank(q,.16+.25*(1-k),-.004)),V(0,.0008*station,0),.50+k*.32,.53+.17*t,color.setHex(0xf4eee4));
  }
  strip(edgeBase,edgeRows,profile.length);
  const rows=lod===2?[0,1]:[0,1,2,3];
  for(const row of rows){
    const under=row===3,covert=row!==0;
    const count=[8,13,10][seg]-(row===2?2:0),[q0,q1,q2,q3]=restRanges[seg];
    for(let i=0;i<count;i++){
      const t=(i+.35)/count,jitter=Math.sin(i*7.43+seg*2.11);
      const primary=seg===2;
      const angle=primary?-1.20+1.13*t+.018*jitter:-1.49+.33*t+.035*Math.sin(t*3+seg);
      const dir=V(Math.cos(angle),0,Math.sin(angle)).applyQuaternion(extended[seg].clone().invert());
      const side=V(-dir.z,0,dir.x).normalize();
      const taper=primary?.185+.069*Math.sin(Math.PI*t*.90)-.024*t**5:.145+.037*Math.sin(Math.PI*(.10+.80*t));
      const factor=[1,.65,.40,.62][row]*(1+.035*jitter);
      const depth=under?-.004:.001+row*.0026;
      const root=V(length*(t+.015*jitter),depth+.002*(1-t),.007-.011*t);
      const base=p.length/3;
      color.setHex(under?0xfff9ee:row===0?0xfff9ef:0xfffdf9);
      color.multiplyScalar(.94+.06*Math.sin(i*2.2+seg));
      for(let j=0;j<=steps;j++){
        const u=(1-Math.cos(Math.PI*j/steps))/2;
        const width=(primary?.032-.004*t:.027)*(covert?1.05:1)
          *Math.sin(Math.PI*u)**(.43+.15*t)+.00028;
        const curve=.011*u*u*(primary?1+t:.60);
        const startQ=q0+(q1-q0)*t;
        const endQ=startQ+(q2+(q3-q2)*t-startQ)*factor;
        for(const k of web){
          const lateral=k*width*(k>0?.68+.15*(1-t):1);
          const pos=root.clone().addScaledVector(dir,u*taper*factor).addScaledVector(side,lateral+curve);
          pos.y+=.004*Math.sin(Math.PI*u)*(1-k*k)-.006*u*u-.004*k*u*t;
          const q=startQ+(endQ-startQ)*u;
          const v=.14+.64*t+.09*u+.025*jitter+.08*(seg-1);
          const tucked=convert(flank(q,v+k*width*3.6*Math.sin(Math.PI*u),
            depth*.62+.0011*(1-k*k)*Math.sin(Math.PI*u)));
          const flex=(.002+.002*seg+.007*t*seg)*u*u*factor;
          vertex(pos,tucked,V(-.23*flex,flex*(1+.30*k),-.55*flex),
            (.5+.33*k+.12*Math.sin(i*2.1+seg)),(row+.07+.85*u)/4,color);
        }
      }
      strip(base,steps,web.length);
    }
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new T.Float32BufferAttribute(rgb,3));g.setIndex(idx);g.computeVertexNormals();
  const normals=g.attributes.normal;
  g.morphTargetsRelative=true;g.morphAttributes.position=[];g.morphAttributes.normal=[];
  for(const pose of [rest,bend]){
    const end=new T.BufferGeometry();end.setAttribute('position',new T.Float32BufferAttribute(pose,3));end.setIndex(g.index);end.computeVertexNormals();
    g.morphAttributes.normal.push(new T.Float32BufferAttribute(end.attributes.normal.array.map((v,i)=>v-normals.array[i]),3));
    g.morphAttributes.position.push(new T.Float32BufferAttribute(pose.map((v,i)=>v-p[i]),3));end.dispose();
  }
  return g;
}
export function owlWing(owl,s,map){
  const mount=joint(owl.body,s*shoulder.x,shoulder.y,shoulder.z);
  const joints=[],layers=[];
  for(let i=0;i<3;i++){
    const bone=joint(i?joints[i-1]:mount,i?bones[i-1][0].length():0);
    const mesh=owl.mesh(bone,0xfffffa,l=>wingSurface(l,i));mesh.material.vertexColors=true;mesh.material.map=map;
    // Index winding points towards the ventral web. THREE accounts for
    // the mirrored mount when choosing the GL front face.
    mesh.material.onBeforeCompile=shader=>{
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',
        '#include <color_fragment>\nif(gl_FrontFacing) diffuseColor.rgb = mix(vec3(0.83,0.77,0.65), diffuseColor.rgb, 0.22);');
    };
    joints.push(bone);layers.push(mesh);
  }
  const q=new T.Quaternion(),previous=new T.Quaternion(),base=new T.Quaternion(),e=new T.Euler();
  return (open,stroke,recovery,pitch,lag)=>{
    mount.scale.x=s*(1-.206*open);mount.rotation.x=-pitch*open;mount.rotation.z=s*.47*Math.sin(Math.PI*open);
    previous.identity();
    joints.forEach((bone,i)=>{
      base.copy(folded[i]).slerp(extended[i],open);
      q.setFromEuler(e.set(i*.05*lag,i*.12*recovery,stroke*(1+i*.11)-i*.085*recovery-i*.10*lag,'ZYX')).multiply(base);
      bone.quaternion.copy(previous).invert().multiply(q);previous.copy(q);
      layers[i].morphTargetInfluences[0]=1-open;
      layers[i].morphTargetInfluences[1]=open*lag;
    });
  };
}
