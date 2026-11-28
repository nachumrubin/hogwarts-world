import * as THREE from './vendor/three.module.js';

const V = THREE.Vector3, TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const profiles = [
  [-7.05,.012,.025,.10],[-6.62,.26,.29,.13],[-6.03,.48,.53,.13],
  [-5.15,.66,.72,.10],[-4.05,.81,.83,.07],[-2.85,.93,.91,.07],
  [-1.85,.99,.95,.06],[-1.26,.95,.90,.04],[-1.04,.87,.86,.03],
  [-.99,.84,.83,.02]
];
const headProfile = [
  [-1.50,.34,.38,.0],[-1.26,.65,.69,.0],[-.89,.70,.74,-.06],
  [-.56,.80,.83,-.05],[-.19,.82,.85,-.06],[.14,.68,.75,-.10],
  [.42,.57,.62,-.15],[.64,.42,.43,-.14],[.71,.26,.25,-.13]
];
function randomGenerator(seed) {
  return () => { seed = (Math.imul(1664525,seed)+1013904223)>>>0; return seed/4294967296; };
}
function blend(a,b,t) { return a+(b-a)*t; }
function texture(w,h,array) {
  const result = new THREE.DataTexture(array,w,h,THREE.RGBAFormat);
  result.colorSpace = THREE.SRGBColorSpace;
  result.wrapS=result.wrapT=THREE.RepeatWrapping;
  result.magFilter=THREE.LinearFilter; result.minFilter=THREE.LinearMipmapLinearFilter;
  result.generateMipmaps=true; result.needsUpdate=true;
  return result;
}
function createSkin() {
  const w=512,h=256,rng=randomGenerator(11402), field=new Float32Array(64*64);
  for(let i=0;i<field.length;i++) field[i]=rng();
  function noise(x,y) {
    const i=Math.floor(x),j=Math.floor(y);
    let u=x-i,v=y-j;
    u=u*u*(3-2*u);v=v*v*(3-2*v);
    const at=(a,b)=>field[(a&63)+64*(b&63)];
    return blend(blend(at(i,j),at(i+1,j),u),blend(at(i,j+1),at(i+1,j+1),u),v);
  }
  const bytes = new Uint8Array(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const cloud=noise(x/21,y/15), fine=noise(x/6.3,y/6.1), grain=rng();
    const intensity=.72+.33*cloud+.18*fine;
    const freckle=grain>.89 ? -.21 : 0;
    const p=(x+y*w)*4;
    bytes[p]=clamp(219*(intensity+freckle)+13*grain,0,255);
    bytes[p+1]=clamp((112+31*cloud)*(intensity+freckle)+10*grain,0,255);
    bytes[p+2]=clamp((83+17*fine)*(intensity+freckle)+7*grain,0,255);
    bytes[p+3]=255;
  }
  for(let n=0;n<4500;n++){
    const cx=rng()*w, cy=rng()*h, r=.45+1.95*rng()**2;
    for(let y=Math.floor(cy-r);y<=cy+r;y++) for(let x=Math.floor(cx-r);x<=cx+r;x++) {
      const f=Math.max(0,1-Math.hypot(x-cx,y-cy)/r),p=4*((x+w)%w+w*((y+h)%h));
      bytes[p]*=1-.30*f;bytes[p+1]*=1-.56*f;bytes[p+2]*=1-.48*f;
    }
  }
  return texture(w,h,bytes);
}
function createIris() {
  const w=256,data=new Uint8Array(w*w*4),rng=randomGenerator(73);
  for(let y=0;y<w;y++) for(let x=0;x<w;x++){
    const a=(x+.5-w/2)/(w/2), b=(y+.5-w/2)/(w/2),r=Math.hypot(a,b),t=Math.atan2(b,a);
    const fiber=.5+.25*Math.sin(98*t+4*Math.sin(13*t)+14*r)+.17*Math.cos(177*t+8*r)+.1*rng();
    const ring=Math.max(0,1-12*Math.abs(r-.63));
    const edge=clamp((1-r)*7,.07,1), pupil=clamp((r-.48)*32,0,1);
    const i=4*(x+w*y);
    data[i]=(128+94*fiber+24*ring)*edge*pupil+7;
    data[i+1]=(76+79*fiber+22*ring)*edge*pupil+6;
    data[i+2]=(27+41*fiber+15*ring)*edge*pupil+5;
    data[i+3]=255;
  }
  return texture(w,w,data);
}
function profileGeometry(profile,nx,nr,isMantle) {
  const rad=new THREE.CatmullRomCurve3(profile.map(p=>new V(p[0],p[1],p[2])),false,'centripetal');
  const pos=[],colors=[],uv=[],indices=[];
  for(let i=0;i<=nx;i++) {
    const u=i/nx,q=rad.getPoint(u),y0=blend(profile[0][3],profile.at(-1)[3],u);
    for(let j=0;j<=nr;j++) {
      const v=j/nr, a=v*TAU,s=Math.sin(a),c=Math.cos(a);
      const ridges=1+.012*Math.cos(a*9+u*1.7)+.008*Math.sin(a*15-u*2);
      const x=q.x+(isMantle?.28*Math.max(s,0)**5*u**7:0);
      pos.push(x,y0+q.y*s*ridges,q.z*c*ridges);
      const shade=.80+.16*(1-s)/2+.07*Math.sin(3*a-.8*u);
      colors.push(shade,shade*(.80+.19*(1-s)/2),shade*(.77+.23*(1-s)/2));
      uv.push(u,v);
      if(i<nx && j<nr){const k=i*(nr+1)+j;indices.push(k,k+nr+1,k+1,k+1,k+nr+1,k+nr+2);}
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setIndex(indices);g.computeVertexNormals();return g;
}
function finGeometry(side,nu,nv) {
  const pos=[],color=[],uv=[],index=[];
  for(let i=0;i<=nu;i++){
    const u=i/nu;
    for(let j=0;j<=nv;j++){
      const v=j/nv, wing=Math.pow(Math.max(0,Math.sin(Math.PI*u)),.70)*(1.94-.97*u);
      pos.push(-6.98+3.08*u-.72*v*wing,.13+.26*u+.39*v*wing+.12*Math.sin(v*Math.PI)*wing,side*(.12+.52*u+v*wing));
      uv.push(u,v);
      const stripe=1-.095*(.5+.5*Math.cos(u*117-4*v))**6*v;
      color.push(stripe*(.90+.09*v),stripe*(.68+.26*v),stripe*(.71+.26*v));
      if(i<nu&&j<nv){const k=i*(nv+1)+j;index.push(k,k+nv+1,k+1,k+1,k+nv+1,k+nv+2);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute('color',new THREE.Float32BufferAttribute(color,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  g.setIndex(index);g.computeVertexNormals();return g;
}
function makeCupGeometry(detail) {
  return new THREE.LatheGeometry([[.055,-.13],[.40,-.18],[.65,-.04],[.96,.18],[1,.31],[.87,.43],[.69,.40],[.52,.19],[.28,-.02],[.03,-.07]].map(([r,h])=>new THREE.Vector2(r,h)),detail);
}
function makeArmPath(index) {
  const feed=index>=8, a=feed ? (index===8?0:Math.PI) : TAU*(index<4?index+1:index+2)/10;
  const sy=Math.sin(a),sz=Math.cos(a),side=index===8?1:-1;
  let pts;
  if(feed) pts=[
    [.17,sy*.43-.1,sz*.57],[1.38,-.12,sz*1.46],
    [3.6,side===1?-1.18:.78,side*2.56],[6.04,side===1?-2.2:1.63,side*2.81],
    [8.62,side===1?-2.02:1.17,side*2.15],[10.6,side===1?-1.43:.18,side*1.55]
  ];
  else{
    const len=[6.9,6.27,5.9,6.25,6.75,6.6,6.12,6.85][index];
    const curl=[-.8,-1.10,.13,.78,1.13,.82,.47,-.05][index];
    pts=[
      [.10,sy*.48-.1,sz*.53],[.88,sy*.79-.13,sz*.78],
      [2.08,sy*(1.17+.075*Math.sin(index))-.14,sz*1.23],
      [len*.58,sy*(1.55+.11*Math.cos(index))-.32,sz*1.56],
      [len*.85,sy*1.83-.56+curl*.27,sz*1.65+.22*Math.sin(index)],
      [len,sy*1.38-.54+curl,sz*1.50+Math.sin(index*.8)*.53]
    ];
  }
  return {curve:new THREE.CatmullRomCurve3(pts.map(p=>new V(...p)),false,'centripetal'),feed,a,sy,sz,index};
}
function radiusAt(u,arm) {
  if(!arm.feed) return (.014+.259*Math.pow(1-u,.78))*(1+.025*Math.sin(11*u+arm.index));
  const club=u<.66?0:Math.sin(Math.PI*clamp((u-.66)/.34,0,1))**.83;
  return .012+.165*(1-u)**1.15+.25*club;
}
function makeSleeve(arm,segments,sides,mat) {
  const n=(segments+1)*(sides+1), pos=new Float32Array(n*3),norm=new Float32Array(n*3);
  const colors=[],uv=[],indices=[];
  const rotation=[];
  for(let j=0;j<=sides;j++) rotation.push([Math.cos(j*TAU/sides),Math.sin(j*TAU/sides)]);
  const path=[], deformed=[], normals=[], binormals=[],radii=[];
  for(let i=0;i<=segments;i++) {
    const u=i/segments;path.push(arm.curve.getPointAt(u));deformed.push(new V());normals.push(new V());binormals.push(new V());radii.push(radiusAt(u,arm));
    for(let j=0;j<=sides;j++){
      uv.push(u*2.2,j/sides);
      const belly=Math.max(0,rotation[j][0])**1.4;
      colors.push(.86+.14*belly,.77+.32*belly,.77+.34*belly);
      const k=i*(sides+1)+j;
      if(i<segments&&j<sides) indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1);
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(pos,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal',new THREE.BufferAttribute(norm,3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);
  const mesh =new THREE.Mesh(g,mat);mesh.frustumCulled=false;mesh.name=arm.feed?'Feeding tentacle and club':'Muscular arm';
  return {...arm,mesh,segments,sides,path,deformed,normals,binormals,radii,rotation,cups:[]};
}
const forward=new V(),cross=new V(),face=new V(),pt=new V(),up=new V(0,1,0),dummy=new THREE.Object3D();
function deformArm(arm,t,motion) {
  const {index,segments,sides,mesh,path,deformed,radii,rotation}=arm;
  for(let i=0;i<=segments;i++) {
    const u=i/segments, rest=path[i], p=deformed[i],weight=u*u*(3-2*u), lag=t*(.53+index*.018)-u*3.7+index*1.97;
    const curl=Math.sin(lag)*.72+Math.sin(t*.27+u*5.7+index*.93)*.28;
    p.copy(rest);
    p.x+=weight*((arm.feed?2.05:0)*motion.feed-.19*curl);
    p.y+=weight*(motion.drift*(curl*.48+.18*Math.sin(t*.19+index))+.35*motion.dive);
    p.z+=weight*(motion.drift*(.37*Math.sin(lag*.91+1.7)+.15*Math.cos(t*.31+index))+motion.turn*.73);
  }
  // Reconstruct along the animated tangents with preserved segment arc lengths.
  // Feeding stalks extend hydrostatically while their clubs retain their length.
  for(let i=segments;i>0;i--) deformed[i].sub(deformed[i-1]).normalize();
  for(let i=1;i<=segments;i++){
    const u=(i-.5)/segments,extension=arm.feed?motion.feed*.24*(1-THREE.MathUtils.smoothstep(u,.60,.70)):0;
    const length=path[i].distanceTo(path[i-1])*(1+extension);
    deformed[i].multiplyScalar(length).add(deformed[i-1]);
    radii[i]=radiusAt(i/segments,arm)/Math.sqrt(1+extension);
  }
  const positions=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal;
  let k=0;
  for(let i=0;i<=segments;i++){
    forward.subVectors(deformed[Math.min(segments,i+1)],deformed[Math.max(0,i-1)]).normalize();
    const n=arm.normals[i],b=arm.binormals[i];
    if(i===0)n.set(0,-arm.sy,-arm.sz);else n.copy(arm.normals[i-1]);
    n.addScaledVector(forward,-n.dot(forward)).normalize();
    b.crossVectors(forward,n).normalize();
    const p=deformed[i],r=radii[i],u=i/segments;
    const club=arm.feed?Math.sin(Math.PI*clamp((u-.66)/.34,0,1)):0;
    const sectionDepth=1-.39*club;
    for(let j=0;j<=sides;j++,k++){
      const [c,s]=rotation[j];
      face.copy(n).multiplyScalar(c*sectionDepth).addScaledVector(b,s);
      positions.setXYZ(k,p.x+r*face.x,p.y+r*face.y,p.z+r*face.z);
      face.copy(n).multiplyScalar(c/sectionDepth).addScaledVector(b,s).normalize();
      normals.setXYZ(k,face.x,face.y,face.z);
    }
  }
  positions.needsUpdate=normals.needsUpdate=true;
}
function placeCups(arm,batch,offset) {
  for(const cup of arm.cups) {
    const f=cup.u*arm.segments,i=Math.floor(f),j=Math.min(i+1,arm.segments),v=f-i;
    const r=blend(arm.radii[i],arm.radii[j],v);
    const n=arm.normals[i],b=arm.binormals[i];
    const club=arm.feed?Math.sin(Math.PI*clamp((cup.u-.66)/.34,0,1)):0;
    pt.lerpVectors(arm.deformed[i],arm.deformed[j],v);
    pt.addScaledVector(n,r*cup.c*(1-.39*club)).addScaledVector(b,r*cup.s);
    face.copy(n).multiplyScalar(cup.c).addScaledVector(b,cup.s).normalize();
    dummy.position.copy(pt);dummy.quaternion.setFromUnitVectors(up,face);
    const scale=r*(arm.feed?.35:.44);
    dummy.scale.set(scale,scale,scale);dummy.updateMatrix();batch.setMatrixAt(offset++,dummy.matrix);
  }
  return offset;
}
function makeMaterial(color,properties={}) {return new THREE.MeshStandardMaterial({color,...properties});}
const lodDefinitions=[
  {segments:56,sides:14,body:68,sections:52,rows:32,cup:12,rate:0},
  {segments:33,sides:10,body:40,sections:34,rows:16,cup:8,rate:1/36},
  {segments:15,sides:7,body:22,sections:18,rows:0,cup:5,rate:1/15}
];
function sphere(group,mat,xyz,sizes,detail=28) {
  const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,detail,Math.max(8,detail>>1)),mat);
  mesh.position.set(...xyz);mesh.scale.set(...sizes);group.add(mesh);return mesh;
}
function gaze(actor,side,materials,detail) {
  const parent=new THREE.Group();parent.position.set(-.33,.025,side*.725);parent.rotation.y=side<0?Math.PI:0;actor.add(parent);
  sphere(parent,materials.socket,[0,.015,.028],[.51,.49,.25],detail);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.376,.071,8,detail),materials.skinPlain);
  rim.scale.set(1.1,1.02,1);rim.position.z=.205;parent.add(rim);
  sphere(parent,materials.globe,[0,0,.20],[.385,.369,.18],detail);
  const iris=new THREE.Mesh(new THREE.CircleGeometry(.315,detail),materials.iris);
  iris.scale.x=1.03;iris.position.z=.367;parent.add(iris);
  sphere(parent,materials.pupil,[0,0,.358],[.163,.161,.042],detail);
  sphere(parent,materials.glint,[-.094,.117,.40],[.043,.031,.008],12);
  sphere(parent,materials.glint,[-.038,.16,.394],[.013,.011,.004],8);
}
function actionMode(str) {
  const a=String(str||'swim').toLowerCase();
  if(/feed|extend/.test(a))return 'feed';
  if(/rest|idle/.test(a))return 'rest';
  if(/turn/.test(a))return 'turn';
  if(/div/.test(a))return 'dive';
  if(/invest|approach/.test(a))return 'investigate';
  if(/retreat/.test(a))return 'retreat';
  return 'swim';
}
export class Squid {
  constructor(){
    this.root=new THREE.Group();this.root.name='Architeuthis — Giant squid';this.pose=new THREE.Group();this.root.add(this.pose);
    this.anchor=new V();this.offset=new V();this.velocity=new V();this.goal=new V();this.target=new V();this.yaw=0;
    this.skinMap=createSkin();this.irisMap=createIris();
    const options={map:this.skinMap,bumpMap:this.skinMap,bumpScale:.019,roughness:.41,metalness:.025,vertexColors:true,side:THREE.DoubleSide};
    this.materials={
      skin:makeMaterial(0xffe3d0,options),skinPlain:makeMaterial(0xad6147,{roughness:.41}),
      collar:makeMaterial(0x934c38,{roughness:.48}),
      cup:makeMaterial(0xe4ab89,{roughness:.47,side:THREE.DoubleSide}),
      socket:makeMaterial(0x59271f,{roughness:.39}),
      globe:makeMaterial(0x402917,{roughness:.21}),iris:makeMaterial(0xffffff,{map:this.irisMap,roughness:.39}),
      pupil:makeMaterial(0x090b0a,{roughness:.13}),glint:makeMaterial(0xe3eddd,{emissive:0x6f8e88,roughness:.20}),
      fin:makeMaterial(0xf3c3ab,{...options,roughness:.55}),
      siphon:makeMaterial(0xb97c66,{roughness:.48}),
      mouth:makeMaterial(0x4b2824,{roughness:.56})
    };
    // A low-frequency transmission tint models light scattered through the dermis.
    for(const mat of [this.materials.skin,this.materials.fin]) {
      mat.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',
          '#include <lights_fragment_end>\nfloat grazing=pow(1.0-clamp(dot(normal,normalize(vViewPosition)),0.0,1.0),2.5); reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(0.28,0.082,0.040)*grazing;');
      };
    }
    this.lod=-1;this.clock=0;this.lastPose=-Infinity;this.motion={feed:0,turn:0,dive:0,drift:1};
    this.setLOD(0);
  }
  async initialize(){return this;}
  build(level){
    const spec=lodDefinitions[level],m=this.materials;
    this.actor=new THREE.Group();this.pose.add(this.actor);
    this.mantle=new THREE.Mesh(profileGeometry(profiles,spec.body,spec.sections,true),m.skin);
    this.mantle.name='Muscular mantle';this.actor.add(this.mantle);
    const collar=new THREE.Mesh(profileGeometry([[-1.16,.92,.89,.04],[-1.08,.95,.94,.03],[-1.02,.88,.88,.03]],7,spec.sections,true),m.skin);
    this.mantle.add(collar);
    const head=new THREE.Mesh(profileGeometry(headProfile,spec.body>>1,spec.sections,false),m.skin);
    head.name='Head and brachial crown';this.actor.add(head);
    const siphon=new THREE.Mesh(new THREE.CylinderGeometry(.135,.27,.89,16,2,true),m.siphon);
    siphon.position.set(-.75,-.68,.39);siphon.rotation.z=-1.1;siphon.rotation.x=.19;this.actor.add(siphon);
    const lumen=new THREE.Mesh(new THREE.CircleGeometry(.132,18),m.mouth);
    lumen.rotation.x=-Math.PI/2;lumen.position.y=.435;siphon.add(lumen);
    for(const side of [-1,1])gaze(this.actor,side,m,spec.sections);
    this.fins=[];
    for(const side of [-1,1]){
      const nu=Math.max(13,spec.body>>1),nv=level===0?10:5;
      const g=finGeometry(side,nu,nv),mesh=new THREE.Mesh(g,m.fin);
      mesh.name='Paired terminal fin';this.mantle.add(mesh);
      this.fins.push({g,base:g.attributes.position.array.slice(),nu,nv,side});
    }
    this.arms=[];let count=0;
    for(let index=0;index<10;index++){
      const arm=makeSleeve(makeArmPath(index),spec.segments,spec.sides,m.skin);
      for(let row=0;row<spec.rows;row++){
        const rows=arm.feed?4:2;
        for(let j=0;j<rows;j++){
          const u=(row+.5+(j%2)*.38)/(spec.rows+.3);
          const theta=(j-(rows-1)*.5)*(arm.feed?.43:.94);
          arm.cups.push({u:arm.feed?.706+u*.265:.065+u*.85,c:Math.cos(theta),s:Math.sin(theta)});
        }
      }
      this.actor.add(arm.mesh);this.arms.push(arm);count+=arm.cups.length;
    }
    this.cupBatch=count?new THREE.InstancedMesh(makeCupGeometry(spec.cup),m.cup,count):null;
    if(this.cupBatch){this.cupBatch.name='Pedunculate sucker rims';this.cupBatch.frustumCulled=false;this.cupBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);this.actor.add(this.cupBatch);}
  }
  animate(t){
    const pulse=(.5+.5*Math.sin(t*1.96))**2;
    this.mantle.scale.set(1+.007*pulse,1-.045*pulse,1-.046*pulse);
    for(const f of this.fins){
      const a=f.g.attributes.position;
      for(let i=0;i<=f.nu;i++)for(let j=0;j<=f.nv;j++){
        const k=i*(f.nv+1)+j,u=i/f.nu,v=j/f.nv,edge=Math.sin(Math.PI*u)**.8*v*v;
        const wave=Math.sin(2.3*t-5*u+f.side*.24);
        a.setY(k,f.base[k*3+1]+edge*(.18+.19*wave));
      }
      a.needsUpdate=true;f.g.computeVertexNormals();
    }
    let offset=0;
    for(const arm of this.arms){deformArm(arm,t,this.motion);if(this.cupBatch) offset=placeCups(arm,this.cupBatch,offset);}
    if(this.cupBatch)this.cupBatch.instanceMatrix.needsUpdate=true;
  }
  update(dt,time,action='swim',context={}){
    dt=clamp(dt||0,0,.12);const t=Number.isFinite(time)?time:this.clock+dt;this.clock=t;
    const mode=actionMode(action),w=1-Math.exp(-1.55*dt),s=this.root.scale.x||1;
    const m=this.motion;
    m.feed=blend(m.feed,mode==='feed'?1:0,w);m.dive=blend(m.dive,mode==='dive'?1:0,w);m.turn=blend(m.turn,mode==='turn'?1:0,w);
    m.drift=blend(m.drift,mode==='rest'?.44:mode==='retreat'?1.35:1,w);
    const goal=this.goal;
    goal.set(Math.sin(t*.145)*.70,Math.sin(t*.39)*.12-m.dive*.80,Math.sin(t*.22)*.24);
    if(mode==='rest')goal.multiplyScalar(.20);
    const stimulus=context.stimulus||context.playerPosition;
    let heading=m.turn*(.62*Math.sin(t*.27));
    if(stimulus && Number.isFinite(stimulus.x)) {
      this.target.copy(stimulus);this.root.worldToLocal(this.target);this.target.sub(this.offset);
      const distance=this.target.length(), attentive=mode==='investigate'||mode==='retreat'||distance<5;
      if(attentive&&distance>.05){
        const turnAway=mode==='retreat'||distance<2.2;
        this.target.normalize().multiplyScalar(turnAway?-1:1);
        goal.addScaledVector(this.target,mode==='investigate'?1.4:.8);
        heading+=clamp(Math.atan2(-this.target.z,this.target.x),-.74,.74)*.73;
      }
    }
    for(const obj of context.obstacles||[]) {
      if(!obj.position)continue;
      this.target.copy(obj.position);this.root.worldToLocal(this.target);
      this.target.sub(this.offset).multiplyScalar(-1);
      const d=this.target.length(),safe=(obj.radius||1)/s+1.5;
      if(d<safe&&d>.01)goal.addScaledVector(this.target,(safe-d)/d);
    }
    goal.clampLength(0,Math.max(.05,(context.habitatRadius||4)/s));
    this.velocity.addScaledVector(this.target.subVectors(goal,this.offset),dt*1.3);
    this.velocity.multiplyScalar(Math.exp(-1.9*dt));this.offset.addScaledVector(this.velocity,dt);
    this.yaw=blend(this.yaw,heading,1-Math.exp(-dt*.9));
    this.pose.position.copy(this.offset);
    this.pose.rotation.set(.034*Math.sin(t*.37),this.yaw+.028*Math.sin(t*.29),-.08*m.dive+.025*Math.sin(t*.48),'YXZ');
    if(t<this.lastPose || t-this.lastPose>=lodDefinitions[this.lod].rate || dt===0){this.animate(t);this.lastPose=t;}
  }
  setPosition(p){this.root.position.copy(p);this.anchor.copy(p);}
  setLOD(level) {
    level=clamp(Math.round(level),0,2);if(level===this.lod)return;
    this.clearGeometry();this.build(level);this.lod=level;this.animate(this.clock);this.lastPose=this.clock;
  }
  clearGeometry(){
    if(!this.actor)return;
    this.actor.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.isInstancedMesh)o.dispose();});
    this.pose.remove(this.actor);
  }
  getBounds(){
    this.root.updateWorldMatrix(true,true);
    return new THREE.Box3(new V(-7.3,-3.7,-3.8),new V(13.1,3.4,3.8)).applyMatrix4(this.pose.matrixWorld);
  }
  dispose(){
    this.clearGeometry();for(const mat of Object.values(this.materials))mat.dispose();
    this.skinMap.dispose();this.irisMap.dispose();this.root.removeFromParent();
  }
}
