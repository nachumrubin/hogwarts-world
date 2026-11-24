// The groom uses solid, fluted locks. All measurements are in the B.5 bind frame.
import * as T from '../vendor/three.module.js';
import {finishMaterial} from './centaur-finish.js';
const tau=2*Math.PI;
const smooth=(a,b,x)=>T.MathUtils.smoothstep(x,a,b);
const vec=(x,y,z)=>new T.Vector3(x,y,z);

// Each strip wraps once around a lock. Neighbouring strips can share a mesh
// while keeping independent tapers, pigments and normals.
function surface(){
  const xyz=[],colors=[],indices=[],uv=[];
  function strip(rows,sides,sample,repeat=1,edge=false){
    const first=xyz.length/3;
    for(let i=0;i<=rows;i++)for(let j=0;j<sides;j++){
      const [x,y,z,color]=sample(i/rows,j*tau/sides);
      uv.push(j/sides*repeat,edge?-1-i/rows:i/rows);xyz.push(x,y,z);colors.push(...color.toArray());
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
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex(indices);g.computeVertexNormals();return g;
  }
  return {strip,finish};
}

const umber=new T.Color(0x211710),ash=new T.Color(0x6b5242);
function pigment(light){return umber.clone().lerp(ash,Math.max(0,Math.min(1,light)));}

// Comb the crown into a displaced whorl. The front edge follows the temples,
// leaving the brow and ears exposed. The lower rear lengths hang off the nape.
function scalp(level){
  const mesh=surface(),rows=[43,30,20][level],sides=[192,136,88][level];

  function comb(u,a,extra=0){
    const fore=Math.cos(a),side=Math.sin(a);
    const hairline=2.067+.114*fore+.019*side*side
      +.013*Math.exp(-((Math.abs(Math.atan2(side,fore))-.60)**2)/.075)
      +.002*Math.sin(9*a+.5)+.0015*Math.cos(17*a)+.004*Math.sin(a*2.7)*fore;
    const bottom=Math.acos(T.MathUtils.clamp((hairline-2.131)/.126,-.996,.995));
    const start=vec(Math.sin(bottom)*side,Math.cos(bottom),Math.sin(bottom)*fore);
    const whorl=vec(-.19+.035*fore,.89,.82*fore-.10).normalize();
    const arc=Math.acos(T.MathUtils.clamp(start.dot(whorl),-.999,.999));
    const dir=start.multiplyScalar(Math.sin((1-u)*arc)).addScaledVector(whorl,Math.sin(u*arc)).divideScalar(Math.sin(arc));
    const sweepAngle=.29*Math.sin(Math.PI*u)*(.68+.32*fore);
    dir.applyAxisAngle(vec(0,1,0),sweepAngle);
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
  mesh.strip(rows,sides,comb,6,true);
  // Shingled, tapered locks break up the hairline and curl back over the
  // ear. Each lock follows the same comb field as the underlying crown.
  for(let k=0;k<69;k++){
    const root=tau*(k+.14*Math.sin(5*k))/69,back=(1-Math.cos(root))/2;
    const finish=.49+.36*(.5+.5*Math.sin(2.37*k));
    const reach=.003+.041*back+.014*Math.sin(1.4*k)**4;
    mesh.strip([25,19,12][level],[12,9,7][level],(t,b)=>{
      const flare=Math.sin(Math.PI*t)**.82;
      const u=-reach+(finish+reach)*t;
      const a=root+.11*(1-t)**2+.043*Math.sin(5*t+root)*flare+.055*Math.cos(b)*flare;
      const q=comb(u,a,(.0009+.0005*Math.sin(b))*flare);
      q[3].lerp(ash,(.025+.13*(k%7===0))*(.5+.5*Math.sin(b))*flare);
      return q;
    },1,true);
  }
  // Tapered flyaways lift off the combed surface and soften its outer edge.
  for(let j=0;j<[220,108,44][level];j++){
    const a=j*2.39996,len=.19+.54*(.5+.5*Math.sin(j*11.7));
    mesh.strip([20,14,9][level],4,(t,b)=>{
      const u=.002-.023*(1-Math.cos(a))*.5+len*t;
      const spread=.0022*Math.sin(Math.PI*t)+.00038*Math.sin(b);
      const q=comb(u,a+.065*(1-t)**2+.033*Math.sin(4*t+a)+.003*Math.cos(b)*Math.sin(Math.PI*t),spread);
      q[3]=pigment(.032+.22*(.5+.5*Math.cos(j*1.7)));
      return q;
    },.1);
  }
  // Longer lengths sweep behind the temples and overlap at the nape.
  for(const sign of [-1,1]){
    const count=[42,29,18][level];
    for(let k=0;k<count;k++){
      const f=(k+.38*Math.sin(3*k))/count,phase=k*2.399+sign*.78;
      const front=f<.31,short=k%6===0;
      const end=1.79+.085*Math.sin(phase)+.063*(short?1:0);
      const sweep=front?.868+.012*Math.cos(phase):.515+.072*f;
      const path=new T.CatmullRomCurve3([
        vec(sign*(.073-.021*f),2.191+.025*f,.775-.080*f),
        vec(sign*(.086-.011*f),2.145+.014*f,.753-.092*f),
        vec(sign*(.093-.015*f),2.075+.016*f,.729-.117*f),
        vec(sign*(.103-.054*f),2.015,.697-.100*f),
        vec(sign*(.126-.082*f),1.953,front?.731:.581+.018*Math.cos(phase)),
        vec(sign*(.153-.085*f),1.905,front?.813:.534+.019*f),
        vec(sign*(.144-.076*f)+.012*Math.cos(phase),end,sweep)
      ]);
      const sample=(t,b,thin=false)=>{
        const point=path.getPoint(t),axis=path.getTangent(t);
        const out=vec(sign,0,-.42);out.addScaledVector(axis,-out.dot(axis)).normalize();
        const across=out.clone().cross(axis).normalize();
        const fade=Math.sin(Math.PI*t)**.73;
        const curl=(.006+.015*f)*Math.sin(11*t+phase)*Math.sin(Math.PI*t);
        point.addScaledVector(across,curl);point.addScaledVector(out,.005*Math.sin(11*t+phase)*fade);
        const radius=thin?.00048:(.008+.004*Math.sin(phase))*(1-.30*t);
        point.addScaledVector(across,radius*fade*Math.cos(b));
        point.addScaledVector(out,(thin?radius:radius*.71)*fade*Math.sin(b));
        return [point.x,point.y,point.z,pigment(.015+.18*(.5+.5*Math.cos(phase))+.055*Math.cos(5*b+3*t))];
      };
      mesh.strip([30,22,14][level],[12,9,7][level],sample,.52);
      if(level!==2)mesh.strip([25,16][level],4,(t,b)=>{
        const q=sample(t,b,true);q[0]+=sign*(.004+.010*Math.sin(Math.PI*t));q[2]+=.006*Math.sin(9*t+phase);
        return q;
      },.1);
    }
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
  hair.name='Scalp and shoulder-length locks';
  hair.material.vertexColors=true;finishMaterial(hair.material,'hair',actor.gaze);
  const tail=actor.mesh(base,0xffffff,l=>tailGeometry(l,actor.tailChain),T.SkinnedMesh);
  tail.bind(actor.skeleton);tail.frustumCulled=false;
  actor.mesh(actor.head,0xffffff,l=>beardGeometry(actor,l));
  addFaceDetails(actor);
}

// Sample the original chin and cheek triangles by area so density remains
// independent of triangulation. Bristles emerge along the jaw's growth field.
function beardGeometry(actor,level){
  const skin=actor.parts[0].mesh.geometry,idx=skin.index.array,p=skin.attributes.position;
  const n=skin.attributes.normal,triangles=[];
  let total=0,seed=19417;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const at=i=>new T.Vector3().fromBufferAttribute(p,i);
  for(let i=0;i<idx.length;i+=3){
    const first=idx[i],h=p.getY(first);
    if(h<1.995||h>2.108||p.getZ(first)<.712)continue;
    const a=at(first);
    const b=at(idx[i+1]),c=at(idx[i+2]),center=a.clone().add(b).add(c).multiplyScalar(1/3);
    const x=Math.abs(center.x),y=center.y;
    const lip=1-smooth(.003,.008,Math.abs(y-2.046));
    const jaw=(1-smooth(2.026+.74*x,2.035+.74*x,y))*smooth(1.997,2.016,y);
    const moustache=Math.exp(-((y-2.057)**2)/.000025)*(1-smooth(.017,.032,x));
    const density=(jaw*(1-lip*(1-smooth(.020,.033,x)))+moustache)*smooth(.722,.762,center.z);
    if(density<.015)continue;
    total+=b.clone().sub(a).cross(c.clone().sub(a)).length()*.5*density;
    triangles.push({a,b,c,total,normal:new T.Vector3().fromBufferAttribute(n,idx[i]).normalize()});
  }
  const mesh=surface();
  for(let i=0;i<[4300,1550,330][level];i++){
    const pick=random()*total;let l=0,r=triangles.length-1;
    while(l<r){const mid=(l+r)>>1;if(triangles[mid].total<pick)l=mid+1;else r=mid;}
    const {a,b,c,normal}=triangles[l];
    const u=Math.sqrt(random()),v=random();
    const root=a.clone().multiplyScalar(1-u).addScaledVector(b,u*(1-v)).addScaledVector(c,u*v);
    const moustache=root.y>2.048&&Math.abs(root.x)<.029;
    const growth=vec(moustache?Math.sign(root.x)*.74:-root.x*2.2,-.88,-.06)
      .addScaledVector(normal,.52+.53*random()).normalize();
    const length=(.0025+.0058*random())*(moustache?.74:1);
    const shade=pigment(random()<.12?.35+random()*.31:.018+random()*.16);
    mesh.strip(2,3,(t,beta)=>{
      const q=root.clone().addScaledVector(normal,-.00045).addScaledVector(growth,length*t);
      const rad=.00024*(1-.97*t);q.x+=Math.cos(beta)*rad;q.z+=Math.sin(beta)*rad;
      return [q.x,q.y,q.z,shade];
    });
  }
  return mesh.finish().translate(0,-2.003,-.712);
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
  function patch(color,point,n,m,closed){
    return actor.mesh(actor.head,color,()=>{
      const xyz=[],idx=[],uv=[],blink=[];
      for(let i=0;i<=n;i++)for(let j=0;j<=m;j++){
        const [x,y,z]=point(i/n,j/m);
        uv.push(i/n,j/m);
        if(closed){const [cy,cz]=closed(i/n,j/m,x,y,z);blink.push(x,cy-2.003,cz-.712);}
        xyz.push(x,y-2.003,(z??depth(x,y)+.00038)-.712);
        if(i&&j){const k=i*(m+1)+j;idx.push(k-m-2,k-1,k,k-m-2,k,k-m-1);}
      }
      const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
      g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
      if(closed)g.morphAttributes.position=[new T.Float32BufferAttribute(blink,3)];
      g.setIndex(idx);g.computeVertexNormals();return g;
    });
  }
  for(const sign of [-1,1]){
    const brow=patch(0x60554c,(u,v)=>{
      const x=.012+.050*u;
      const width=.00195*Math.sin(Math.PI*u)**.54*(1+.12*Math.cos(28*u));
      const y=2.1315+.0045*Math.sin(Math.PI*u)-.002*u+(sign>0?.001:0);
      return [x*sign,y+(2*v-1)*width];
    },28,4);
    actor.brows.push(brow);finishMaterial(brow.material,'brow',actor.gaze);
    const browHairs=actor.mesh(actor.head,0xffffff,level=>{
      const mesh=surface(),count=[92,48,18][level];
      for(let j=0;j<count;j++){
        const u=(j+.5)/count,x=.012+.050*u;
        const yc=2.1315+.0045*Math.sin(Math.PI*u)-.002*u+(sign>0?.001:0);
        const y=yc+.0024*Math.sin(2.4*j)*Math.sin(Math.PI*u);
        mesh.strip(3,3,(t,b)=>{
          const bx=sign*(x+.0031*t),by=y+.0022*t*(1-u)+.00055*Math.sin(Math.PI*t);
          return [bx,by-2.003+.00019*(1-t)*Math.cos(b),depth(bx,by)-.712+.00055+.0002*Math.sin(b),
            pigment(.025+.13*(.5+.5*Math.cos(j*3.1)))];
        });
      }
      return mesh.finish();
    });
    actor.brows.push(browHairs);
    const margin=(q,upper)=>{
      const arc=Math.max(0,1-q*q);
      return 2.119+.0011*q+(upper?.00365:-.0030)*arc;
    };
    const cornea=(q,y)=>.8234-.0036*q-.0022*q*q+.19*(y-2.119)+.0008*(1-Math.min(1,q*q));
    const eyeX=q=>sign*(.032+.014*q);
    const eye=patch(0xb5afa3,(u,v)=>{
      const q=u*2-1,y=T.MathUtils.lerp(margin(q,false),margin(q,true),v);
      return [eyeX(q),y,cornea(q,y)];
    },32,8);
    finishMaterial(eye.material,'eye',actor.gaze);
    for(const upper of [true,false]){
      const lid=patch(0xb18a70,(u,v)=>{
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
      },54,24,(u,v,x,y,z)=>{
        const q=(u*2-1)*1.85,arc=Math.max(0,1-q*q);
        const dy=(upper?-.0054:.00135)*arc*(1-v)**1.65;
        return [y+dy,z+.0012*arc*(1-v)];
      });
      actor.lids.push(lid);finishMaterial(lid.material,'lid',actor.gaze);
      // Individual tapered lashes travel with the lid margin during a blink.
      const lashes=actor.mesh(actor.head,0x33231c,level=>{
        const xyz=[],closed=[],indices=[],count=[30,20,12][level];
        for(let j=0;j<count;j++){
          const q=-.84+1.77*(j+.28*Math.sin(j*4.7))/(count-1),x=eyeX(q),y=margin(q,upper),z=cornea(q,y)+.0006;
          const length=(upper?.0041:.0021)*(.78+.25*Math.cos(3.77*j)+.19*q);
          const dy=(upper?-.0054:.00135)*Math.max(0,1-q*q);
          const base=xyz.length/3;
          for(let k=0;k<4;k++)for(let h=0;h<3;h++){
            const t=k/3,b=tau*h/3,r=.00021*(1-.98*t);
            const px=x+sign*length*t*(.25+.58*q+.15*Math.cos(2.83*j))+r*Math.cos(b);
            const py=y+(upper?1:-1)*length*t*t+r*Math.sin(b)-2.003,pz=z+length*t*.62-.712;
            xyz.push(px,py,pz);closed.push(px,py+dy,pz+.0012*(1-q*q));
            if(k){const n=base+k*3+h,m=base+k*3+(h+1)%3;indices.push(n-3,m-3,n,m-3,m,n);}
          }
        }
        const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(xyz,3));
        g.morphAttributes.position=[new T.Float32BufferAttribute(closed,3)];g.setIndex(indices);g.computeVertexNormals();return g;
      });
      actor.lids.push(lashes);
    }
  }
}
