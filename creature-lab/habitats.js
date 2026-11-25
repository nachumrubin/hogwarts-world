import * as THREE from './vendor/three.module.js';

const {sin, cos, abs, max, min, PI} = Math;
const V = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
const color = hex => new THREE.Color(hex);

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    return seed / 4294967296;
  };
}
const noiseGLSL = `
float landscapeHash(vec3 p) {
  p = fract(p*.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y)*p.z);
}
float landscapeNoise(vec3 p) {
  vec3 i=floor(p), f=fract(p);
  f=f*f*(3.-2.*f);
  return mix(mix(mix(landscapeHash(i),landscapeHash(i+vec3(1,0,0)),f.x),
                 mix(landscapeHash(i+vec3(0,1,0)),landscapeHash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(landscapeHash(i+vec3(0,0,1)),landscapeHash(i+vec3(1,0,1)),f.x),
                 mix(landscapeHash(i+vec3(0,1,1)),landscapeHash(i+vec3(1)),f.x),f.y),f.z);
}`;

function surfaceMaterial(hex, surface, lake, clock) {
  const m = new THREE.MeshStandardMaterial({color:hex,roughness:.88});
  m.onBeforeCompile = shader => {
    shader.uniforms.habitatTime=clock;
    shader.vertexShader = 'varying vec3 habitatP;\n'+shader.vertexShader.replace('#include <project_vertex>',`
       vec4 hp=vec4(transformed,1.);
       #ifdef USE_INSTANCING
       hp=instanceMatrix*hp;
       #endif
       habitatP=(modelMatrix*hp).xyz;
       #include <project_vertex>
     `);
    shader.fragmentShader = 'varying vec3 habitatP;\nuniform float habitatTime;\n'+noiseGLSL+'\n'+shader.fragmentShader.replace('#include <color_fragment>',`
      #include <color_fragment>
      vec3 p=habitatP;
      float l=landscapeNoise(p*.75), m=landscapeNoise(p*3.6), s=landscapeNoise(p*18.);
      diffuseColor.rgb *= .55+.46*l+.38*m+.27*s;
      ${surface==='stone'?`
       float seam=abs(fract(p.y*2.7+p.x*.54+p.z*.39 + m*.55+l*1.2)-.5);
       diffuseColor.rgb *= .75+.29*smoothstep(.015,.105,seam);
       diffuseColor.rgb += vec3(.024,.027,.015)*smoothstep(.58,.83,m*.76+l*.24);
      `:surface==='bark'?`
       float grain=landscapeNoise(vec3(p.x*15.,p.y*.9,p.z*15.));
       diffuseColor.rgb *= .58+.64*smoothstep(.13,.63,grain);
       diffuseColor.rgb += vec3(.025,.031,.009)*smoothstep(.56,.82,m*.58+l*.42);
      `:`
       float ripple=sin(p.x*6.2+p.z*3.9+l*6.+m*.7);
       diffuseColor.rgb*=.92+.08*ripple;
      `}
      ${lake?`
        vec2 q=p.xz*.65+vec2(habitatTime*.075,-habitatTime*.047);
        float ca=abs(sin(q.x+sin(q.y*1.7))+.72*cos(q.y+sin(q.x*1.55)));
        diffuseColor.rgb+=vec3(.018,.047,.034)*pow(1.-min(ca,1.),8.)*smoothstep(.25,.65,l);
      `:''}
    `);
  };
  m.customProgramCacheKey=()=>surface+lake;
  return m;
}

function layeredTerrain(x,z) {
  return sin(.37*x+.27*z)*.16 + sin(.73*z-.12*x)*.095 + sin(x*.9+z*.43)*.045
       + sin(x*.12-z*.1)*.26;
}

function terrainMesh(height, material) {
  const geo=new THREE.PlaneGeometry(100,100,130,130);
  geo.rotateX(-PI/2);
  const pos=geo.attributes.position;
  for(let i=0;i<pos.count;i++) pos.setY(i,height(pos.getX(i),pos.getZ(i)));
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,material);
  mesh.receiveShadow=true;
  return mesh;
}

