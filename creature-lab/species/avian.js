import * as T from '../vendor/three.module.js';
import {joint} from './form.js';

// Cambered vanes have a raised rachis and a narrower leading web.
export function feather(a,parent,color,start,end,width,normal=[0,1,0]){
  const from=new T.Vector3(...start),span=new T.Vector3(...end).sub(from);
  const side=span.clone().cross(new T.Vector3(...normal)).normalize();
  const up=side.clone().cross(span).normalize();
  return a.mesh(parent,color,l=>{
    const verts=[],idx=[],n=[10,7,4][l];
    for(let i=0;i<=n;i++){
      const t=i/n,w=width*(.015+Math.pow(Math.sin(Math.PI*t),.66))*(.8+.32*t);
      const center=from.clone().addScaledVector(span,t).addScaledVector(up,width*.16*Math.sin(Math.PI*t));
      for(const k of [-1,0,.72])verts.push(...center.clone().addScaledVector(side,w*k).addScaledVector(up,k===0?.21*w:0).toArray());
      if(i){const j=i*3;idx.push(j-3,j,j-2,j-2,j,j+1,j-2,j+1,j-1,j-1,j+1,j+2)}
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(idx);g.computeVertexNormals();return g;
  });
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
  return (open,stroke)=>{
    shoulder.rotation.order='YXZ';
    shoulder.rotation.y=s*(1-open)*1.22;
    shoulder.rotation.z=s*(stroke*open-.38*(1-open));
    shoulder.rotation.x=(1-open)*.95;
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
