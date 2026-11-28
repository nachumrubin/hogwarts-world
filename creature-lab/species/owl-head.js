import * as T from '../vendor/three.module.js';
import {atlasUV,owlFinish,owlCornea} from './owl-finish.js';

const clamp=T.MathUtils.clamp;
const gauss=(x,y)=>Math.exp(-x*x-y*y);
const eyeX=.0235,eyeY=.002;

// The orbital fossae and tapering median feather ridge belong to one
// continuous cranium. Its UV seam lies on the back of the head.
function frontDepth(x,y){
  const cosine=Math.sqrt(Math.max(0,1-(x/.0595)**2-(y/.057)**2));
  const hollow=gauss((Math.abs(x)-eyeX)/.014,(y-eyeY)/.014);
  const ridge=.009*gauss(x/(.003+.007*clamp((y+.037)/.06,0,1)),(y+.006)/.031);
  const cheek=.0043*gauss((Math.abs(x)-.032)/.018,(y+.015)/.02);
  const notch=.013*gauss(x/.014,(y-.033)/.019);
  const radius=Math.hypot(x/(.050+.009*clamp(y/.044,-1,1)),(y+notch)/.046);
  // A shallow raised ruff traces the lower heart and paired upper lobes.
  const edge=.0010*gauss((radius-.94)/.11,0);
  const ruff=.0019*gauss((radius-.93)/.21,0)+edge;
  const brow=.0023*gauss((Math.abs(x)-.023)/.018,(y-.022)/.011);
  return .048*cosine**.69+cosine*(ridge+cheek+ruff+brow-.0076*hollow-.38*notch);
}
// A broad superorbital shelf narrows to the chin. The paired crown lobes
// share the same continuous surface as the orbital sockets and lower ruff.
function faceWidth(y){
  return 1+.034*gauss((y-.019)/.025,0)+.11*gauss((y+.034)/.019,0)-.038*clamp((-y-.010)/.045,0,1);
}
function faceHeight(x,y){
  const forehead=clamp((y-.020)/.034,0,1);
  return y*1.074+.0024*forehead**2+.0029*clamp((-y-.030)/.026,0,1)**2;
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
    const angle=2*Math.PI*(i+.37*ring+.15*Math.sin(4.31*i+ring))/count;
    const dx=Math.cos(angle),dy=Math.sin(angle);
    const start=points.length/3;
    if(eyeX+(.020+.0065*ring)*dx<.002)continue;
    for(const along of [0,.58,1])for(const across of [-1,0,1]){
      const reach=.011+.0065*ring+(.0084+.0022*Math.sin(i*2.6))*along;
      const width=.00152*across*(1-.87*along**2);
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
  g.computeVertexNormals();
  if(l<2){
    // Soft underfeathers share the local follicle bed normal.
    const normals=g.attributes.normal,columns=g.parameters.widthSegments,rows=g.parameters.heightSegments;
    const tip=new T.Vector3(),surface=new T.Vector3();
    for(let i=pos.count;i<normals.count;i++){
      const azimuth=((tex[i*2]-.25)%1+1)%1;
      const col=Math.round(azimuth*columns),row=Math.round((1-tex[i*2+1])*rows);
      tip.fromBufferAttribute(normals,i);
      surface.fromBufferAttribute(normals,row*(columns+1)+col);
      if(tip.dot(surface)<0)tip.negate();
      tip.lerp(surface,.78).normalize();
      normals.setXYZ(i,tip.x,tip.y,tip.z);
    }
  }
  return g;
}
function geometry(p,indices,colors,closed){
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));
  g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  if(closed){const end=g.clone();end.setAttribute('position',new T.Float32BufferAttribute(closed,3));end.computeVertexNormals();
    g.morphAttributes.position=[end.attributes.position];g.morphAttributes.normal=[end.attributes.normal]}
  return g;
}
function orbit(l,s,lids,map){
  const p=[],idx=[],colors=[],closed=[],uv=[],n=[48,32,20][l],color=new T.Color();
  const rings=lids?[1,1.065,1.17,1.31]:[.001,.29,.43,.51,.59,.67,.81,1.025];
  rings.forEach((r,j)=>{
    for(let i=0;i<=n;i++){
      const a=i/n*2*Math.PI,cs=Math.cos(a),sn=Math.sin(a);
      const dx=.00765*r*cs,slant=.00065*r*cs;
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
        const pixels=map.image.data;
        uv.push(.5+phi/(2*Math.PI),1-Math.acos(y/.057)/Math.PI);
        const nearby=new T.Color().setRGB(pixels[texel]/255,pixels[texel+1]/255,pixels[texel+2]/255,T.SRGBColorSpace);
        const fringe=.035*Math.sin(17*a+s)+.026*Math.sin(31*a+j);
        color.setHex([0x423830,0x655346,0xa0927e,0xd8cbbd][j])
          .lerp(nearby,clamp([.06,.31,.78,1][j]+fringe,0,1));
      }else{
        uv.push(s*r*cs,r*sn);
        color.setHex([0x080b10,0x0a0b0e,0x111013,0x211a18,0x2c211a,0x2b211b,0x231b18,0x181416][j]);
        const stroma=.73+.27*Math.sin(27*a+5*Math.sin(6*a+s));
        if(j>2)color.multiplyScalar(stroma);
      }
      colors.push(color.r,color.g,color.b);
      if(i&&j){const k=j*(n+1)+i;idx.push(k-n-2,k-1,k,k-n-2,k,k-n-1)}
    }
  });
  const g=geometry(p,idx,colors,lids?closed:null);
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  return g;
}
export function owlFace(owl){
  const crown=owl.mesh(owl.head,0xfffefd,cranium);
  crown.material.map=owl.maps[1];crown.material.roughness=.95;owlFinish(crown.material,'face',.000115);
  const lids=[];
  for(const s of [-1,1]){
    const eye=owl.mesh(owl.head,0xffffff,l=>orbit(l,s,false,owl.maps[1]));eye.material.vertexColors=true;eye.material.roughness=.19;owlCornea(eye.material);
    const lid=owl.mesh(owl.head,0xfffffc,l=>orbit(l,s,true,owl.maps[1]));
    lid.material.vertexColors=true;lid.material.map=owl.maps[1];lid.material.roughness=.88;
    owlFinish(lid.material,'lid',.00007);lids.push(lid);
  }
  const bill=[[-.013,-.0014,.0035,.0027],[-.021,.0007,.0034,.0029],
    [-.026,.0024,.0024,.0024],[-.030,.0020,.0011,.0015],[-.032,.0003,.0003,.0004]];
  const beak=owl.loft(owl.head,0xb29d86,bill.map(([y,lift,w,h])=>[0,faceHeight(0,y),frontDepth(0,y)+lift,w,h]));
  beak.material.map=owl.maps[3];beak.material.roughness=.66;
  const part=owl.parts.at(-1),make=part.make;
  const surface=(g,l)=>{
    if(l===2)return g;
    const uv=[];
    for(let i=0;i<g.attributes.position.count;i++)uv.push(...atlasUV(g,'bill',[20,12,7][l],i,l));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    return g;
  };
  surface(beak.geometry,0);part.make=l=>surface(make(l),l);
  owlFinish(beak.material,'bill',.000042);
  return (left,right=left)=>{lids[0].morphTargetInfluences[0]=left;lids[1].morphTargetInfluences[0]=right};
}