function rockVariant(random) {
  const g=new THREE.IcosahedronGeometry(1,2);
  const p=g.attributes.position;
  const o=random()*18;
  for(let i=0;i<p.count;i++){
    let x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const d=1+.091*sin(4*x+3*z+o)*cos(5*y-z)+.043*cos(x*9+z*7+y*4+o);
    x=x*d + y*.18;
    z=z*d - x*.075;
    y=Math.sign(y)*Math.pow(abs(y),.73)*d;
    p.setXYZ(i,x,y,z);
  }
  g.computeVertexNormals();
  return g;
}

function instances(group, geometry, material, transforms, tint=false) {
  if(!transforms.length){geometry.dispose();return;}
  const mesh=new THREE.InstancedMesh(geometry,material,transforms.length);
  const temp=new THREE.Object3D();
  for(let i=0;i<transforms.length;i++){
    const [x,y,z,sx,sy,sz,rx,ry,rz,c]=transforms[i];
    temp.position.set(x,y,z);
    temp.scale.set(sx,sy,sz);
    temp.rotation.set(rx,ry,rz);
    temp.updateMatrix();
    mesh.setMatrixAt(i,temp.matrix);
    if(tint)mesh.setColorAt(i,c);
  }
  mesh.receiveShadow=true;
  group.add(mesh);
  return mesh;
}

function addRocks(group,height,random,lake,clock,obstacles) {
  const m=surfaceMaterial(lake?0x52635a:0x626052,'stone',lake,clock);
  const batches=Array.from({length:4},()=>[]);
  function rock(x,z,sx,sy,sz,bury=.30){
    const y=height(x,z)+sy*(.55-bury);
    const tone= .62+random()*.4;
    batches[Math.floor(random()*4)].push([x,y,z,sx,sy,sz,random()*.42,random()*PI,random()*.28,color(0xffffff).multiplyScalar(tone)]);
    if(sx>1.6) {
      const center=V(x,y,z);
      obstacles.push({position:center,center,radius:Math.max(sx,sz)*.82});
    }
  }
  for(let i=0;i<(lake?88:40);i++) {
    const x=(random()-.5)*52,z=-6-random()*22;
    const s=.65+random()*(lake?3.2:1.55);
    rock(x,z,s*(.82+random()),s*(.55+random()*.67),s);
  }
  for(let i=0;i<(lake?125:70);i++){
    const x=(random()-.5)*40,z=(random()-.38)*32;
    const allowed=abs(x)>(lake?8:4.5) || z<-(lake?6:4);
    const s=allowed?.25+random()*1.6:.035+random()*.10;
    rock(x,z,s*1.4,s*.7,s);
  }
  for(let i=0;i<170;i++){
    const x=(random()-.5)*36,z=(random()-.4)*28,s=.025+Math.pow(random(),2)*.21;
    rock(x,z,s*1.35,s*.62,s,.37);
  }
  batches.forEach(batch=>instances(group,rockVariant(random),m,batch,true));
}

function taperedPath(points,radii,sides=8) {
  const curve=new THREE.CatmullRomCurve3(points);
  const steps=(points.length-1)*3, frames=curve.computeFrenetFrames(steps,false);
  const positions=[],indices=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps,q=curve.getPointAt(t),rp=t*(radii.length-1),k=min(Math.floor(rp),radii.length-2);
    const r=THREE.MathUtils.lerp(radii[k],radii[k+1],rp-k);
    for(let j=0;j<sides;j++){
      const a=j*2*PI/sides, v=q.clone().addScaledVector(frames.normals[i],r*cos(a)).addScaledVector(frames.binormals[i],r*sin(a));
      positions.push(v.x,v.y,v.z);
      if(i<steps){const a0=i*sides+j,b=i*sides+(j+1)%sides;indices.push(a0,b,a0+sides,b,b+sides,a0+sides);}
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geo.setIndex(indices);geo.computeVertexNormals();
  return geo;
}

function mergeParts(parts){
  const p=[],n=[],idx=[];
  let offset=0;
  parts.forEach(g=>{
    for(const x of g.attributes.position.array)p.push(x);
    for(const x of g.attributes.normal.array)n.push(x);
    for(const x of g.index.array)idx.push(x+offset);
    offset+=g.attributes.position.count;g.dispose();
  });
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));
  g.setIndex(idx);return g;
}

