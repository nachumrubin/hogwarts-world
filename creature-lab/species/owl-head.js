import * as T from '../vendor/three.module.js';
import {unzlibSync} from '../vendor/fflate.js';
import {bodyRGB} from './owl-body-albedo.js';
import {wingRGB} from './owl-wing-albedo.js';
import {headRGB} from './owl-head-albedo.js';

const clamp=T.MathUtils.clamp;
const gauss=(x,y)=>Math.exp(-x*x-y*y);
const eyeX=.0235,eyeY=.002;
const pixelCache=new Map();
const sharedTextures=new Map();
export function guideMap(kind){
  const existing=sharedTextures.get(kind);
  if(existing){existing.users++;return existing.map}
  const width=kind==='head'?1024:512,height=kind==='body'?384:512;
  if(!pixelCache.has(kind)){
    const rgb=unzlibSync(Uint8Array.from(atob({head:headRGB,body:bodyRGB,wing:wingRGB}[kind]),c=>c.charCodeAt(0)));
    const rgba=new Uint8Array(width*height*4);
    for(let i=0,j=0;i<rgb.length;i+=3,j+=4){rgba[j]=rgb[i];rgba[j+1]=rgb[i+1];rgba[j+2]=rgb[i+2];rgba[j+3]=255}
    pixelCache.set(kind,rgba);
  }
  const map=new T.DataTexture(pixelCache.get(kind),width,height);map.colorSpace=T.SRGBColorSpace;
  map.generateMipmaps=true;map.minFilter=T.LinearMipmapLinearFilter;map.magFilter=T.LinearFilter;
  map.name=kind;map.wrapS=T.RepeatWrapping;map.needsUpdate=true;
  sharedTextures.set(kind,{map,users:1});return map;
}

export function releaseGuideMap(map){
  const entry=sharedTextures.get(map.name);
  if(entry&&entry.map===map&&--entry.users===0){sharedTextures.delete(map.name);map.dispose()}
}

