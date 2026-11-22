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

export function raptorWing(a,parent,s,pivot){
  const shoulder=joint(parent,...pivot);shoulder.scale.setScalar(1.65);
  const elbow=joint(shoulder,s*.255,0,-.105),wrist=joint(elbow,s*.30,0,.12);
  // For a sweep along X, section width runs along the chord (Z).
  a.loft(shoulder,0x8c8d83,[[-s*.08,-.012,.012,.10,.052],[s*.07,.008,-.026,.144,.065],
    [s*.19,.005,-.071,.128,.050],[s*.29,-.008,-.108,.073,.030]]);
  a.loft(elbow,0x85867c,[[-s*.045,-.004,-.016,.082,.040],[s*.095,.009,.028,.104,.041],
    [s*.23,.006,.083,.077,.031],[s*.32,0,.12,.048,.022]]);
  const scapulars=[];
  for(let i=0;i<7;i++){
    const t=i/6;
    scapulars.push([[s*(.018+.22*t),.035,-.066*t],
      [s*(.060+.27*t),-.018,-.28-.21*t],.069+.012*t]);
  }
  plumage(a,shoulder,0x898b80,scapulars);
  const secondaries=[],coverts=[],primaries=[],wristCoverts=[];
  for(let i=0;i<9;i++){
    const t=i/8,x=s*(.015+.30*t),z=.12*t;
    secondaries.push([[x,-.011,z],[s*(.085+.42*t),-.050+.025*t,z-.47-.08*Math.sin(Math.PI*t)],.078-.012*t]);
    coverts.push([[x,.034,z+.018],[s*(.06+.38*t),.001,z-.31],.071]);
  }
  for(let i=0;i<10;i++){
    const t=i/9;
    primaries.push([[s*.23*t,-.012,.018*t],[s*(.16+.78*Math.sin(1.53*t)),-.052-.035*t,-.47+.36*t*t],.081-.029*t]);
    wristCoverts.push([[s*.19*t,.024,.03*t],[s*(.12+.49*t),.003,-.27+.15*t*t],.067-.018*t]);
  }
  plumage(a,elbow,0x686c69,secondaries);plumage(a,elbow,0x8c8d83,coverts);
  plumage(a,wrist,0x505658,primaries);plumage(a,wrist,0x727570,wristCoverts);
  const across=new T.Vector3(.12,-s*.46,-s*.88).normalize();
  const back=new T.Vector3(-s*.09,.88,-.46),out=back.clone().cross(across).normalize();
  back.crossVectors(across,out).normalize();
  const folded=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(across,out,back));
  const spread=new T.Quaternion(),strokeEuler=new T.Euler();
  return (open,stroke)=>{
    shoulder.quaternion.copy(folded).slerp(spread.setFromEuler(strokeEuler.set(0,0,s*stroke)),open);
    elbow.rotation.y=s*(.64*(1-open)+.08);
    wrist.rotation.y=-s*(1-open)*.38;
    wrist.rotation.z=s*open*(stroke*.38-.13);
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
