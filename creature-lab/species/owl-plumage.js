// Small deterministic albedo maps baked on construction. No per-fragment noise.
import * as T from '../vendor/three.module.js';

export function plumageMap(kind) {
  const w=kind==='vane'?64:kind==='disc'?512:256, h=kind==='vane'?128:256;
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
    let c,shade=(random()-.5)*7;
    if(kind==='vane'){
      const barb=v*82+Math.abs(u-.53)*14;
      shade+=3*Math.sin(barb*6.28)+17*Math.exp(-((u-.53)**2)/.0002);
      shade-=25*Math.exp(-((Math.sin((v+.05*u)*10.5))**2)/.075)*Math.min(1,v*4);
      const patch=Math.sin(v*11+u*6);
      shade-=random()<.02?39:0;
      c=[225-9*patch,203-8*patch,173-22*patch];
    }else if(kind==='disc'){
      const discU=u*2,dx=Math.abs(discU-.5)-.202,dy=v-.56;
      const r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
      shade+=Math.sin(a*164+4*Math.sin(a*13)+r*19)*5.6+3*Math.sin(a*86-r*42);
      shade-=75*Math.exp(-r*r/.007);
      const rim=Math.max(0,Math.min(1,(Math.hypot((discU-.5)*2,(v-.5)*2)-.92)*14));
      const tear=Math.exp(-((Math.abs(dx+.04*(.56-v))/.085)**2)-((dy/.12)**2));
      c=[245-62*rim-14*tear,236-87*rim-31*tear,219-113*rim-40*tear];
      if(u>=.5){
        const towardCrown=Math.min(1,v*1.6),edge=Math.exp(-v*45);
        const fringe=Math.sin((u-.5)*2100+v*5)*3.8;
        c=[239-32*towardCrown-41*edge,225-63*towardCrown-74*edge,200-78*towardCrown-89*edge];
        shade=fringe+(random()-.5)*13-(random()<.012*towardCrown?61:0);
      }
    }else{
      // Sphere UV +Z is the breast, -Z the mantle.
      const back=(1-Math.sin(u*Math.PI*2))*.5;
      const mantle=kind==='mantle'?1:Math.max(0,Math.min(1,(back-.38)*2.3+(kind==='crown'?.20:0)));
      const patch=(Math.sin(u*51+Math.sin(v*18)*2)+Math.cos(v*31-u*16))*.25+.5;
      const grey=mantle*Math.max(0,Math.min(1,(patch-.26)*1.55));
      c=[242-44*mantle-36*grey,231-79*mantle+7*grey,208-110*mantle+60*grey];
      if(kind==='mantle'){
        const band=v*11,shaft=(u*16+.5*(Math.floor(band)%2))%1-.5;
        shade+=3*Math.cos((band+shaft*shaft)*6.28)-6*Math.exp(-shaft*shaft/.006);
      }
      shade+=2.8*Math.sin(u*900+Math.sin(v*16)*8);
    }
    pixel(x,y,c,shade);
  }
  if(kind==='body'||kind==='crown'||kind==='mantle'){
    for(let i=0;i<1400;i++){
      const x=Math.floor(random()*w),y=Math.floor(random()*h);
      const back=(1-Math.sin(2*Math.PI*x/w))*.5;
      if(kind!=='mantle'&&random()>back*.9+.025)continue;
      const len=1+Math.floor(random()*3);
      for(let j=0;j<len&&y+j<h;j++)pixel(x,y+j,[109,90,73],random()*14);
      if(back>.6&&y>0)pixel(x,y-1,[231,223,206]);
    }
  }
  const map=new T.DataTexture(data,w,h);map.colorSpace=T.SRGBColorSpace;
  map.generateMipmaps=true;map.minFilter=T.LinearMipMapLinearFilter;map.magFilter=T.LinearFilter;
  map.wrapS=T.RepeatWrapping;map.needsUpdate=true;return map;
}
