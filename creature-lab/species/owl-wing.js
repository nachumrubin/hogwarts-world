// The same feather root belongs to the same wing bone in spread and repose.
// Rest coordinates run along the back (q) and down the flank (v).
import * as T from '../vendor/three.module.js';
import {joint} from './form.js';
import {owlFinish} from './owl-finish.js';
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
  // Trace a meridian on the accepted body volume. Turning around the
  // elliptical cross-section wraps the scapulars from the back onto
  // the flank. Only the long outer webs continue beyond the rump.
  const long=.78-1.66*q,theta=.13+2.23*v,r=Math.sqrt(Math.max(0,1-long*long));
  const x=r*Math.sin(theta),z=-r*Math.cos(theta),t=(long+1)/2;
  const skirt=Math.max(0,z)**2*clamp((.68-long)/.8,0,1);
  const body=V(x*(.051+.022*t+.004*skirt),long*.090-.048*z+.151-.023*skirt,
    -.036+long*.093+z*.058-.002*t*t+.013*skirt);
  const distal=T.MathUtils.smoothstep(q,.52,1);
  const rear=V(.020+.012*(1-q)+.009*Math.sin(Math.PI*v),
    .22-.14*q+(.030-.060*v)*(.94-.53*q),.032-.238*q+.013*(v-.5));
  body.lerp(rear,distal);
  // After the webs sweep aft, project the inner flange back onto the
  // rump. Otherwise interpolating across this convex volume buries a
  // wedge of secondaries under the torso during the final fold.
  if(distal>0&&distal<1){
    const det=.090*.058+.048*.093;
    let a=long,b=z,belly=skirt;
    for(let i=0;i<3;i++){
      const dy=body.y-.151+.023*belly,dz=body.z+.036+.002*((1+a)/2)**2-.013*belly;
      a=(.058*dy+.048*dz)/det;b=(-.093*dy+.090*dz)/det;
      belly=Math.max(0,b)**2*clamp((.68-a)/.8,0,1);
    }
    const radius=(.051+.022*(a+1)/2+.004*belly)*Math.sqrt(Math.max(0,1-a*a-b*b));
    body.x=Math.max(body.x,radius);
  }
  const elevation=height+.0007;
  body.x+=elevation*Math.sin(theta);
  body.y+=elevation*.72*Math.cos(theta);
  body.z-=elevation*.69*Math.cos(theta);
  return body;
}
const restRanges=[
  [.005,.14,.43,.66],[.055,.25,.67,.86],[.27,.44,.79,1]
];
function wingSurface(lod,seg){
  const p=[],rest=[],bend=[],fan=[],ventral=[],uv=[],rgb=[],idx=[];
  const length=bones[seg][0].length(),inv=folded[seg].clone().invert();
  const color=new T.Color(),convert=v=>v.sub(restOrigin[seg]).applyQuaternion(inv);
  const web=lod===2?[-1,0,1]:[-1,-.49,0,.52,1];
  function vertex(point,tucked,warp,u,v,c,spread=0,mark=0){
    p.push(...point.toArray());rest.push(...tucked.toArray());bend.push(...point.clone().add(warp).toArray());
    fan.push(point.x+spread,point.y+spread*.17,point.z+spread*.51);
    ventral.push(mark);uv.push(u,v);rgb.push(c.r,c.g,c.b);
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
    vertex(v,convert(flank(q,.16+.25*(1-k),-.004)),V(0,.0008*station,0),.125+k*.10,.55+.12*t,color.setHex(0xf4eee4));
  }
  strip(edgeBase,edgeRows,profile.length);
  const tracts=[];
  const rows=lod===2?[0,1]:[0,1,2,3];
  for(const row of rows){
    // Humeral scapulars, ulnar secondaries and manual primaries form
    // the long tier. Greater, median and lesser coverts roof their bases.
    const first=p.length/3;
    const covert=row!==0,steps=[[13,10,9,8],[9,7,6,5],[6,4]][lod][row];
    const count=[8,13,10][seg]-(row===2?2:row===3?3:0),[q0,q1,q2,q3]=restRanges[seg];
    for(let i=0;i<count;i++){
      const t=(i+.35)/count,jitter=Math.sin(i*7.43+seg*2.11+row*2.39);
      const primary=seg===2;
      const angle=primary?-1.19+1.10*t+.024*jitter:-1.49+.33*t+.035*Math.sin(t*3+seg);
      const dir=V(Math.cos(angle),0,Math.sin(angle)).applyQuaternion(extended[seg].clone().invert());
      const side=V(-dir.z,0,dir.x).normalize();
      const taper=primary?.175+.082*Math.sin(Math.PI*t*.93)-.031*t**4:.143+.040*Math.sin(Math.PI*(.14+.69*t));
      const factor=[1,.73,.49,.32][row]*(1+(covert?.065:.021)*jitter);
      const scapular=seg===0&&row===0;
      const depth=scapular?.010:.001+row*.0026;
      const root=V(length*(t+.015*jitter),depth+.002*(1-t),.007-.011*t+.003*row);
      const base=p.length/3;
      color.setHex(0xfffcf5);
      const streak=Math.sin(i*2.2+seg*.7+row*2.4);
      color.setRGB(.94+.056*streak,.92+.061*streak,.89+.079*streak);
      const mark=.22+.60*(.5+.5*Math.sin(i*2.71+seg*1.96+row*4.37));
      const tilt=primary&&!covert?(t-.44)*.031:0;
      const tileColumn=(i*3+Math.floor(i/3)+seg+row)%4,tileRow=seg===0?2:Math.min(2,row);
      for(let j=0;j<=steps;j++){
        const u=(1-Math.cos(Math.PI*j/steps))/2;
        const width=(.88+.25*u)*(primary?.032-.004*t:.027)*(covert?1.08:1)*(.98+.095*jitter)*(primary?1-.17*t*u:1)
          *Math.sin(Math.PI*u)**(.43+.15*t)+.00028;
        const curve=(.013+.004*jitter)*u*u*(primary?1+t:.76)+.0025*Math.sin(Math.PI*u)*(1-t);
        const startQ=scapular?.006+.18*t:q0+(q1-q0)*t-.008*row;
        const endQ=scapular?.75-.18*t+.033*jitter:startQ+(q2+(q3-q2)*t-startQ)*factor;
        for(const k of web){
          const lateral=k*width*(k>0?.68+.15*(1-t):1);
          const pos=root.clone().addScaledVector(dir,u*taper*factor).addScaledVector(side,lateral+curve);
          pos.y+=(.0038+.0009*jitter)*Math.sin(Math.PI*u)*(1-k*k)-.006*u*u-.004*k*u*t+(.0022*jitter)*u**3;
          const q=startQ+(endQ-startQ)*u;
          const tract=scapular?-.045+.45*t:seg===0?.08+.52*t:seg===1?.23+.65*t:.31+.60*t;
          const v=tract+(scapular?.32:.075)*u+.021*jitter-.016*row+.034*Math.sin(Math.PI*u)*(1-t);
          // The rachis rises out of a buried root. The exposed vane arches
          // over its neighbour and rolls down at the margin, even in repose.
          const exposed=Math.sin(Math.PI*u*.82);
          const arch=(1-k*k)*exposed;
          const shingle=(.0019*k+.0034*(1-k*k))*exposed;
          const tier=scapular?.0083:.0008+row*.0022;
          const tucked=convert(flank(q+.009*k*exposed+.012*jitter*u*u,
            v+k*width*(covert?3.7:3.4)+.044*u*u,
            tier-.0032*(1-u)**2+.0017*u+shingle+.00065*jitter*u));
          pos.y+=.0026*arch-.0031*k*exposed-.0038*u**3*(primary?t:0);
          const flex=(.003+.003*seg+.012*t*seg)*u*u*factor;
          vertex(pos,tucked,V(-.23*flex,flex*(1+.30*k),-.55*flex),
            (tileColumn+.5+.47*k)/4,(tileRow+.025+.95*u)/4,color,tilt*u**2,mark);
        }
      }
      strip(base,steps,web.length);
    }
    tracts.push({first,end:p.length/3,name:row===0?['scapulars','secondaries','primaries'][seg]:['','greater','median','lesser'][row]});
  }
  const g=new T.BufferGeometry();g.userData.tracts=tracts;
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new T.Float32BufferAttribute(rgb,3));
  g.setAttribute('ventralMark',new T.Float32BufferAttribute(ventral,1));g.setIndex(idx);g.computeVertexNormals();
  const normals=g.attributes.normal;
  g.morphTargetsRelative=true;g.morphAttributes.position=[];g.morphAttributes.normal=[];
  for(const pose of seg===2?[rest,bend,fan]:[rest,bend]){
    const end=new T.BufferGeometry();end.setAttribute('position',new T.Float32BufferAttribute(pose,3));end.setIndex(g.index);end.computeVertexNormals();
    g.morphAttributes.normal.push(new T.Float32BufferAttribute(end.attributes.normal.array.map((v,i)=>v-normals.array[i]),3));
    g.morphAttributes.position.push(new T.Float32BufferAttribute(pose.map((v,i)=>v-p[i]),3));end.dispose();
  }
  return g;
}
export function owlWing(owl,s,map){
  const mount=joint(owl.trunk,s*shoulder.x,shoulder.y,shoulder.z);
  const joints=[],layers=[];
  for(let i=0;i<3;i++){
    const bone=joint(i?joints[i-1]:mount,i?bones[i-1][0].length():0);
    const mesh=owl.mesh(bone,0xfffffa,l=>wingSurface(l,i));mesh.material.vertexColors=true;mesh.material.map=map;mesh.material.roughness=.91;
    // Index winding points to the ventral web; Three accounts for the
    // mirrored mount when selecting GL front-facing fragments.
    owlFinish(mesh.material,'wing',.000215);
    joints.push(bone);layers.push(mesh);
  }
  const q=new T.Quaternion(),previous=new T.Quaternion(),base=new T.Quaternion(),e=new T.Euler();
  const pose=(open,stroke,recovery,pitch,lag,fan)=>{
    mount.scale.x=s*(1-.206*open);mount.rotation.x=-pitch*open;mount.rotation.z=s*.47*Math.sin(Math.PI*open);
    previous.identity();
    joints.forEach((bone,i)=>{
      const spread=clamp(open-.11*i*Math.sin(Math.PI*open),0,1);
      base.copy(folded[i]).slerp(extended[i],spread);
      q.setFromEuler(e.set(i*.18*lag,i*.22*recovery*open,
        stroke*(1+i*.09)-i*.11*recovery*open-i*.21*lag,'ZYX')).multiply(base);
      bone.quaternion.copy(previous).invert().multiply(q);previous.copy(q);
      layers[i].morphTargetInfluences[0]=1-spread;
      layers[i].morphTargetInfluences[1]=open*lag;
      if(i===2)layers[i].morphTargetInfluences[2]=open*fan;
    });
  };
  pose.joints=joints;
  return pose;
}
