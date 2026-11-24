// The groom uses solid, fluted locks. All measurements are in the B.5 bind frame.
import * as T from '../vendor/three.module.js';
const tau=2*Math.PI;
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b);
const vec=(x,y,z)=>new T.Vector3(x,y,z);

// Each strip wraps once around a lock. Neighbouring strips can share a mesh
// while keeping independent tapers, pigments and normals.
function surface(){
  const xyz=[],colors=[],indices=[];
  function strip(rows,sides,sample){
    const first=xyz.length/3;
    for(let i=0;i<=rows;i++)for(let j=0;j<sides;j++){
      const [x,y,z,color]=sample(i/rows,j*tau/sides);
      xyz.push(x,y,z);colors.push(...color.toArray());
      if(i){
        const k=first+i*sides+j,n=first+i*sides+(j+1)%sides;
        indices.push(k-sides,k,n-sides,n-sides,k,n);
      }
    }
  }
  function finish(){
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
    g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }
  return {strip,finish};
}

const umber=new T.Color(0x372c28),ash=new T.Color(0x928b7f);
function pigment(light){return umber.clone().lerp(ash,Math.max(0,Math.min(1,light)));}

// Comb the crown into a displaced whorl. The front edge follows the temples,
// leaving the brow and ears exposed. The lower rear lengths hang off the nape.
function scalp(level){
  const mesh=surface(),rows=[43,30,20][level],sides=[192,136,88][level];
  const whorl=vec(-.23,.75,-.62).normalize();
  function comb(u,a,extra=0){
    const fore=Math.cos(a),side=Math.sin(a);
    const hairline=2.066+.106*fore+.024*side*side
      +.012*Math.exp(-((Math.abs(Math.atan2(side,fore))-.73)**2)/.055)
      +.002*Math.sin(9*a+.5)+.0015*Math.cos(17*a);
    const bottom=Math.acos(T.MathUtils.clamp((hairline-2.131)/.126,-.996,.995));
    const start=vec(Math.sin(bottom)*side,Math.cos(bottom),Math.sin(bottom)*fore);
    const arc=Math.acos(T.MathUtils.clamp(start.dot(whorl),-.999,.999));
    const dir=start.multiplyScalar(Math.sin((1-u)*arc)).addScaledVector(whorl,Math.sin(u*arc)).divideScalar(Math.sin(arc));
    const ripple=.5+.5*Math.cos(76*a+2.4*Math.sin(11*a)+2*Math.sin(7*u+3*a));
    const wave=.5+.5*Math.cos(25*a+1.3*Math.sin(7*a)+2.8*u);
    const relief=(.0025*wave+.0009*ripple+extra)*(1-smooth(.85,1,u));
    const back=(1-smooth(-.66,.09,fore))*(1-smooth(.03,.59,u));
    const shape=x=>Math.sign(x)*Math.abs(x)**.94;
    const x=(.091+relief)*shape(dir.x);
    const z=.731+(.119+relief)*shape(dir.z)-.054*back;
    const y=2.131+(.127+relief)*dir.y-.044*back;
    const silver=(.07+.38*Math.abs(side)**5)*(1-smooth(.05,.85,u));
    return [x,y,z,pigment(.065+.14*wave+.08*ripple+silver*(.25+.75*ripple))];
  }
  mesh.strip(rows,sides,comb);
  // Shingled, tapered locks break up the hairline and curl back over the
  // ear. Each lock follows the same comb field as the underlying crown.
  for(let k=0;k<36;k++){
    const root=tau*(k+.14*Math.sin(5*k))/36,back=(1-Math.cos(root))/2;
    const finish=.49+.36*(.5+.5*Math.sin(2.37*k));
    const reach=.002+.057*back+.004*Math.sin(1.4*k)**2;
    mesh.strip([25,19,12][level],[12,9,7][level],(t,b)=>{
      const flare=Math.sin(Math.PI*t)**.82;
      const u=-reach+(finish+reach)*t;
      const a=root+.075*(1-t)**2+.043*Math.sin(5*t+root)*flare+.109*Math.cos(b)*flare;
      const q=comb(u,a,(.0013+.0009*Math.sin(b))*flare);
      q[3].lerp(ash,(.025+.13*(k%7===0))*(.5+.5*Math.sin(b))*flare);
      return q;
    });
  }
  // Longer lengths sweep behind the temples and overlap at the nape.
  for(const sign of [-1,1])for(let k=0;k<8;k++){
    const f=k/7,offset=sign*(.004*Math.sin(k*2.1));
    const path=new T.CatmullRomCurve3([
      vec(sign*(.074-.020*f),2.181+.033*f,.765-.053*f),
      vec(sign*(.088-.014*f),2.146+.027*f,.733-.071*f),
      vec(sign*(.091-.022*f),2.094+.026*f,.695-.069*f),
      vec(sign*(.078-.034*f),2.042+.012*f,.654-.047*f),
      vec(sign*(.060-.042*f)+offset,1.979+.012*Math.cos(3*k),.626-.029*f),
      vec(sign*(.052-.034*f)+offset,1.952+.021*Math.cos(2*k),.620-.026*f)
    ]);
    mesh.strip([26,19,12][level],[16,12,8][level],(t,b)=>{
      const point=path.getPoint(t),axis=path.getTangent(t);
      const out=vec(sign,0,-.48).addScaledVector(axis,-vec(sign,0,-.48).dot(axis)).normalize();
      const across=out.clone().cross(axis).normalize();
      const fade=Math.sin(Math.PI*t)**.68,flute=.5+.5*Math.cos(6*b+t*3);
      point.addScaledVector(across,(.010+.002*Math.sin(k))*fade*Math.cos(b));
      point.addScaledVector(out,.0043*fade*(.82+.18*flute)*Math.sin(b));
      return [point.x,point.y,point.z,pigment(.09+.13*flute+.12*(k===1||k===4))];
    });
  }
  return mesh.finish().translate(0,-2.003,-.712);
}