function bladeClump(random,forest) {
  const p=[],idx=[],colors=[];
  for(let j=0;j<(forest?9:14);j++){
    const a=random()*PI*2,lean=.2+.8*random(),h=.34+random()*.93,phase=random()*8;
    const baseX=(random()-.5)*.22,baseZ=(random()-.5)*.22;
    const width=forest?.045+random()*.06:.045+random()*.12;
    const start=p.length/3;
    for(let k=0;k<=9;k++){
      const t=k/9, w=(.15+.85*sin(PI*Math.pow(t,.78))**.66)*width*(1-t*.9);
      const offset=lean*t*t+(forest?0:.08*sin(t*5+phase)*t);
      const cx=baseX+cos(a)*offset,cz=baseZ+sin(a)*offset,cy=t*h-(forest?.43:.20)*t*t;
      for(let s=-1;s<=1;s++){
        p.push(cx+sin(a)*w*s,cy+(s===0?w*.24:0),cz-cos(a)*w*s);
        colors.push(.23+t*.49,.30+t*.62,.23+t*.38);
      }
      if(k<9)for(let s=0;s<2;s++){
        const v=start+k*3+s;idx.push(v,v+3,v+1,v+1,v+3,v+4);
      }
    }
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  g.setIndex(idx);g.computeVertexNormals();return g;
}

function plants(group,height,random,lake,clock) {
  const material=new THREE.MeshStandardMaterial({color:lake?0x619480:0x718053,side:THREE.DoubleSide,vertexColors:true,roughness:.83});
  material.onBeforeCompile=s=>{
    s.uniforms.habitatTime=clock;
    s.vertexShader='uniform float habitatTime;\n'+s.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      float tip=position.y*position.y;
      transformed.x+=tip*.075*sin(habitatTime*.57+instanceMatrix[3].x*.65+position.y*2.);
      transformed.z+=tip*.045*cos(habitatTime*.39+instanceMatrix[3].z*.55);
    `);
  };
  for(let k=0;k<3;k++){
    const placements=[];
    for(let i=0;i<150;i++){
      const x=(random()-.5)*36,z=(random()-.66)*28;
      const path=abs(x)<(lake?7:3.8)&&abs(z)<(lake?5:4);
      const h=(.45+random()*1.48)*(path?.24:1);
      placements.push([x,height(x,z)-.035,z,h,h*(lake?1.2:.82),h,0,random()*PI*2,0]);
    }
    instances(group,bladeClump(random,!lake),material,placements);
  }
}

function web(group,center,r,rot) {
  const pts=[],spokes=17;
  const anchors=Array.from({length:spokes},(_,i)=>{
    const a=i*PI*2/spokes;
    return V(cos(a)*r*(.84+.16*sin(i*12.13)),sin(a)*r*.78,0);
  });
  function edge(p,q){pts.push(p.x,p.y,p.z,q.x,q.y,q.z);}
  for(const p of anchors)edge(V(),p.clone().multiplyScalar(1.35));
  for(let ring=1;ring<13;ring++){
    for(let i=0;i<spokes;i++){
      const t=ring/13+.016*sin(i*.7+ring*.73);
      const a=anchors[i].clone().multiplyScalar(t),b=anchors[(i+1)%spokes].clone().multiplyScalar(t+.01*sin(i));
      const mid=a.clone().lerp(b,.5);mid.y-=r*.018*t;mid.z+=r*.015*t;
      edge(a,mid);edge(mid,b);
    }
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  const m=new THREE.LineBasicMaterial({color:0xb6c5ba,transparent:true,opacity:.25,depthWrite:false});
  const obj=new THREE.LineSegments(geo,m);
  obj.position.copy(center);obj.rotation.y=rot;group.add(obj);
}

function addForest(group,height,random,clock,obstacles) {
  const bark=surfaceMaterial(0x655345,'bark',false,clock);
  const crownMat=new THREE.MeshStandardMaterial({color:0x253a2e,roughness:1});
  const crowns=[];
  for(let variety=0;variety<3;variety++){
    const wood=[];
    wood.push(taperedPath([V(0,0,0),V(.12,1.2,.15),V(-.1,3.9,0),V(.12,6.5,-.39),V(-.35,9,-.45)], [.68,.42,.31,.22,.12],12));
    for(let i=0;i<7;i++){
      const a=i*2.399+variety, c=cos(a),s=sin(a),l=1.4+random()*1.15;
      wood.push(taperedPath([V(0,.85,0),V(c*.48,.35,s*.48),V(c*l*.72,.09,s*l*.72),V(c*l,-.04,s*l)], [.27,.24,.1,.017],7));
    }
    for(let i=0;i<8;i++){
      const a=i*2.39+variety,y=3.2+i*.65,l=.85+random()*1.55,c=cos(a),s=sin(a);
      wood.push(taperedPath([V(0,y,0),V(c*l*.4,y+.53,s*l*.45),V(c*l,y+1.18,s*l),V(c*l*1.38,y+2.35,s*l*1.28)], [.16,.145,.068,.012],6));
    }
    const placements=[];
    for(let i=0;i<24;i++){
      let x=(random()-.5)*48,z=-4-random()*24;
      if(i<6){x=(i%2?1:-1)*(5.1+random()*10);z=(random()-.5)*18;}
      const y=height(x,z),s=.77+random()*1.05;
      placements.push([x,y-.13,z,s,s*(.87+random()*.3),s,0,random()*PI*2,0]);
      crowns.push([x,y+8.7*s,z,s*3.5,s*2.2,s*4.1,0,random()*PI,0]);
      const center=V(x,y,z);obstacles.push({position:center,center,radius:.52*s});
    }
    instances(group,mergeParts(wood),bark,placements);
  }
  instances(group,rockVariant(random),crownMat,crowns);
  for(const [x,z,len,angle] of [[-5,-3,6,-.37],[4,-4.7,4,.24],[7,1,5,1.7]]){
    const a=V(x,height(x,z)+.3,z),b=V(x+len*cos(angle),0,z+len*sin(angle));
    b.y=height(b.x,b.z)+.38;
    const m=a.clone().lerp(b,.53);m.y+=.17;
    group.add(new THREE.Mesh(taperedPath([a,m,b],[.32,.35,.28],13),bark));
    const branch=m.clone().add(V(-.37,.8,.4));
    group.add(new THREE.Mesh(taperedPath([m,branch],[.13,.052],7),bark));
  }
  web(group,V(-4.3,2.36,-4.1),1.7,.15);
  web(group,V(4.6,1.92,-2.6),1.46,-.5);
  web(group,V(-2,3.9,-9.5),2.1,.4);
}

function particles(group,random,lake){
  const n=lake?1450:410, positions=[],seeds=[];
  for(let i=0;i<n;i++){positions.push((random()-.5)*46,random()*15-3,(random()-.55)*42);seeds.push(random());}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setAttribute('seed',new THREE.Float32BufferAttribute(seeds,1));
  const u={time:{value:0},tone:{value:color(lake?0x9bc5b5:0xc9ba86)},alpha:{value:lake?.56:.41}};
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:u,
    vertexShader:`attribute float seed;uniform float time;varying float a;void main(){
      vec3 q=position; q.x+=sin(time*.08+seed*26.)*.48;q.y+=sin(time*.12+seed*51.)*.26;
      vec4 mv=modelViewMatrix*vec4(q,1.);
      gl_Position=projectionMatrix*mv;gl_PointSize=clamp((.58+seed)*30./max(1.,-mv.z),1.,3.2);
      a=(.18+seed*.62)*smoothstep(.5,2.,-mv.z)*exp(-max(-mv.z,0.)*.038);
    }`,
    fragmentShader:`varying float a;uniform float alpha; uniform vec3 tone;void main(){
      float k=1.-smoothstep(.12,.5,length(gl_PointCoord-.5));gl_FragColor=vec4(tone,a*k*alpha);
      #include <colorspace_fragment>
    }`});
  const points=new THREE.Points(geo,m);points.frustumCulled=false;group.add(points);return u;
}

function backdrop(group,lake) {
  const uniforms={top:{value:color(lake?0x468382:0x596665)},low:{value:color(lake?0x123337:0x18291f)}};
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms,
    vertexShader:`varying vec3 dir;void main(){dir=position;vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=clip.xyww;}`,
    fragmentShader:`varying vec3 dir;uniform vec3 top;uniform vec3 low;
      ${noiseGLSL}
      void main(){vec3 d=normalize(dir);float light=smoothstep(-.37,1.,d.y);
        float clouds=landscapeNoise(d*5.)*.14+landscapeNoise(d*13.)*.05;
        vec3 col=mix(low,top,clamp(light*1.15+clouds-.04,0.,1.));
        col+=top*.43*pow(max(dot(d,normalize(vec3(-.6,1.,-.35))),0.),12.);
        gl_FragColor=vec4(col,1.);
        #include <colorspace_fragment>
      }`});
  const dome=new THREE.Mesh(new THREE.SphereGeometry(70,32,16),mat);
  dome.frustumCulled=false;dome.renderOrder=-100;group.add(dome);return uniforms;
}

function lightShafts(group,lake,clock) {
  // Three depth layers give the shafts parallax. The cross-section is a continuous
  // noise field, so the beam edges stay soft as the camera moves through them.
  const density={value:1};
  for(const [z,opacity] of [[-15,.18],[-6,.12],[1,.047]]){
    const uniforms={clock,density,opacity:{value:opacity*(lake?1:.67)},tint:{value:color(lake?0xa1d6bd:0xeddbab)}};
    const m=new THREE.ShaderMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,uniforms,blending:THREE.AdditiveBlending,
      vertexShader:`varying vec3 wp; varying vec2 tex;void main(){tex=uv;vec4 p=modelMatrix*vec4(position,1.); wp=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
      fragmentShader:`${noiseGLSL}
        varying vec3 wp;varying vec2 tex;uniform float clock;uniform float density;uniform float opacity;uniform vec3 tint;
        void main(){float column=wp.x+wp.y*.54;
          float n=landscapeNoise(vec3(column*.58,wp.z*.32,clock*.018));
          float m=landscapeNoise(vec3(column*2.5,wp.z,clock*.013));
          float rise=smoothstep(-5.,8.,wp.y);
          float fade=smoothstep(0.,.24,tex.x)*smoothstep(0.,.24,1.-tex.x)*smoothstep(0.,.16,tex.y)*smoothstep(0.,.12,1.-tex.y);
          float alpha=smoothstep(.45,.85,n)*(.3+.7*m)*(.34+rise*.85)*fade;
          gl_FragColor=vec4(tint,opacity*density*alpha);
          #include <colorspace_fragment>
        }`});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(65,26),m);mesh.position.set(-2,7,z);group.add(mesh);
  }
  return density;
}

