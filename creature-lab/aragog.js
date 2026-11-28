import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0,1,0);
const flatGround=()=>0;
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const clamp = THREE.MathUtils.clamp;
const smooth = x => x*x*(3-2*x);
function random(seed) { return () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0)/4294967296); }
function material(color, roughness=.78, options={}) {
  return new THREE.MeshStandardMaterial({color, roughness, ...options});
}
function mesh(parent, geometry, surface, name, position=V()) {
  const result = new THREE.Mesh(geometry, surface);
  result.name=name; result.position.copy(position); result.castShadow=true; result.receiveShadow=true;
  parent.add(result); return result;
}
function ellipsoid(parent, mat, pos, size, name, segments=22) {
  const result=mesh(parent,new THREE.SphereGeometry(1,segments,Math.max(8,Math.floor(segments*.66))),mat,name,pos);
  result.scale.copy(size); return result;
}

// The opisthosoma is widest behind its waist. The flatter prosoma carries a
// dorsal fovea with radiating muscle impressions and a bevelled lateral rim.
function skinPoint(which,u,v){
  const phi=TAU*u, t=v*Math.PI, a=Math.sin(t)*Math.cos(phi), b=Math.cos(t), c=Math.sin(t)*Math.sin(phi);
  const ridges=Math.cos(9*Math.atan2(a,c)+.6*c);
  if(which==='abdomen'){
    const bulge=1-.23*c;
    const relief=.016*Math.sin(15*a+6*c)*Math.sin(9*b-5*c)+.009*Math.cos(29*c+8*b);
    return V(.96*a*(bulge+relief), .86*b*(1-.15*c+relief)+.14*(1-c*c)-.09*c,1.32*c);
  }
  const top=Math.max(0,b);
  const fovea=Math.exp(-15*(a*a+(c+.12)*(c+.12)));
  return V(.93*a*(1-.09*c),.54*b+.095*top*ridges*Math.sqrt(a*a+c*c)-.14*fovea*top+.04*c,1.01*c);
}
function surfaceFrame(which,u,v) {
  const p=skinPoint(which,u,v);
  const normal=skinPoint(which,u+.0003,v).sub(p).cross(skinPoint(which,u,v+.0003).sub(p)).normalize();
  if(normal.dot(p)<0)normal.negate();
  return {p,normal};
}
function bodyGeometry(which,longitudes=64,latitudes=40){
  const geom=new THREE.SphereGeometry(1,longitudes,latitudes), p=geom.attributes.position,uv=geom.attributes.uv, cols=[];
  const base=new THREE.Color(), bright=new THREE.Color(), c=new THREE.Color();
  base.set(which==='abdomen'?0x3d302a:0x382b25); bright.set(which==='abdomen'?0x977a5b:0x9e805d);
  for(let i=0;i<p.count;i++){
    const u=uv.getX(i),v=1-uv.getY(i),point=skinPoint(which,u,v);
    p.setXYZ(i,point.x,point.y,point.z);
    const dorsal=clamp(point.y+.35,0,1);
    const pattern=which==='abdomen' ? Math.cos(19*point.z+7*Math.abs(point.x)+Math.sin(5*point.x)) : Math.cos(9*Math.atan2(point.x,point.z)+.6*point.z);
    const mottling=.08*Math.sin(29*point.x+8*point.z)*Math.cos(31*point.y-7*point.z);
    c.copy(base).lerp(bright,clamp(.12+dorsal*(.19+.17*pattern)+mottling,0,.85)); cols.push(c.r,c.g,c.b);
  }
  // The parametric longitude increases in the opposite direction from SphereGeometry.
  const ix=geom.index.array; for(let i=0;i<ix.length;i+=3){const j=ix[i+1];ix[i+1]=ix[i+2];ix[i+2]=j;}
  geom.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));geom.computeVertexNormals();geom.computeBoundingSphere();return geom;
}
function shaftGeometry(stations,sides=12){
  const vertices=[],indices=[],colors=[],c=new THREE.Color();
  for(let j=0;j<stations.length;j++){
    const [y,r,shade]=stations[j];
    for(let k=0;k<sides;k++){
      const a=k*TAU/sides;
      vertices.push(r*Math.cos(a),y,r*Math.sin(a));
      c.set(shade).multiplyScalar(.84+.16*Math.cos(a-1)); colors.push(c.r,c.g,c.b);
      if(j) {
        const a0=(j-1)*sides+k,b0=(j-1)*sides+(k+1)%sides,a1=a0+sides,b1=b0+sides;
        indices.push(a0,a1,b0,b0,a1,b1);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
const segments=[
 [[0,.62,0x574235],[.14,1,0x78604a],[.71,.93,0x59483a],[.96,.72,0x897155],[1,.54,0x3f332c]],
 [[0,.73,0x49382f],[.09,1.02,0x8c7455],[.21,1,0x725842],[.7,.77,0x483b34],[.89,.81,0x73614c],[1,.59,0x3b302d]],
 [[0,.7,0x4c3e33],[.1,1,0x9d8362],[.2,.97,0x755d48],[.65,.71,0x4d4037],[.92,.62,0x816b52],[1,.47,0x39312b]],
 [[0,.7,0x635344],[.12,1,0x8a7357],[.48,.7,0x574638],[.75,.52,0x413731],[1,.14,0x292623]]
];
// Ribbons curve back along the cuticle and narrow to a sharp tip. Sampling
// fixed seeds makes each lower-detail cohort a subset of its close-up parent.
function appendHair(out,base,dir,bend,width,length,color) {
  const side=V().crossVectors(dir,Math.abs(dir.y)>.85?V(1,0,0):UP).normalize().multiplyScalar(width);
  const mid=base.clone().addScaledVector(dir,length*.53).addScaledVector(bend,length*.15);
  const end=base.clone().addScaledVector(dir,length*.74).addScaledVector(bend,length*.69);
  const n=out.p.length/3;
  for(const [q,w,k] of [[base,-1,.51],[base,1,.54],[mid,-.65,.86],[mid,.65,.88],[end,0,1.06]]){
    out.p.push(q.x+side.x*w,q.y+side.y*w,q.z+side.z*w);out.c.push(color.r*k,color.g*k,color.b*k);
  }
  out.i.push(n,n+1,n+2,n+1,n+3,n+2,n+2,n+3,n+4);
}
function tuftGeometry(which,n){
  const result={p:[],c:[],i:[]},rng=random(which==='abdomen'?87:which==='head'?199:1233+which),col=new THREE.Color();
  for(let i=0;i<n;i++){
    const u=rng(),v=Math.acos(1-2*rng())/Math.PI, k=rng(),l=rng(),w=rng();
    if(typeof which==='string'){
      const {p,normal}=surfaceFrame(which,u,v);
      if(which==='head'&&p.z>.68&&p.y>.0)continue;
      const bend=V(p.x*.35,-.42,-.96).addScaledVector(normal,-.16).normalize();
      const band=Math.cos(17*p.z+7*Math.abs(p.x));
      const brightness=.46*k+.19*Math.max(0,p.y)+.13*band+.14*l;
      col.set(0x3c312a).lerp(new THREE.Color(0xc5ab85),clamp(brightness,0,1));
      appendHair(result,p,normal,bend,.0032+.002*w,(which==='abdomen'?.081:.045)+.098*l*l,col);
    }else{
      const a=u*TAU,y=.02+.955*(1-Math.cos(v*Math.PI))/2;
      const profile=segments[which];let j=1;while(j<profile.length-1&&profile[j][0]<y)j++;
      const [y0,r0]=profile[j-1],[y1,r1]=profile[j];const r=THREE.MathUtils.lerp(r0,r1,(y-y0)/(y1-y0));
      const radial=V(Math.cos(a),0,Math.sin(a)),base=V(radial.x*r,y,radial.z*r);
      col.set(0x4d3b2e).lerp(new THREE.Color(0xbca179),.3+.54*k);
      // Segment geometry is in unit-radius coordinates; longitudinal sizes are normalized separately.
      const len=(.35+.65*l)*(which===0?.65:1);
      const dir=radial.clone(),bend=V(.22*radial.x,.12+.035*w,.22*radial.z);
      appendHair(result,base,dir,bend,.016+.009*w,len,col);
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(result.p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(result.c,3));g.setIndex(result.i);g.computeVertexNormals();return g;
}
function curveMesh(parent,points,radii,mat,name) {
  const curve=new THREE.CatmullRomCurve3(points),n=16,sides=10,frames=curve.computeFrenetFrames(n,false),pos=[],ix=[];
  for(let i=0;i<=n;i++){
    const t=i/n,p=curve.getPointAt(t),rPos=t*(radii.length-1),j=Math.floor(rPos),r=THREE.MathUtils.lerp(radii[j],radii[Math.min(j+1,radii.length-1)],rPos-j);
    for(let k=0;k<sides;k++){
      const a=k*TAU/sides,q=p.clone().addScaledVector(frames.normals[i],Math.cos(a)*r).addScaledVector(frames.binormals[i],Math.sin(a)*r);
      pos.push(q.x,q.y,q.z);if(i){const i0=(i-1)*sides+k,i1=(i-1)*sides+(k+1)%sides;ix.push(i0,i1,i0+sides,i1,i1+sides,i0+sides);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(ix);g.computeVertexNormals();return mesh(parent,g,mat,name);
}
function shellMicrotexture(){
  const n=128,rng=random(196),data=new Uint8Array(n*n*4);
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const h=clamp(116+66*(rng()-.5)+13*Math.sin(i*TAU/16+Math.sin(j*TAU/32)),0,255),k=(i+j*n)*4;
    data[k]=data[k+1]=data[k+2]=h;data[k+3]=255;
  }
  const t=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(5,3);t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipMapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
export class Aragog {
  constructor(){
    this.root=new THREE.Group();this.root.name='Aragog';
    this.body=new THREE.Group();this.root.add(this.body);
    this.skin=material(0xffffff,.72,{vertexColors:true,bumpMap:shellMicrotexture(),bumpScale:.014});
    this.legMat=material(0xffffff,.66,{vertexColors:true});
    this.hairMat=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.92});
    this.shell=material(0x574538,.62);this.black=material(0x241c17,.30);this.eye=material(0x291e17,.09,{metalness:.27});
    this.eyeLight=material(0xe9d9a7,.16,{emissive:0x544b36,emissiveIntensity:.4});
    this.abdomen=mesh(this.body,bodyGeometry('abdomen'),this.skin,'Abdomen',V(0,.1,-.92));
    this.head=mesh(this.body,bodyGeometry('head'),this.skin,'Carapace',V(0,.04,.64));
    this.hairs=[];this.legShafts=[];this.legFur=[];this.legs=[];this.palps=[];this.fangs=[];
    const tuftCounts=[[4100,1650],[1340,540]];
    for(let l=0;l<2;l++){
      const a=mesh(this.abdomen,tuftGeometry('abdomen',tuftCounts[l][0]),this.hairMat,'Abdominal setae');
      const h=mesh(this.head,tuftGeometry('head',tuftCounts[l][1]),this.hairMat,'Carapace setae');
      a.castShadow=h.castShadow=false;this.hairs.push([a,h]);
    }
    for(const s of [-1,1]) {
      const mound=ellipsoid(this.body,this.shell,V(s*.18,.28,1.44),V(.26,.21,.21),'Ocular tubercle');
      for(const [x,y,z,r] of [[.13,.35,1.603,.111],[.35,.29,1.527,.08],[.49,.26,1.43,.067],[.57,.22,1.33,.049]]){
        ellipsoid(this.body,this.black,V(s*x,y,z),V(r*1.22,r*1.16,r*1.1),'Eye socket',16);
        ellipsoid(this.body,this.eye,V(s*x,y+.018,z+.035),V(r,r,r*.96),'Eye',16);
        ellipsoid(this.body,this.eyeLight,V(s*x-r*.23,y+r*.54,z+r*.94),V(r*.16,r*.12,r*.09),'Corneal glint',8);
      }
      const jaw=ellipsoid(this.body,this.shell,V(s*.255,-.075,1.52),V(.235,.32,.37),'Chelicera');
      jaw.rotation.x=-.32; 
      const fangRoot=new THREE.Group();fangRoot.position.set(s*.245,-.22,1.7);this.body.add(fangRoot);
      curveMesh(fangRoot,[V(),V(s*.035,-.13,.12),V(s*.02,-.30,.14),V(-s*.09,-.40,.08),V(-s*.13,-.42,.025)],[.09,.083,.058,.032,.002],this.black,'Fang');this.fangs.push(fangRoot);
      const palp=new THREE.Group();palp.position.set(s*.5,-.08,1.29);this.body.add(palp);
      curveMesh(palp,[V(),V(s*.23,.14,.28),V(s*.30,.15,.48),V(s*.27,-.06,.73),V(s*.20,-.22,.77)],[.12,.13,.11,.088,.055],this.shell,'Pedipalp');
      ellipsoid(palp,this.black,V(s*.20,-.20,.77),V(.092,.115,.112),'Palpal bulb',14);this.palps.push(palp);
      for(let j=0;j<3;j++) {
        const scar=V(s*(.56+j*.05),.43-j*.025,.74-j*.09);
        curveMesh(this.body,[scar,scar.clone().add(V(s*.075,.002,.026)),scar.clone().add(V(s*.135,-.026,.028))],[.006,.012,.002],this.shell,'Old cuticular scar');
      }
      ellipsoid(this.body,this.shell,V(s*.15,-.17,-2.13),V(.108,.11,.25),'Spinneret',12);
    }
    for(let j=0;j<4;j++){
      this.legShafts.push(this.batch(shaftGeometry(segments[j]),this.legMat,'Articulated leg segments'));
      this.legFur.push([this.batch(tuftGeometry(j,[125,430,360,168][j]),this.hairMat,'Leg setae'),this.batch(tuftGeometry(j,[30,102,85,40][j]),this.hairMat,'Medium leg setae')]);
    }
    this.joints=new THREE.InstancedMesh(new THREE.SphereGeometry(1,12,9),this.shell,24);this.joints.name='Joint membranes';this.joints.frustumCulled=false;this.root.add(this.joints);
    const sideX=[2.47,3.02,3.09,2.63],restZ=[2.62,1.33,-.42,-2.10],attachZ=[1.06,.69,.32,-.04];
    for(const s of [-1,1])for(let j=0;j<4;j++){
      const home=V(s*sideX[j],0,restZ[j]),hip=V(s*(.58+.13*Math.sin((j+.25)*Math.PI/4)),-.12,attachZ[j]);
      this.legs.push({s,j,home,hip,planted:null,swing:null,cooldown:0,phase:((j+(s>0?1:0))%2)*.5+.043*j,
        points:Array.from({length:5},()=>V()),fore:[1.64,1.77,1.71,1.64][j],shin:[1.42,1.57,1.51,1.4][j]});
    }
    this.bodyLevels=[
      [this.abdomen.geometry,this.head.geometry],
      [bodyGeometry('abdomen',36,24),bodyGeometry('head',36,24)],
      [bodyGeometry('abdomen',20,14),bodyGeometry('head',20,14)]
    ];
    this.fineDetails=[];
    this.body.traverse(o=>{if(['Old cuticular scar','Corneal glint','Eye socket'].includes(o.name))this.fineDetails.push(o);});
    this.lod=-1;this.yaw=0;this.speed=0;this.threat=0;this.defensive=0;this.clock=0;this.poseAccumulator=0;this.initialized=false;
    this.matrixDummy=new THREE.Object3D();this.setLOD(0);this.update(0,0,'Idle');
  }
  batch(geometry,mat,name){
    const obj=new THREE.InstancedMesh(geometry,mat,8);obj.name=name;obj.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    obj.frustumCulled=false;obj.castShadow=mat!==this.hairMat;obj.receiveShadow=true;this.root.add(obj);return obj;
  }
  setPosition(p){this.root.position.copy(p);this.initialized=false;for(const leg of this.legs){leg.planted=null;leg.swing=null;}}
  setLOD(level){
    const next=clamp(Math.round(level),0,2);if(next===this.lod)return;this.lod=next;
    [this.abdomen.geometry,this.head.geometry]=this.bodyLevels[next];
    for(const m of this.fineDetails)m.visible=next<2;
    for(let l=0;l<2;l++){
      for(const m of this.hairs[l])m.visible=l===next;
      this.legFur.forEach((pair,k)=>{
        pair[l].visible=l===next;
        if(l===next){
          pair[l].instanceMatrix.copyArray(this.legShafts[k].instanceMatrix.array);
          pair[l].instanceMatrix.needsUpdate=true;
        }
      });
    }
  }
  getBounds(){this.root.updateWorldMatrix(true,true);return new THREE.Box3().setFromCenterAndSize(V(0,1.20,.12),V(6.55,3.0,5.75)).applyMatrix4(this.root.matrixWorld);}
  stepFoot(leg,goal,dt,time,phase,ground,activity,size){
    if(!leg.planted){leg.planted=goal.clone();leg.planted.y=ground(goal.x,goal.z)+.018*size;}
    leg.cooldown=Math.max(0,leg.cooldown-dt);
    const slip=Math.hypot(goal.x-leg.planted.x,goal.z-leg.planted.z)/size;
    const ready=(phase+leg.phase)%1;
    if(!leg.swing&&leg.cooldown===0&&this.legs.filter(l=>l.swing).length<4&&((activity>.06&&slip>.14&&ready<.29)||slip>.90)){
      const end=goal.clone();end.y=ground(end.x,end.z)+.018*size;
      leg.swing={start:leg.planted.clone(),end,t:0,duration:.38+.037*leg.j};
    }
    if(!leg.swing)return leg.planted;
    const swing=leg.swing;swing.t=Math.min(1,swing.t+dt/swing.duration);
    const f=smooth(swing.t),foot=swing.start.clone().lerp(swing.end,f);
    foot.y=Math.max(ground(foot.x,foot.z)+.018*size,foot.y)+Math.sin(swing.t*Math.PI)*(.155+.052*activity)*size;
    if(swing.t>=1){leg.planted.copy(swing.end);leg.swing=null;leg.cooldown=.2;}
    return foot;
  }
  update(dt,time,action='Idle',context={}){
    dt=clamp(Number(dt)||0,0,.1);const name=String(action).toLowerCase();
    const walking=/walk|patrol|stalk|locomot/.test(name),turn=/turn/.test(name),display=/threat|rais|rear|defen/.test(name);
    const ground=context.terrainHeight||flatGround;
    if(this.ground!==ground){
      for(const leg of this.legs){leg.planted=null;leg.swing=null;}
      this.ground=ground;this.initialized=false;
    }
    this.poseAccumulator+=dt;
    if(this.lod===2&&dt>0&&this.poseAccumulator<1/22&&this.initialized)return;
    const poseDt=this.poseAccumulator;this.poseAccumulator=0;dt=poseDt;
    this.clock+=dt;const scale=this.root.scale.x||1;
    const ease=1-Math.exp(-dt*3.8);this.speed+=((walking?.56:0)-this.speed)*ease;this.threat+=((display?1:0)-this.threat)*ease;this.defensive+=((/threat|defen/.test(name)?1:0)-this.defensive)*ease;
    this.yaw+=(turn?.29:walking?.116:0)*dt;this.root.rotation.y=this.yaw;
    this.root.position.x+=Math.sin(this.yaw)*this.speed*dt*scale;this.root.position.z+=Math.cos(this.yaw)*this.speed*dt*scale;
    this.root.updateWorldMatrix(true,false);

    const origin=this.root.getWorldPosition(V()),worldScale=this.root.getWorldScale(V()).y;
    const sample=(x,z)=>{const p=this.root.localToWorld(V(x,0,z));return (ground(p.x,p.z)-origin.y)/worldScale;};
    const fore=sample(0,1.2),aft=sample(0,-1.2),left=sample(-1.5,0),right=sample(1.5,0);
    const height=1.12+.25*(fore+aft+left+right)+.014*Math.sin(time*1.37)+this.threat*.13;
    this.body.position.y=this.initialized?THREE.MathUtils.lerp(this.body.position.y,height,1-Math.exp(-poseDt*7)):height;
    this.body.rotation.set(clamp(-(fore-aft)/2.4,-.23,.23)-.09*this.threat-.14*this.defensive,0,clamp((right-left)/3,-.24,.24));
    this.body.updateMatrix();this.abdomen.scale.set(1+.009*Math.sin(time*1.4),1+.021*Math.sin(time*1.4),1);
    for(let j=0;j<2;j++){
      this.palps[j].rotation.x=.063*Math.sin(time*1.8+j*2.9)-.12*this.threat-.21*this.defensive;
      this.fangs[j].rotation.z=(j?1:-1)*(.04*Math.sin(time*1.13)+.08*this.threat+.38*this.defensive);
    }
    const phase=this.clock*.9,activity=Math.max(this.speed/.56,turn?1:0);
    for(let i=0;i<this.legs.length;i++){
      const leg=this.legs[i],home=leg.home.clone(),s=leg.s,j=leg.j;
      home.z+=this.speed*.56;
      if(turn)home.z-=.23*s;
      const restful=!walking&&!turn&&!display&&this.speed<.04;
      const moment=Math.floor(this.clock/4.7);
      if(restful&&moment>0&&i===(moment*3)%8&&leg.idleMoment!==moment&&!leg.swing&&leg.planted){
        const end=this.root.localToWorld(home.clone().add(V(.12*Math.sin(moment),0,.14*Math.cos(moment))));
        end.y=ground(end.x,end.z)+.018*worldScale;
        leg.swing={start:leg.planted.clone(),end,t:0,duration:.51};
        leg.idleMoment=moment;
      }
      const goal=this.root.localToWorld(home);
      const foot=this.stepFoot(leg,goal,poseDt,time,phase,ground,activity,worldScale);
      const [hip,base,knee,ankle,toe]=leg.points;
      toe.copy(foot);this.root.worldToLocal(toe);
      if(j===0&&this.threat>.001){
        const blend=smooth(this.threat);
        toe.lerp(V(s*1.76,this.body.position.y+.83+.34*this.defensive+.09*Math.sin(time*1.6+s),2.82),blend);
      }
      hip.copy(leg.hip).applyMatrix4(this.body.matrix);
      base.copy(hip).add(V(s*.35,.06,(1.3-j)*.10));
      const inward=V(base.x-toe.x,0,base.z-toe.z).normalize();
      ankle.copy(toe).addScaledVector(inward,.25).add(V(0,.38,0));
      // Two-link IK with an upward pole. The fixed pole keeps the elbow on
      // the anatomical branch through the entire stance/swing cycle.
      const dir=ankle.clone().sub(base),d=Math.max(.01,dir.length());dir.multiplyScalar(1/d);
      const along=clamp((leg.fore*leg.fore-leg.shin*leg.shin+d*d)/(2*d),0,leg.fore);
      const elevation=Math.sqrt(Math.max(.00001,leg.fore*leg.fore-along*along));
      const pole=V(s*.15,1,.13*(1.4-j));pole.addScaledVector(dir,-pole.dot(dir)).normalize();
      knee.copy(base).addScaledVector(dir,along).addScaledVector(pole,elevation);
      for(let k=0;k<4;k++){
        const from=leg.points[k],to=leg.points[k+1],vec=to.clone().sub(from),length=vec.length(),r=[.176,.167,.139,.094][k]*(1-.025*j);
        const dummy=this.matrixDummy;dummy.position.copy(from);dummy.quaternion.setFromUnitVectors(UP,vec.normalize());dummy.scale.set(r,length,r);dummy.updateMatrix();
        this.legShafts[k].setMatrixAt(i,dummy.matrix);if(this.lod<2)this.legFur[k][this.lod].setMatrixAt(i,dummy.matrix);
        if(k<3){dummy.position.copy(to);dummy.scale.setScalar(r*.74);dummy.updateMatrix();this.joints.setMatrixAt(i*3+k,dummy.matrix);}
      }
    }
    for(const m of this.legShafts)m.instanceMatrix.needsUpdate=true;
    if(this.lod<2)for(const pair of this.legFur)pair[this.lod].instanceMatrix.needsUpdate=true;
    this.joints.instanceMatrix.needsUpdate=true;this.initialized=true;
  }
  dispose(){
    this.root.removeFromParent();const geo=new Set(this.bodyLevels.flat()),mats=new Set();
    this.root.traverse(o=>{if(o.geometry)geo.add(o.geometry);if(o.material)mats.add(o.material);if(o.isInstancedMesh)o.dispose();});
    for(const g of geo)g.dispose();for(const m of mats){m.bumpMap?.dispose();m.dispose();}this.root.clear();
  }
}
