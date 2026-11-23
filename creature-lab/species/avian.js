import * as T from '../vendor/three.module.js';
import {joint} from './form.js';

// Cambered vanes have a raised rachis and a narrower leading web.
export function feather(a,parent,color,start,end,width,normal=[0,1,0]){
  return a.mesh(parent,color,l=>featherGeometry(start,end,width,normal,l));
}

function featherGeometry(start,end,width,normal,l){
  const from=new T.Vector3(...start),span=new T.Vector3(...end).sub(from);
  const side=span.clone().cross(new T.Vector3(...normal)).normalize();
  const up=side.clone().cross(span).normalize();
  const verts=[],idx=[],n=[10,7,4][l];
  for(let i=0;i<=n;i++){
    const t=i/n,w=width*(.015+Math.pow(Math.sin(Math.PI*t),.66))*(.8+.32*t);
    const center=from.clone().addScaledVector(span,t).addScaledVector(up,width*.16*Math.sin(Math.PI*t));
    for(const k of [-1,0,.72])verts.push(...center.clone().addScaledVector(side,w*k).addScaledVector(up,k===0?.21*w:0).toArray());
    if(i){const j=i*3;idx.push(j-3,j,j-2,j-2,j,j+1,j-2,j+1,j-1,j-1,j+1,j+2)}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();return g;
}

// Vanes on the same bone move together. One indexed buffer per layer
// preserves the overlapping profiles without issuing a draw per feather.
export function plumage(a,parent,color,vanes){
  return a.mesh(parent,color,l=>{
    const positions=[],normals=[],indices=[];
    for(const [start,end,width,normal=[0,1,0]] of vanes){
      const g=featherGeometry(start,end,width,normal,l);
      const offset=positions.length/3;
      positions.push(...g.attributes.position.array);normals.push(...g.attributes.normal.array);
      for(const index of g.index.array)indices.push(index+offset);
      g.dispose();
    }
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
    g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setIndex(indices);
    return g;
  });
}

// The leading edge keeps three rigid links. At the wrist and elbow the
// feather roots stay on the bone while the trailing webs close into a fan.
export function raptorWing(a,parent,s,pivot){
  const shoulder=joint(parent,...pivot);
  shoulder.scale.set(1.65*s,1.65,1.65);
  const elbow=joint(shoulder,.255,0,-.105),wrist=joint(elbow,.30,0,.12);
  a.loft(shoulder,0x8c8d83,[[-.08,-.012,.012,.10,.052],[.07,.008,-.026,.144,.065],
    [.19,.005,-.071,.128,.050],[.29,-.008,-.108,.073,.030]]);
  a.loft(elbow,0x85867c,[[-.045,-.004,-.016,.082,.040],[.095,.009,.028,.104,.041],
    [.23,.006,.083,.077,.031],[.32,0,.12,.048,.022]]);

  const fans=[];
  function fan(bone,color,count,baseHeight,feather){
    const mesh=a.mesh(bone,color,lod=>{
      const extended=[],folded=[],indices=[];
      const steps=[10,7,4][lod];
      for(let i=0;i<count;i++){
        const t=i/(count-1);
        const [x,z,length,width,spreadAngle,restAngle]=feather(t);
        const offset=extended.length/3;
        // Shingle the proximal webs over the distal webs. Give each blade
        // its own height band so neighbouring cambered surfaces stay apart.
        const height=baseHeight+(count-1-i)*.0014;
        for(const [positions,angle] of [[extended,spreadAngle],[folded,restAngle]]){
          const dx=Math.cos(angle),dz=Math.sin(angle);
          for(let j=0;j<=steps;j++){
            const u=j/steps,web=width*(.012+Math.sin(Math.PI*u)**.69)*(.78+.25*u);
            for(const k of [-1,0,.72]){
              positions.push(x+u*length*dx-k*web*dz,
                height+(.0004+(k===0?.0007:0))*Math.sin(Math.PI*u),
                z+u*length*dz+k*web*dx);
            }
          }
        }
        for(let j=1;j<=steps;j++){
          const k=offset+j*3;
          indices.push(k-3,k-2,k,k-2,k+1,k,k-2,k-1,k+1,k-1,k+2,k+1);
        }
      }
      const g=new T.BufferGeometry();
      g.setAttribute('position',new T.Float32BufferAttribute(extended,3));
      g.setIndex(indices);g.computeVertexNormals();
      const rest=g.clone();
      rest.setAttribute('position',new T.Float32BufferAttribute(folded,3));
      rest.computeVertexNormals();
      g.morphAttributes.position=[rest.attributes.position];
      g.morphAttributes.normal=[rest.attributes.normal];
      return g;
    });
    fans.push(mesh);
  }
  fan(shoulder,0x898b80,7,.038,t=>[.018+.22*t,-.066*t,.31+.14*t,.070,-1.34+.18*t,.48+.20*t]);
  fan(elbow,0x686c69,9,.008,t=>[.015+.285*t,.12*t,.48+.075*Math.sin(Math.PI*t),.079-.012*t,-1.43+.28*t,-1.78+.15*t]);
  fan(elbow,0x8c8d83,9,.023,t=>[.015+.285*t,.12*t+.018,.32+.02*t,.073,-1.43+.25*t,-1.78+.15*t]);
  fan(wrist,0x505658,10,-.022,t=>[.22*t,.018*t,.53+.20*t+.035*Math.sin(Math.PI*t),.080-.029*t,-1.25+1.11*t,.46-.36*t]);
  fan(wrist,0x727570,10,-.007,t=>[.18*t,.024*t,.30+.18*t,.065-.014*t,-1.17+.93*t,.44-.31*t]);

  // In repose span points aft and slightly up, chord points down the
  // flank, and the dorsal vane normals point out from the rib cage.
  const span=new T.Vector3(.075,.19,-.979).normalize();
  const dorsal=new T.Vector3(1,0,.077).normalize();
  const chord=span.clone().cross(dorsal).normalize();
  dorsal.crossVectors(chord,span).normalize();
  const folded=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(span,dorsal,chord));
  const spread=new T.Quaternion(),strokeEuler=new T.Euler();
  return (open,stroke)=>{
    const tuck=1-open;
    shoulder.quaternion.copy(folded).slerp(spread.setFromEuler(strokeEuler.set(0,0,stroke)),open);
    if(s<0){shoulder.quaternion.y*=-1;shoulder.quaternion.z*=-1}
    elbow.rotation.y=-2.22*tuck+.08;
    wrist.rotation.y=2.23*tuck;
    for(const layer of fans)layer.morphTargetInfluences[0]=tuck;
  };
}