// The orbital fossae and tapering median feather ridge belong to one
// continuous cranium. Its UV seam lies on the back of the head.
function frontDepth(x,y){
  const cosine=Math.sqrt(Math.max(0,1-(x/.0595)**2-(y/.057)**2));
  const hollow=gauss((Math.abs(x)-eyeX)/.014,(y-eyeY)/.014);
  const ridge=.009*gauss(x/(.003+.007*clamp((y+.037)/.06,0,1)),(y+.006)/.031);
  const cheek=.003*gauss((Math.abs(x)-.032)/.018,(y+.015)/.02);
  const notch=.013*gauss(x/.014,(y-.033)/.019);
  const radius=Math.hypot(x/(.050+.009*clamp(y/.044,-1,1)),(y+notch)/.046);
  const ruff=.0019*Math.exp(-(((radius-.93)/.21)**2));
  const brow=.0023*gauss((Math.abs(x)-.023)/.018,(y-.022)/.011);
  return .048*cosine**.69+cosine*(ridge+cheek+ruff+brow-.0085*hollow-.38*notch);
}
// A broad superorbital shelf narrows to the chin. The paired crown lobes
// share the same continuous surface as the orbital sockets and lower ruff.
function faceWidth(y){
  return 1+.065*gauss((y-.020)/.023,0)-.46*clamp((-y-.006)/.045,0,1);
}
function faceHeight(x,y){
  const forehead=clamp((y-.020)/.034,0,1);
  return y-.006*forehead**2-.0012*forehead*gauss(x/.014,0);
}
function cranium(l){
  const g=new T.SphereGeometry(1,[96,64,40][l],[60,40,24][l]);
  const pos=g.attributes.position,uv=g.attributes.uv;
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i)*.0595,y=pos.getY(i)*.057,z=pos.getZ(i);
    const depth=z>=0?frontDepth(x,y):.056*z;
    const chin=clamp((-y-.014)/.043,0,1),ruff=.00062*chin*Math.sin(97*uv.getX(i)*Math.PI+14*uv.getY(i));
    const nape=Math.max(0,-z)*clamp((.032-y)/.059,0,1);
    const mantle=Math.max(0,1-Math.max(0,z))*(.4+.6*chin);
    const hackle=Math.max(0,-z)**1.5*gauss((y-.012)/.031,0);
    pos.setXYZ(i,x*(faceWidth(y)+.14*nape)+ruff,
      faceHeight(x,y)-ruff-.039*nape-.007*mantle,depth-.029*nape-.005*mantle-.023*hackle);
    // Three's sphere seam lies at -X; use a continuous longitude there and repeat.
    uv.setX(i,uv.getX(i)+.25);
  }
  // Short overlapping facial vanes radiate out of the orbital tract.
  // Sample the same UV and projected cheek surface as the cranium.
  const points=Array.from(pos.array),tex=Array.from(uv.array),index=Array.from(g.index.array);
  const count=[52,31,15][l];
  for(const sign of [-1,1])for(let ring=0;ring<3;ring++)for(let i=0;i<count;i++){
    const angle=2*Math.PI*(i+.37*ring)/count;
    const dx=Math.cos(angle),dy=Math.sin(angle);
    const start=points.length/3;
    if(eyeX+(.020+.0065*ring)*dx<.002)continue;
    for(const along of [0,.58,1])for(const across of [-1,0,1]){
      const reach=.011+.0065*ring+(.008+.0017*Math.sin(i*2.6))*along;
      const width=.0019*across*(1-.87*along**2);
      const x=sign*(eyeX+reach*dx-width*dy),y=eyeY+reach*dy*(dy<0?1.30:1.13)+width*dx;
      const front=Math.sqrt(Math.max(0,1-(x/.0595)**2-(y/.057)**2));
      const mantle=(1-front)*(.4+.6*clamp((-y-.014)/.043,0,1));
      points.push(x*faceWidth(y),faceHeight(x,y)-.007*mantle,frontDepth(x,y)-.005*mantle-.00060+.00104*along+.00026*(1-across*across)*Math.sin(Math.PI*along));
      tex.push(.5+Math.atan2(x/.0595,front)/(2*Math.PI),1-Math.acos(y/.057)/Math.PI);
    }
    for(let j=1;j<3;j++)for(let k=1;k<3;k++){
      const a=start+j*3+k;
      if(sign>0)index.push(a-4,a-1,a,a-4,a,a-3);
      else index.push(a-4,a,a-1,a-4,a-3,a);
    }
  }
  g.setAttribute('position',new T.Float32BufferAttribute(points,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(tex,2));g.setIndex(index);g.deleteAttribute('normal');
  g.computeVertexNormals();return g;
}
function geometry(p,indices,colors,closed){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  if(closed){const end=g.clone();end.setAttribute('position',new T.Float32BufferAttribute(closed,3));end.computeVertexNormals();
    g.morphAttributes.position=[end.attributes.position];g.morphAttributes.normal=[end.attributes.normal]}
  return g;
}
function orbit(l,s,lids){
  const p=[],idx=[],colors=[],closed=[],n=[48,32,20][l],color=new T.Color();
  const rings=lids?[1,1.065,1.17,1.31]:[.001,.29,.43,.51,.59,.67,.81,1.025];
  rings.forEach((r,j)=>{
    for(let i=0;i<=n;i++){
      const a=i/n*2*Math.PI,cs=Math.cos(a),sn=Math.sin(a);
      const dx=.0080*r*cs,slant=.00065*r*cs;
      const dy=.0070*r*sn*(.82+.18*Math.abs(sn));
      const x=s*(eyeX+dx),y=eyeY+slant+dy;
      // Lower lid rises and upper lid descends to the same gently tilted seam.
      const z=frontDepth(x,y)+(lids?.00018+.00094*(1-j/3):.00049+.0021*(1-r*r));
      const mantle=(1-Math.sqrt(Math.max(0,1-(x/.0595)**2-(y/.057)**2)))*.4;
      p.push(x*faceWidth(y),faceHeight(x,y)-.007*mantle,z-.005*mantle);
      if(lids){
        const cover=[1,.90,.52,0][j],endY=y-dy*cover-.0007*cover;
        closed.push(x*faceWidth(endY),faceHeight(x,endY)-.007*mantle,frontDepth(x,endY)-.005*mantle+.0006+.0034*cover);
        const phi=Math.atan2(x/.0595,Math.sqrt(Math.max(0,1-(x/.0595)**2-(y/.057)**2)));
        const texel=4*(Math.floor((.5+phi/(2*Math.PI))*1024)+1024*Math.min(511,Math.floor((1-Math.acos(y/.057)/Math.PI)*512)));
        const pixels=pixelCache.get('head');
        const nearby=new T.Color().setRGB(pixels[texel]/255,pixels[texel+1]/255,pixels[texel+2]/255,T.SRGBColorSpace);
        color.setHex([0x48332b,0x644d41,0x997f6c,0xd8cbbd][j]).lerp(nearby,[0,.15,.68,1][j]);
      }else{
        color.setHex([0x111319,0x161519,0x1d1b20,0x352e2b,0x3e322e,0x372e2b,0x302725,0x201b1b][j]);
        const reflection=gauss((s*r*cs+.29)/.105,(r*sn-.46)/.105);
        color.lerp(new T.Color(0xb3b1a6),reflection*.68);
      }
      colors.push(color.r,color.g,color.b);
      if(i&&j){const k=j*(n+1)+i;idx.push(k-n-2,k-1,k,k-n-2,k,k-n-1)}
    }
  });
  return geometry(p,idx,colors,lids?closed:null);
}
export function owlFace(owl){
  const crown=owl.mesh(owl.head,0xfffefd,cranium);
  crown.material.map=owl.maps[1];crown.material.roughness=.96;
  const lids=[];
  for(const s of [-1,1]){
    const eye=owl.mesh(owl.head,0xffffff,l=>orbit(l,s,false));eye.material.vertexColors=true;eye.material.roughness=.22;
    const lid=owl.mesh(owl.head,0xfffffc,l=>orbit(l,s,true));lid.material.vertexColors=true;lids.push(lid);
  }
  owl.loft(owl.head,0xaa8c72,[[0,-.013,.049,.0035,.0028],[0,-.022,.048,.0038,.0033],[0,-.026,.048,.0024,.0028],[0,-.031,.046,.0012,.0016],[0,-.032,.044,.00036,.00045]]);
  return closure=>{for(const lid of lids)lid.morphTargetInfluences[0]=closure};
}