function groundShadow(group,height,lake) {
  const m=new THREE.ShaderMaterial({transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,uniforms:{strength:{value:lake?.10:.26}},
    vertexShader:`varying vec2 tex;void main(){tex=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec2 tex;uniform float strength;void main(){vec2 p=(tex-.5)*2.;float falloff=1.-smoothstep(.65,1.,length(p));gl_FragColor=vec4(.003,.009,.008,strength*exp(-dot(p,p)*5.)*falloff);}`});
  const g=new THREE.PlaneGeometry(lake?16:6.1,lake?5:4.6,44,44);g.rotateX(-PI/2);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,height(p.getX(i),p.getZ(i))+.017);
  group.add(new THREE.Mesh(g,m));
}

// Equine foot and lip contacts sample the same triangles visible in the
// viewport. The analytic field between terrain vertices can differ by cm.
function triangleGroundHeight(mesh,outside){
  const {width,height,widthSegments:cols,heightSegments:rows}=mesh.geometry.parameters;
  const vertices=mesh.geometry.attributes.position;
  return (x,z)=>{
    const u=(x/width+.5)*cols,v=(z/height+.5)*rows;
    if(u<0||v<0||u>cols||v>rows)return outside(x,z);
    const col=Math.min(Math.floor(u),cols-1),row=Math.min(Math.floor(v),rows-1);
    const i=row*(cols+1)+col,dx=u-col,dz=v-row;
    // PlaneGeometry splits each cell between its +X and +Z corners.
    const east=vertices.getY(i+1),south=vertices.getY(i+cols+1);
    if(dx+dz<=1)return (1-dx-dz)*vertices.getY(i)+dx*east+dz*south;
    return (dx+dz-1)*vertices.getY(i+cols+2)+(1-dz)*east+(1-dx)*south;
  };
}

