import * as T from '../vendor/three.module.js';
import {smoothSections, sweep} from './form.js';

const TAU = 2 * Math.PI;
const clamp = T.MathUtils.clamp;
const mix = T.MathUtils.lerp;
const V = (x, y, z) => new T.Vector3(x, y, z);
const bell = (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
const skin = new T.Color(0x708580);
const pale = new T.Color(0xa4a08a);
const flank = new T.Color(0x335d57);
const lip = new T.Color(0x715d58);
const finBase = new T.Color(0x38574f);
const finEdge = new T.Color(0x697c65);

// Tail tip to neck, in metres relative to the swimming pivot. The upper
// three chest rings form both shoulder openings in the same indexed surface.
export const tailPivots = [
  [0,-.27,-.31], [0,-.42,-.62], [0,-.49,-.97],
  [0,-.50,-1.33], [0,-.48,-1.64], [0,-.45,-1.91]
];
const tailBlendStations=[-.23,...tailPivots.map(p=>p[2])];
export const headPivot = [0,.555,.253];
const bodySections = [
  [0,-.45,-1.94,.027,.059], [0,-.47,-1.79,.036,.083],
  [0,-.49,-1.62,.053,.118], [0,-.50,-1.41,.083,.143],
  [0,-.50,-1.18,.122,.160], [0,-.49,-.98,.163,.177],
  [0,-.45,-.78,.195,.201], [0,-.38,-.60,.218,.225],
  [0,-.30,-.44,.227,.239], [0,-.23,-.30,.224,.230],
  [0,-.15,-.18,.226,.204], [0,-.06,-.079,.234,.193],
  [0,.05,.015,.249,.196], [0,.145,.084,.286,.213],
  [0,.227,.109,.333,.219], [0,.344,.131,.384,.198],
  [0,.432,.158,.363,.162], [0,.492,.183,.271,.131],
  [0,.515,.210,.133,.106], [0,.565,.241,.106,.101],
  [0,.625,.249,.106,.100]
];

export const armPivots = [
  [.334,.355,.150], [.518,.066,.081], [.591,-.133,.253]
];
const armSections = [
  [.386,.340,.143,.114,.117], [.421,.267,.115,.109,.110],
  [.465,.183,.089,.097,.087], [.502,.112,.072,.076,.072],
  [.518,.066,.081,.071,.066], [.540,.023,.108,.078,.073],
  [.562,-.042,.147,.073,.065], [.580,-.093,.206,.053,.048],
  [.591,-.133,.253,.040,.033], [.606,-.162,.277,.052,.027],
  [.615,-.199,.319,.063,.027], [.617,-.223,.346,.055,.022],
  [.618,-.232,.355,.039,.016]
];

function surface() {
  return {position:[], index:[], color:[], joints:[], weights:[]};
}

function point(mesh, x, y, z, color, first=0, second=first, blend=0) {
  const index = mesh.position.length / 3;
  mesh.position.push(x,y,z);
  mesh.color.push(color.r,color.g,color.b);
  mesh.joints.push(first,second,0,0);
  mesh.weights.push(1-blend,blend,0,0);
  return index;
}

function strip(mesh, a, b, reverse=false) {
  for (let i=0;i<a.length;i++) {
    const next=(i+1)%a.length;
    if (reverse) mesh.index.push(a[next],a[i],b[i],b[next],a[next],b[i]);
    else mesh.index.push(a[i],a[next],b[i],a[next],b[next],b[i]);
  }
}

function cap(mesh, ring, reverse=false) {
  for(let i=1;i<ring.length-1;i++) {
    if (reverse) mesh.index.push(ring[0],ring[i+1],ring[i]);
    else mesh.index.push(ring[0],ring[i],ring[i+1]);
  }
}

function geometry(mesh, skinned=false) {
  // Shoulder cutouts leave interior grid vertices unused. Compact before upload.
  const remap=new Map(), positions=[], colors=[], joints=[], weights=[];
  const index=mesh.index.map(vertex=>{
    if (remap.has(vertex)) return remap.get(vertex);
    const next=positions.length/3;
    remap.set(vertex,next);
    for (let c=0;c<3;c++) {
      positions.push(mesh.position[vertex*3+c]);
      colors.push(mesh.color[vertex*3+c]);
    }
    if (skinned) for (let c=0;c<4;c++) {
      joints.push(mesh.joints[vertex*4+c]);
      weights.push(mesh.weights[vertex*4+c]);
    }
    return next;
  });
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  if(skinned) {
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(joints,4));
    g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
  }
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function complexion(x,y,z,front,tail=false) {
  const freckle=.5+.5*Math.sin(x*73+y*53)*Math.sin(z*69-y*22);
  const mottling=.5+.5*Math.sin(x*22+y*17+z*13)*Math.sin(y*31-z*17);
  const dark=tail?.62:.17;
  return skin.clone().lerp(flank,clamp(dark*(1-front)+.12*mottling,0,1))
    .lerp(pale,front*(tail?.23:.49)).multiplyScalar(.94+.09*mottling+.05*freckle);
}

export function torsoGeometry(level) {
  const result=surface();
  const sides=[48,24,16][level];
  const chestStart=14, chestEnd=16;
  const lower=smoothSections(bodySections.slice(0,chestStart+1),[3,2,1][level]);
  const mid=smoothSections(bodySections.slice(chestStart,chestEnd+1),[3,2,1][level]);
  const upper=smoothSections(bodySections.slice(chestEnd),[3,2,1][level]);
  const rows=[...lower,...mid.slice(1,-1),...upper];
  const portRow=lower.length-1, portHeight=mid.length-1;
  const portRadius=sides/8;
  const rings=rows.map(([cx,cy,cz,rx,rz],i)=>{
    const tilt=.065+.932*T.MathUtils.smoothstep(-cz,-.16,1.17);
    const depthZ=-Math.sqrt(1-tilt*tilt);
    const ring=[];
    for(let j=0;j<sides;j++) {
      const theta=j*TAU/sides;
      const x=rx*Math.cos(theta), front=Math.max(0,-Math.sin(theta));
      const ax=Math.abs(x);
      const pec=bell(ax,cy,.167,.313,.127,.086);
      const clavicle=bell(ax,cy,.152,.402+.12*ax,.141,.024);
      const sternum=bell(ax,cy,0,.308,.040,.154);
      const belly=bell(ax,cy,.065,-.022,.072,.160);
      const abdomen=(.64+.36*Math.cos(53*(cy+.017)))*.014*belly;
      const ribs=.014*bell(ax,cy,.194,.102,.080,.115);
      const scapula=.024*bell(ax,cy,.198,.338,.116,.099);
      const d=rz*Math.sin(theta)-front**2*(.055*pec+.019*clavicle+.009*sternum+abdomen+ribs)
        +Math.max(0,Math.sin(theta))**2*scapula;
      const y=cy+d*tilt, z=cz+d*depthZ;
      const scales=T.MathUtils.smoothstep(-cz,.21,.58)*Math.abs(Math.cos(theta));
      const row=Math.round((-cz-.3)*29);
      const tile=.5+.5*Math.cos(theta*22+Math.PI*(row%2));
      const scaleShade=(.5+.5*Math.cos((-cz-.3)*29*TAU))**2*tile;
      const scaleVariation=level===0?1:level===1?.53:.16;
      const c=complexion(x,y,z,front,cz<-.29)
        .multiplyScalar(1+scales*scaleVariation*(.14*scaleShade+.045*Math.sin(row*7.2+j*4.7)-.047));
      const side=x<0?0:1;
      let first=0, second=0, blend=0;
      if(cz<-.23) {
        const chain=tailBlendStations;
        for(let k=0;k<chain.length-1;k++) {
          first=k===0?0:1+k;
          second=2+k;
          blend=clamp((chain[k]-cz)/(chain[k]-chain[k+1]),0,1);
          if(cz>=chain[k+1]) break;
        }
      } else if(cy>.485 && ax<.15) {
        second=1;
        blend=.78*clamp((cy-.485)/.135,0,1);
      } else if(i>=portRow && i<=portRow+portHeight) {
        second=8+side*3;
        blend=.55*clamp((Math.abs(Math.cos(theta))-.53)/.47,0,1);
      }
      ring.push(point(result,cx+x,y,z,c,first,second,blend));
    }
    return ring;
  });

  for(let i=1;i<rings.length;i++) for(let j=0;j<sides;j++) {
    if(i>portRow && i<=portRow+portHeight) {
      if(j<portRadius || j>=sides-portRadius ||
          (j>=sides/2-portRadius && j<sides/2+portRadius)) continue;
    }
    const n=(j+1)%sides;
    result.index.push(rings[i-1][j],rings[i-1][n],rings[i][j],rings[i-1][n],rings[i][n],rings[i][j]);
  }
  cap(result,rings[0],true);
  cap(result,rings.at(-1));

  for(const [side,sign] of [-1,1].entries()) {
    const center=sign===1?0:sides/2;
    const start=center-portRadius,end=center+portRadius;
    const at=(i,j)=>rings[portRow+i][(j+sides)%sides];
    const port=[];
    for(let j=start;j<=end;j++) port.push(at(0,j));
    for(let i=1;i<portHeight;i++) port.push(at(i,end));
    for(let j=end;j>=start;j--) port.push(at(portHeight,j));
    for(let i=portHeight-1;i>0;i--) port.push(at(i,start));
    const sections=smoothSections(armSections,[2,1,1][level]);
    const anchor=V(sign*.333,.34,.145);
    const p=port.map(i=>V(...result.position.slice(i*3,i*3+3)).sub(anchor));
    const d=V(sign*.54,-.8,-.2).normalize();
    const u=V(1,0,0).addScaledVector(d,-d.x).normalize();
    const v=d.clone().cross(u);
    const phase=Math.atan2(p[0].dot(v),p[0].dot(u));
    const orientation=p.reduce((sum,current,i)=>sum+current.clone().cross(p[(i+1)%p.length]).dot(d),0)<0?-1:1;
    const ringAngles=p.map((offset,j)=>{
      const expected=phase+orientation*TAU*j/port.length;
      let angle=Math.atan2(offset.dot(v),offset.dot(u));
      angle+=TAU*Math.round((expected-angle)/TAU);
      return mix(expected,angle,.47);
    });
    let previous=port;
    for(const [i,[x,y,z,width,depth]] of sections.entries()) {
      const aa=sections[Math.max(0,i-1)],bb=sections[Math.min(sections.length-1,i+1)];
      const tangent=V(sign*(bb[0]-aa[0]),bb[1]-aa[1],bb[2]-aa[2]).normalize();
      const across=u.clone().addScaledVector(tangent,-u.dot(tangent)).normalize();
      const normal=tangent.clone().cross(across);
      const joint=8+side*3;
      const upperBlend=T.MathUtils.smoothstep(y,.008,.137);
      const wristBlend=1-T.MathUtils.smoothstep(y,-.174,-.089);
      const ring=[];
      for(let j=0;j<port.length;j++) {
        const angle=mix(ringAngles[j],phase+orientation*TAU*j/port.length,T.MathUtils.smoothstep(i,1,10));
        const vertex=V(sign*x,y,z).addScaledVector(across,width*Math.cos(angle))
          .addScaledVector(normal,depth*Math.sin(angle));
        if(i<3) {
          const base=port[j]*3;
          const shoulder=T.MathUtils.smoothstep(i,0,3);
          const along=V(result.position[base],result.position[base+1],result.position[base+2])
            .addScaledVector(d,.035+i*.023);
          vertex.lerp(along,.56*(1-shoulder));
        }
        const color=complexion(vertex.x,vertex.y,vertex.z,Math.max(0,Math.sin(angle))*.64);
        ring.push(point(result,vertex.x,vertex.y,vertex.z,color,
          joint+1,wristBlend>0?joint+2:joint,wristBlend||upperBlend));
      }
      strip(result,previous,ring);
      previous=ring;
    }
    cap(result,previous);
  }
  return geometry(result,true);
}

const skull = [
  [-.022,.047,-.087,.057], [.000,.086,-.103,.112], [.025,.108,-.119,.143],
  [.058,.129,-.130,.146], [.088,.141,-.144,.151], [.121,.154,-.158,.158],
  [.155,.164,-.165,.153], [.187,.170,-.169,.141], [.219,.172,-.175,.139],
  [.253,.170,-.176,.156], [.282,.166,-.174,.157], [.320,.163,-.164,.150],
  [.347,.150,-.150,.136], [.374,.121,-.129,.104], [.397,.078,-.101,.056],
  [.408,.025,-.073,.010], [.410,.002,-.040,-.036]
];

export function faceDepth(x,y,front,back,width) {
  const ax=Math.abs(x);
  const angle=Math.asin(clamp(x/width,-1,1));
  const bump=
    .021*bell(ax,y,.107,.161,.043,.042) + .017*bell(ax,y,.079,.245,.063,.026)
    -.026*bell(ax,y,.074,.215,.048,.027) -.016*bell(ax,y,.139,.202,.028,.057)
    +.039*bell(x,y,0,.185,.027,.050)+.054*bell(x,y,0,.150,.029,.021)
    +.023*bell(ax,y,.026,.139,.016,.015)-.011*bell(ax,y,.021,.128,.009,.006)
    +.010*bell(ax,y,.064,.113,.045,.057)+.018*bell(x,y,0,.108,.055,.019)
    +.011*bell(x,y,0,.091,.051,.007)+.009*bell(x,y,0,.073,.053,.009)
    -.005*bell(x,y,0,.082,.050,.003)+.022*bell(x,y,0,.041,.060,.028)
    -.007*bell(x,y,0,.057,.054,.009);
  return (front+back)/2+(front-back)*.5*Math.cos(angle)+bump;
}

const skullSamples=smoothSections(skull,12);
export function faceAt(x,y) {
  const i=skullSamples.findIndex(row=>row[0]>=y);
  const a=skullSamples[Math.max(0,i-1)],b=skullSamples[Math.max(0,i)];
  const w=a===b?0:(y-a[0])/(b[0]-a[0]);
  return faceDepth(x,y,mix(a[3],b[3],w),mix(a[2],b[2],w),mix(a[1],b[1],w));
}

export function skullGeometry(level) {
  const result=surface(), sides=[112,64,40][level];
  const rows=smoothSections(skull,[6,4,2][level]);
  const rings=rows.map(([y,w,back,front])=>Array.from({length:sides},(_,j)=>{
    const angle=j*TAU/sides;
    const x=w*Math.sin(angle), facing=Math.cos(angle);
    const plain=(front+back)/2+(front-back)*.5*facing;
    const visible=T.MathUtils.smoothstep(facing,.18,.75);
    const sideAngle=Math.min(angle,TAU-angle);
    let gills=0;
    for(let i=0;i<3;i++) {
      const center=1.48+i*.167+(y-.105)*2.7;
      gills+=bell(sideAngle,y,center,.110+i*.012,.031,.034);
    }
    const z=mix(plain,faceDepth(x,y,front,back,w),visible);
    const color=complexion(x,y,z,Math.max(0,facing)*.76)
      .lerp(lip,visible*.63*bell(x,y,0,.082,.054,.018))
      .lerp(flank,visible*.22*bell(Math.abs(x),y,.077,.219,.039,.033))
      .lerp(gillColor,clamp(gills*.82,0,.85))
      .lerp(nostrilColor,.70*bell(Math.abs(x),y,.023,.128,.010,.004));
    return point(result,x-Math.sign(x)*.0035*gills,y,z,color);
  }));
  for(let i=1;i<rings.length;i++) strip(result,rings[i-1],rings[i]);
  cap(result,rings[0],true);
  cap(result,rings.at(-1));
  return geometry(result);
}

// Thin fin membranes are outlined by independent leading and trailing edges.
export function membranes(outlines,level) {
  const result=surface(), width=[7,5,3][level];
  for(const {ribs, color=finBase, edge=finEdge, reverse=false} of outlines) {
    const samples=smoothSections(ribs,[4,3,2][level]), start=result.position.length/3;
    samples.forEach(([ax,ay,az,bx,by,bz],i)=>{
      const u=i/(samples.length-1);
      for(let j=0;j<=width;j++) {
        const v=j/width, shade=.15+.48*v+.13*Math.sin(u*95+v*.8)*Math.sin(Math.PI*v);
        const c=color.clone().lerp(edge,shade);
        const fold=.009*Math.sin(Math.PI*v)*Math.sin(u*17+v*1.1)*Math.sin(Math.PI*u);
        point(result,mix(ax,bx,v)+fold,mix(ay,by,v),mix(az,bz,v),c);
        if(j && i) {
          const k=start+i*(width+1)+j, p=k-width-1;
          if(reverse) result.index.push(p,p-1,k-1,p,k-1,k);
          else result.index.push(p-1,p,k-1,p,k,k-1);
        }
      }
    });
  }
  return geometry(result);
}

export function batchSweeps(level,rows) {
  const positions=[], colors=[], indices=[];
  for(const {path,color} of rows) {
    const g=sweep(path,[8,6,5][level]), p=g.attributes.position, start=positions.length/3;
    for(let i=0;i<p.count;i++) {
      positions.push(p.getX(i),p.getY(i),p.getZ(i));
      colors.push(color.r,color.g,color.b);
    }
    for(const i of g.index.array) indices.push(i+start);
    g.dispose();
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  g.setIndex(indices);g.computeVertexNormals();
  return g;
}

export function hairCapGeometry(level) {
  const mesh=surface(), around=[72,44,28][level], layers=[20,14,9][level];
  const colors=[new T.Color(0x243833),new T.Color(0x465047)];
  const rings=[];
  for(let i=0;i<=layers;i++) {
    const u=i/layers, ring=[];
    for(let j=0;j<around;j++) {
      const a=j*TAU/around, facing=Math.cos(a);
      const bottom=.134+.185*T.MathUtils.smoothstep(facing,-.30,.86)
        + .014*Math.sin(a*4)+.008*Math.sin(a*11)+.004*Math.sin(a*26);
      const y=mix(bottom,.409,u);
      const k=skullSamples.findIndex(section=>section[0]>=y);
      const lo=skullSamples[Math.max(0,k-1)],hi=skullSamples[Math.max(0,k)];
      const f=(y-lo[0])/(hi[0]-lo[0]||1);
      const ridge=Math.cos(a*19+u*(7+2*facing))+.45*Math.cos(a*31-u*9);
      const thickness=.009+(.009+.003*ridge)*Math.sin(Math.PI*u*.82);
      const x=(mix(lo[1],hi[1],f)+thickness)*Math.sin(a);
      const front=mix(lo[3],hi[3],f)+thickness,back=mix(lo[2],hi[2],f)-thickness;
      const z=(front+back)*.5+(front-back)*.5*facing;
      ring.push(point(mesh,x,y+thickness*u,z,colors[0].clone().lerp(colors[1],.33+.17*ridge)));
    }
    if(i) strip(mesh,rings.at(-1),ring);
    rings.push(ring);
  }
  cap(mesh,rings.at(-1));
  return geometry(mesh);
}


const irisGold=new T.Color(0xd2aa5d);
const irisRim=new T.Color(0x5c6345);
const eyeWhite=new T.Color(0x869889);
const pupil=new T.Color(0x182824);
const lidSkin=new T.Color(0x697a6d);
const lidEdge=new T.Color(0x45594e);
const gillColor=new T.Color(0x243b35);
const nostrilColor=new T.Color(0x293933);
const eyeWidth=.038;
export const eyeY=.219;

function eyeEdges(x,sign) {
  const u=x/eyeWidth;
  const a=Math.max(0,1-u*u)**.66;
  return [-.012*a+.006*u*sign,.017*a+.006*u*sign];
}

export function eyeGeometry(level,sign,upperLid=false) {
  const mesh=surface(),columns=[40,28,20][level],rows=upperLid?4:[26,17,12][level];
  const center=sign*.075;
  for(let i=0;i<=columns;i++) {
    const x=2*eyeWidth*(i/columns-.5);
    const [bottom,top]=eyeEdges(x,sign);
    for(let j=0;j<=rows;j++) {
      const v=j/rows;
      const y=upperLid?top+(.009+.015*Math.sin(Math.PI*i/columns))*v:mix(bottom,top,v);
      const arch=Math.max(0,1-(x/eyeWidth)**2);
      const face=faceAt(center+x,eyeY+y);
      let z,color;
      if(upperLid) {
        z=face+.0015+.006*arch*(1-v);
        color=lidEdge.clone().lerp(lidSkin,T.MathUtils.smoothstep(v,0,.86));
      } else {
        z=face+.003+.016*Math.sin(Math.PI*v)**.6*arch;
        const dx=x+sign*.002;
        const radius=Math.hypot(dx,y);
        const spoke=.5+.5*Math.sin(Math.atan2(y,dx)*34+radius*370);
        color=irisGold.clone().lerp(irisRim,.26+.55*T.MathUtils.smoothstep(radius,.009,.017)+.12*spoke)
          .lerp(eyeWhite,T.MathUtils.smoothstep(radius,.013,.018))
          .lerp(pupil,1-T.MathUtils.smoothstep(Math.hypot(dx*1.47,y*.79),.006,.008));
        color.lerp(lidEdge,.31*(1-Math.sin(Math.PI*v)));
      }
      const k=point(mesh,center+x,y,z,color);
      const p=k-rows-1;
      if(i&&j) mesh.index.push(p-1,k-1,p,k-1,k,p);
    }
  }
  return geometry(mesh);
}
