// Small deterministic albedo maps baked on construction. No per-fragment noise.
import * as T from '../vendor/three.module.js';

export function bodyPlumageMap() {
  const w=256,h=256;
  const data=new Uint8Array(w*h*4);
  let seed=1971;
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  function pixel(x,y,c,delta=0){
    const k=4*(y*w+x);
    for(let j=0;j<3;j++)data[k+j]=Math.max(0,Math.min(255,c[j]+delta));
    data[k+3]=255;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const u=(x+.5)/w,v=(y+.5)/h;
    let shade=(random()-.5)*7;
    // Sphere UV +Z is the breast, -Z the mantle.
    const back=(1-Math.sin(u*Math.PI*2))*.5;
    const mantle=Math.max(0,Math.min(1,(back-.38)*2.3));
    const patch=(Math.sin(u*51+Math.sin(v*18)*2)+Math.cos(v*31-u*16))*.25+.5;
    const grey=mantle*Math.max(0,Math.min(1,(patch-.26)*1.55));
    const c=[242-44*mantle-36*grey,231-79*mantle+7*grey,208-110*mantle+60*grey];
    const tract=v*18, shaft=((u*39+.5*(Math.floor(tract)%2))%1)-.5;
    const vane=tract+.45*shaft*shaft+.018*Math.sin(u*62);
    shade+=2*Math.cos(2*Math.PI*vane)+1.4*Math.sin(u*937+Math.sin(v*23)*6);
    shade-=2.6*Math.exp(-shaft*shaft/.008)*Math.sin(Math.PI*(tract%1))**2;
    pixel(x,y,c,shade);
  }
  for(let i=0;i<1400;i++){
    const x=Math.floor(random()*w),y=Math.floor(random()*h);
    const back=(1-Math.sin(2*Math.PI*x/w))*.5;
    if(random()>back*.9+.025)continue;
    const len=1+Math.floor(random()*3);
    for(let j=0;j<len&&y+j<h;j++)pixel(x,y+j,[109,90,73],random()*14);
    if(back>.6&&y>0)pixel(x,y-1,[231,223,206]);
  }
  const map=new T.DataTexture(data,w,h);map.colorSpace=T.SRGBColorSpace;
  map.generateMipmaps=true;map.minFilter=T.LinearMipMapLinearFilter;map.magFilter=T.LinearFilter;
  map.wrapS=T.RepeatWrapping;map.needsUpdate=true;return map;
}