export function wing(a,parent,s,pivot,size,palette){
  const shoulder=joint(parent,...pivot);shoulder.scale.setScalar(size);
  const [cover,mid,tip]=palette;
  a.oval(shoulder,cover,s*.20,0,-.04,.31,.081,.167);
  const wrist=joint(shoulder,s*.45,0,0);
  a.oval(wrist,mid,s*.14,-.009,-.035,.22,.049,.106);
  for(let i=0;i<8;i++){
    const t=i/7;
    feather(a,shoulder,i%3?mid:cover,[s*(.035+.41*t),-.014,-.04],[s*(.15+.52*t),-.034,-.48+.065*t],.083);
    feather(a,shoulder,cover,[s*(.035+.40*t),.042,.013],[s*(.12+.45*t),.018,-.30],.072);
  }
  for(let i=0;i<9;i++){
    const t=i/8;
    feather(a,wrist,i%3?tip:mid,[s*.25*t,-.012,.015],[s*(.22+.73*t),-.045-.024*t,-.46+.36*t*t],.076);
    feather(a,wrist,mid,[s*.18*t,.023,.022],[s*(.16+.43*t),.004,-.26+.16*t],.065);
  }
  const across=new T.Vector3(.12,-s*.46,-s*.88).normalize();
  const back=new T.Vector3(-s*.09,.88,-.46);
  const outward=back.clone().cross(across).normalize();
  back.crossVectors(across,outward).normalize();
  const folded=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(across,outward,back));
  const spread=new T.Quaternion(),flap=new T.Euler();
  return (open,stroke)=>{
    spread.setFromEuler(flap.set(0,0,s*stroke));
    shoulder.quaternion.copy(folded).slerp(spread,open);
    wrist.rotation.y=s*(1-open)*.38;
    wrist.rotation.z=s*open*(stroke*.38-.13);
  };
}

export function talon(a,parent,s,size){
  const foot=joint(parent);foot.scale.setScalar(size);
  a.oval(foot,0xb19a69,0,.015,.019,.067,.048,.088);
  for(const [x,z] of [[-.12,.23],[.012,.27],[.14,.20],[-.036,-.16]]){
    const toe=joint(foot);
    toe.rotation.y=Math.atan2(x*s,z);
    const len=Math.hypot(x,z);
    a.loft(toe,0xba9b60,[[0,.013,0,.035,.034],[0,.028,len*.45,.029,.026],[0,.008,len*.8,.020,.020]]);
    a.loft(toe,0x433c30,[[0,.012,len*.72,.022,.023],[0,0,len*.90,.017,.018],[0,-.038,len,.009,.01],[0,-.062,len*.95,.002,.003]]);
  }
  return foot;
}