function tailGeometry(level,chain){
  const mesh=surface(),rows=[40,28,19][level],sides=[24,16,11][level];
  const path=new T.CatmullRomCurve3([
    vec(0,1.355,-.753),vec(.004,1.295,-.842),vec(.010,1.125,-.892),
    vec(.019,.88,-.903),vec(.030,.64,-.934),vec(.058,.435,-.984),vec(.047,.27,-1.055)
  ]);
  function lock(index,count){
    const core=index<0,theta=core?0:index*tau/count;
    const length=core?.975:.86+.13*(.5+.5*Math.sin(2.4*index+.4));
    mesh.strip(rows,core?2*sides:sides,(u,a)=>{
      const t=u*length,p=path.getPoint(t),tangent=path.getTangent(t);
      const across=vec(1,0,0),depth=tangent.clone().cross(across).normalize();
      across.copy(depth).cross(tangent).normalize();
      const spread=.019+.060*smooth(0,.22,t)+.011*Math.sin(Math.PI*t);
      const feather=1-smooth(.58,1,u),twist=theta+.75*t+.32*Math.sin(6*t+theta);
      const envelope=Math.pow(Math.max(.001,1-u**3),.73);
      const ripple=.5+.5*Math.cos((core?16:5)*a+.8*Math.sin(5*t+theta));
      const radius=(core?1.03:.46+.06*Math.sin(theta))*spread*envelope*(.91+.09*ripple);
      const radial=core?0:spread*(.37+.37*feather)*Math.min(1,t*10+.35);
      p.addScaledVector(across,Math.cos(twist)*radial+Math.cos(a)*radius);
      p.addScaledVector(depth,.77*(Math.sin(twist)*radial+Math.sin(a)*radius));
      return [p.x,p.y,p.z,pigment(.045+.09*ripple+.055*Math.cos(theta)+.09*t)];
    });
  }
  lock(-1,18);
  for(let i=0;i<18;i++)lock(i,18);
  const geo=mesh.finish(),p=geo.attributes.position,ids=[],weights=[];
  const heights=[1.34,1.11,.82,.53,.30];
  for(let i=0;i<p.count;i++){
    const h=p.getY(i);let k=0;
    while(k<heights.length-2&&h<heights[k+1])k++;
    const w=smooth(heights[k+1],heights[k],h);
    ids.push(chain[k].userData.index,chain[k+1].userData.index,0,0);
    weights.push(w,1-w,0,0);
  }
  geo.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));
  geo.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));return geo;
}

export function groomCentaur(actor,base){
  const hair=actor.mesh(actor.head,0xffffff,scalp);
  hair.material.vertexColors=true;
  const tail=actor.mesh(base,0xffffff,l=>tailGeometry(l,actor.tailChain),T.SkinnedMesh);
  tail.bind(actor.skeleton);tail.frustumCulled=false;
  addFaceDetails(actor);
}