export function createHabitat(scene,kind) {
  const lake=kind==='squid'||kind==='merperson', group=new THREE.Group(), obstacles=[], clock={value:0};
  group.name=lake?'Great Lake habitat':'Forbidden Forest habitat';
  const random=randomSource(lake?4580:712039);
  const terrainHeight=(x,z)=>{
    if(lake||kind==='aragog')return layeredTerrain(x,z)+(lake?-3.65:0);
    return layeredTerrain(x,z)*Math.min(1,Math.max(0,Math.hypot(x,z)-2))-(kind==='owl'?.29:0);
  };
  const originalFog=scene.fog, originalBackground=scene.background;
  const fog=new THREE.FogExp2(lake?0x244b4d:0x2f3930,lake?.035:.047);
  scene.fog=fog;scene.background=color(lake?0x244b4d:0x2f3930);
  scene.add(group);
  const hemi=new THREE.HemisphereLight(lake?0xc3e4dc:0xe0e5dc,lake?0x476668:0x615442,1.25);
  const key=new THREE.DirectionalLight(lake?0xffddac:0xffdaac,3.2);
  key.position.set(-8,11,7);
  const rim=new THREE.DirectionalLight(lake?0x8bdfdc:0xa7b9ca,2.5);
  rim.position.set(4,6,-8);
  const fill=new THREE.DirectionalLight(lake?0xadd4d6:0xbcd2c9,.55);fill.position.set(2,1,8);
  group.add(hemi,key,rim,fill);
  const sky=backdrop(group,lake);
  const ground=terrainMesh(terrainHeight,surfaceMaterial(lake?0x62736a:0x645743,'soil',lake,clock));
  group.add(ground);
  const contactHeight=kind==='centaur'||kind==='unicorn'||kind==='hippogriff'?triangleGroundHeight(ground,terrainHeight):terrainHeight;
  addRocks(group,terrainHeight,random,lake,clock,obstacles);
  plants(group,terrainHeight,random,lake,clock);
  if(!lake)addForest(group,terrainHeight,random,clock,obstacles);
  if(kind==='owl'){
    const perch=new THREE.Mesh(new THREE.CylinderGeometry(.108,.13,1.14,14),new THREE.MeshStandardMaterial({color:0x675440,roughness:1}));
    perch.rotation.z=Math.PI/2-.04;perch.position.y=-.095;group.add(perch);
  }
  groundShadow(group,terrainHeight,lake);
  const shafts=lightShafts(group,lake,clock), motes=particles(group,random,lake);
  function setLighting(intensity=1,night=false){
    const n=night?.4:1;
    hemi.intensity=(lake?1.32:1.06)*intensity*(night?.62:1);
    key.intensity=(lake?3.05:2.75)*intensity*n;
    key.color.set(night?0xa5c6dd:0xffddae);
    if(!night){
      if(kind==='hippogriff')key.color.set(0xffedcf);
      if(kind==='unicorn')key.color.set(0xffe8bc);
      if(kind==='merperson')key.color.set(0xc1e1d6);
    }
    rim.intensity=(lake?2.3:1.85)*intensity*(night?.67:1);
    fill.intensity=.42*intensity;
    fog.color.set(lake?(night?0x112e36:0x315b5c):(night?0x17262b:0x394337));
    fog.density=lake?.035:.047;
    scene.background.copy(fog.color);
    sky.low.value.copy(fog.color).multiplyScalar(.66);
    sky.top.value.set(lake?0x60938b:0x69776b).multiplyScalar(n);
    shafts.value=n*min(1.6,intensity);
    motes.alpha.value=(lake?.56:.40)*(night?.68:1);
  }
  setLighting(1,false);
  let disposed=false;
  return {group,terrainHeight:contactHeight,obstacles,setLighting,update(dt,time){clock.value=time;motes.time.value=time;},dispose(){
    if(disposed)return;disposed=true;
    if(scene.fog===fog){scene.fog=originalFog;scene.background=originalBackground;}
    scene.remove(group);
    const geometries=new Set(),materials=new Set();
    group.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);if(o.isInstancedMesh)o.dispose();});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());group.clear();
  }};
}