// Conform pigment to the approved orbital and brow surfaces. Sampling the
// anterior triangle intersections retains the original eyelid relief.
function addFaceDetails(actor){
  const skin=actor.parts[0].mesh.geometry,tri=skin.index.array,pos=skin.attributes.position;
  const bins=new Map();
  const cell=x=>Math.floor(x/.005),key=(i,j)=>i+128*j;
  for(let i=0;i<tri.length;i+=3){
    const j=tri[i],y=pos.getY(j);
    if(y<2.102||y>2.149||pos.getZ(j)<.785)continue;
    const face=[j,tri[i+1],tri[i+2]].map(k=>new T.Vector3().fromBufferAttribute(pos,k));
    const xs=face.map(p=>cell(p.x)),ys=face.map(p=>cell(p.y));
    for(let x=Math.min(...xs);x<=Math.max(...xs);x++)for(let h=Math.min(...ys);h<=Math.max(...ys);h++){
      const id=key(x,h);if(!bins.has(id))bins.set(id,[]);bins.get(id).push(face);
    }
  }
  const ray=new T.Ray(vec(0,0,.9),vec(0,0,-1)),hit=vec(0,0,0);
  function depth(x,y){
    ray.origin.set(x,y,.9);let z=0;
    for(const [a,b,c] of bins.get(key(cell(x),cell(y)))||[])if(ray.intersectTriangle(a,b,c,false,hit))z=Math.max(z,hit.z);
    // At the outermost row the socket may lie beyond the sampled triangles.
    // Continue below the skin at the local orbital plane in that case.
    const q=(Math.abs(x)-.032)/.014;
    return z||(.819-.0036*q-.0022*q*q+.19*(y-2.119));
  }
  function patch(color,point,n,m){
    actor.mesh(actor.head,color,()=>{
      const xyz=[],idx=[];
      for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){
        const [x,y,z]=point(i/n,j/m);
        xyz.push(x,y-2.003,(z??depth(x,y)+.00038)-.712);
        if(i&&j){const k=i*(m+1)+j;idx.push(k-m-2,k-1,k,k-m-2,k,k-m-1);}
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
      g.setIndex(idx);g.computeVertexNormals();return g;
    });
  }
  for(const sign of [-1,1]){
    patch(0x60554c,(u,v)=>{
      const x=.012+.050*u;
      const width=.00245*Math.sin(Math.PI*u)**.54*(1+.12*Math.cos(28*u));
      const y=2.1315+.0045*Math.sin(Math.PI*u)-.002*u+(sign>0?.001:0);
      return [x*sign,y+(2*v-1)*width];
    },28,4);
    const margin=(q,upper)=>{
      const arc=Math.max(0,1-q*q);
      return 2.119+.0011*q+(upper?.0045:-.0031)*arc;
    };
    const cornea=(q,y)=>.8234-.0036*q-.0022*q*q+.19*(y-2.119);
    const eyeX=q=>sign*(.032+.014*q);
    patch(0xb5afa3,(u,v)=>{
      const q=u*2-1,y=T.MathUtils.lerp(margin(q,false),margin(q,true),v);
      return [eyeX(q),y,cornea(q,y)];
    },32,8);
    for(const [radius,color] of [[.0055,0x625d4e],[.0022,0x33312c]]){
      patch(color,(u,v)=>{
        const a=tau*u,q=radius*v*Math.cos(a)/.014;
        const y=T.MathUtils.clamp(2.120+radius*v*Math.sin(a),margin(q,false),margin(q,true));
        return [eyeX(q),y,cornea(q,y)+(radius<.003?.00026:.00013)];
      },32,6);
    }
    for(const upper of [true,false]){
      patch(0xa8a197,(u,v)=>{
        const q=(u*2-1)*1.85,x=eyeX(q),edge=margin(T.MathUtils.clamp(q,-1,1),upper);
        const y=T.MathUtils.lerp(edge,upper?2.139:2.101,v);
        const distance=Math.abs(y-edge),orbital=1-smooth(1,1.85,Math.abs(q));
        const falloff=orbital*(1-smooth(.003,upper?.015:.014,distance));
        const fold=.00095*Math.exp(-((distance-.0017)**2)/.000008)
          -(upper?.0005:0)*Math.exp(-((distance-.006)**2)/.000006);
        const original=depth(x,y);
        // Bury the patch boundary in the original skin. Through the lid
        // margin its tangent continues the cornea, with a shallow rolled edge.
        const z=T.MathUtils.lerp(original-.00025,cornea(q,y)+fold+.00018,falloff);
        return [x,y,z];
      },54,24);
    }
  }
}
