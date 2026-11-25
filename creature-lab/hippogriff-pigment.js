// Periodic linear-data tile. Red stores soft pigment islands, green broken
// filaments, blue overlapping contour feathers and alpha broad pigment variation.
const size=512;
let pixels;
export function surfaceTile(){
 if(pixels)return pixels;
 pixels=new Uint8Array(size*size*4);
 let seed=27391;
 const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
 function field(cells){
  const grid=Float32Array.from({length:cells*cells},random);
  return (x,y)=>{
   x*=cells/size;y*=cells/size;
   const ix=Math.floor(x),iy=Math.floor(y);
   const sample=(dx,dy)=>grid[((iy+dy+cells)%cells)*cells+(ix+dx+cells)%cells];
   let u=x-ix,v=y-iy;u*=u*(3-2*u);v*=v*(3-2*v);
   return (1-v)*(sample(0,0)*(1-u)+sample(1,0)*u)+v*(sample(0,1)*(1-u)+sample(1,1)*u);
  };
 }
 const warp=field(9),mottle=field(5),grain=field(42);
 const spots=new Float32Array(size*size),hair=new Float32Array(size*size);
 for(const [cells,strength] of [[11,.76],[22,.33]]){
  const step=size/cells;
  for(let j=0;j<cells;j++)for(let i=0;i<cells;i++){
   const x=(i+random())*step,y=(j+random())*step;
   const rx=(.21+.34*random())*step,ry=rx*(.65+.6*random()),tilt=random()-.5;
   const amp=strength*(.48+.52*random());
   for(let dy=-Math.ceil(ry*1.6);dy<=ry*1.6;dy++)for(let dx=-Math.ceil(rx*2.2);dx<=rx*2.2;dx++){
    const r=((dx+dy*tilt)/rx)**2+(dy/ry)**2;
    if(r<2.25)spots[((Math.floor(y)+dy)&511)*size+((Math.floor(x)+dx)&511)]+=amp*Math.exp(-2*r);
   }
  }
 }
 // Short tapered strokes, broken at different positions along each lock.
 for(let i=0;i<42000;i++){
  const x=random()*size,y=random()*size,len=5+random()*28,slope=(warp(x,y)-.5)*.52;
  const val=(random()-.49)*.96;
  for(let k=0;k<len;k++){
   const yy=y+slope*k,iy=Math.floor(yy),frac=yy-iy,h=val*Math.sin(Math.PI*k/len),ix=(Math.floor(x)+k)&511;
   hair[(iy&511)*size+ix]+=h*(1-frac);hair[((iy+1)&511)*size+ix]+=h*frac;
  }
 }
 // Distal vanes overlap the next row. Evaluate adjacent rows across the
 // periodic boundary so facial and transition plumage has no tile seam.
 const contours=new Float32Array(size*size).fill(.47);
 for(let row=16;row>=-2;row--)for(let col=0;col<24;col++){
  const cx=row*32,cy=(col+.5*(row&1))*size/24;
  const key=warp((cx+size)%size,cy);
  const width=12+5*key,length=39+14*grain((cx+size)%size,cy);
  for(let dx=0;dx<length;dx++){
   const t=dx/length,halfWidth=width*(.24+.76*Math.sin(Math.PI*t)**.64);
   const bend=3*(key-.5)+5*(key-.5)*t*t;
   for(let dy=-Math.ceil(width+4);dy<=width+4;dy++){
    const across=(dy-bend)/halfWidth,edge=Math.abs(across);
    if(edge>=1)continue;
    const i=((Math.round(cy+dy)&511)*size)+((cx+dx)&511);
    const barb=Math.cos(2.7*dx-1.8*Math.abs(dy-bend)+3*key);
    const shade=.43+.19*t+.07*key+.07*barb+.14*Math.exp(-18*edge)-.24*edge**3;
    const opacity=Math.min(1,4*(1-edge));
    contours[i]+=(shade-contours[i])*opacity;
   }
  }
 }
 const byte=v=>Math.round(255*Math.min(1,Math.max(0,v)));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const i=y*size+x,dx=Math.round(12*(warp(x,y)-.5)+4*(grain(x,y)-.5)),dy=Math.round(13*(warp(y,x)-.5));
  pixels[4*i]=byte(spots[((y+dy)&511)*size+((x+dx)&511)]);
  pixels[4*i+1]=byte(.5+hair[i]*.62);pixels[4*i+2]=byte(contours[i]);
  pixels[4*i+3]=byte(mottle(x,y));
 }
 return pixels;
}

export function studioTile(device){
 let data=surfaceTile(),n=size;
 const texture=device.createTexture({size:[n,n],format:'rgba8unorm',mipLevelCount:10,usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 for(let mip=0;;mip++){
  device.queue.writeTexture({texture,mipLevel:mip},data,{bytesPerRow:4*n},[n,n]);
  if(n===1)break;
  const half=n/2,next=new Uint8Array(half*half*4);
  for(let y=0;y<half;y++)for(let x=0;x<half;x++)for(let c=0;c<4;c++){
   const i=4*(2*y*n+2*x)+c;
   next[4*(y*half+x)+c]=(data[i]+data[i+4]+data[i+n*4]+data[i+n*4+4]+2)>>2;
  }
  n=half;data=next;
 }
 return texture.createView();
}

// Both Lab renderers evaluate these same pigment and microsurface equations.
// Each branch returns display-space pigment and perceptual roughness.
const materialBody=`
 float id=floor(a.z+.5);
 float u=abs(a.x);
 float t=a.y;
 float salt=a.w;
 if(id<.5){
  float leg=1.-smoothstep(.68,1.38,p.y);
  float flank=p.z+.34*abs(p.x);
  float contour=p.y+.21*sin(flank*2.6)+.20*flank;
  vec2 uv=vec2(flank,contour);
  vec4 coat=tile(uv*1.28,lod+.36);
  vec4 tips=tile(uv*3.6+vec2(.31,.67),lod+1.85);
  vec4 legHair=tile(vec2(-p.y+.17*flank,flank+.11*p.y)*3.6,lod+1.85);
  tips=mix(tips,legHair,leg);
  float horse=1.-smoothstep(.10,.66,p.z+.11*(coat.a-.5));
  float grey=.505+.19*coat.r+.11*tips.r+.09*(coat.a-.5)-leg*.065;
  float value=mix(.72,grey,horse)+(.13*tips.g+.075*coat.g-.102);
  if(horse<.99){
   float face=smoothstep(1.8,2.6,p.y);
   vec4 contourFeather=tile(vec2(-p.z-.54*p.y,p.y+.31*abs(p.x))*mix(2.4,5.7,face),lod+2.3);
   value+=(1.-horse)*(.33*(contourFeather.b-.5)+.075*(contourFeather.g-.5));
  }
  return vec4(vec3(.984,1.,1.015)*value,.82+.09*(coat.a-.5));
 }
 if(id<4.5){
  float flight=1.-step(.1,min(abs(id-2.),abs(id-3.)));
  salt=floor(salt)/250.;
  float barb=t-u*(.81+.47*salt)+.12*u*sin(13.*t+salt);
  vec4 vane=tile(vec2(t*3.2,barb*3.8)+vec2(salt,.73*salt),lod+1.95);
  vec4 ink=tile(vec2(t*.98,barb*1.85)+vec2(salt*4.,salt),lod+.9);
  float rachis=1.-smoothstep(.0004,.0023+.0015*flight,u);
  float field=smoothstep(.65,2.65,p.y);
  float body=.57+.21*field+.063*(salt-.5);
  float wing=mix(.59,.382,flight)+.098*(salt-.5)+.045*step(2.5,id)*flight;
  float value=mix(wing,body,1.-step(1.5,id))+.07*(ink.a-.5)+.102*(vane.g-.5);
  value-=flight*.105*ink.r*(.5+.5*ink.a);
  value+=rachis*(.068+.038*flight);
  float transition=(1.-smoothstep(.18,.65,p.z))*step(id,1.4);
  value=mix(value,.58+.11*ink.r+.12*(vane.g-.5),transition*.72);
  value+=transition*.15*(vane.b-.5);
  return vec4(value*vec3(.992,1.,1.012),.75+.13*(vane.a-.5)-.10*rachis);
 }
 if(id<5.5){
  vec4 lock=tile(vec2(t*1.7,a.x*2.+.034*sin(t*6.+salt))+salt,lod+1.);
  float hair=.59+.16*(salt-.5)+.19*(lock.g-.5)+.12*(lock.a-.5)+.065*t;
  return vec4(vec3(1.,.994,.984)*hair,.57+.16*lock.a);
 }
 vec2 eye=vec2((abs(p.x)-.192)*.58168-(p.z-1.386)*.81342,p.y-2.635);
 float radius=length(eye)/.044;
 if(id<8.5){
  float angle=polar(eye);
  vec4 iris=tile(vec2(radius*.23,angle*.159155),lod+3.);
  float spoke=.5+.5*cos(angle*73.+2.*sin(angle*18.)+2.*radius);
  float amber=(.73+.20*spoke+.31*(iris.g-.5))*(1.-.72*smoothstep(.72,.99,radius));
  if(id<6.5){
   float rim=smoothstep(.99,1.55,radius);
   return vec4(mix(vec3(.095,.075,.056),vec3(.39,.354,.295),rim),.28+.30*rim);
  }
  if(id<7.5){return vec4(vec3(.95,.59,.19)*amber,.12);}
  return vec4(.026,.024,.021,.09);
 }
 vec4 horn=tile(vec2(p.y*2.6,p.z*2.4+abs(p.x)*1.8),lod+1.45);
 if(id<9.5){
  float cere=1.-smoothstep(1.49,1.61,p.z+.013*(horn.b-.5));
  vec3 bill=mix(vec3(.24,.255,.26),vec3(.57,.525,.395),cere);
  return vec4(bill+(.045*(horn.b-.5)+.056*(horn.g-.5)),.52+.15*cere+.09*(horn.a-.5));
 }
 if(id<10.5){
  float rim=smoothstep(.88,1.66,radius)*(1.-step(1.5,p.z));
  return vec4(mix(vec3(.15,.13,.11),vec3(.48,.465,.435),rim)+.045*(horn.b-.5),.56+.17*rim);
 }
 if(id<11.5){return vec4(vec3(.48,.442,.352)*(.94+.16*horn.a)+.07*(horn.b-.5),.75+.14*(horn.a-.5));}
 float hoof=1.-step(0.,p.z);
 float wear=hoof*(1.-smoothstep(.018,.084,p.y))+.20*smoothstep(.81,1.,t)*(1.-hoof);
 return vec4(vec3(.273,.268,.249)+.105*wear+.073*(horn.g-.5)+.07*(horn.a-.5),.57+.19*wear);
`;
export function pigmentSource(wgsl){
 const coverage=`
 float marginCoverage(vec3 p,vec4 a){
  if(a.z<.5||a.z>4.5){return 1.;}
  float transition=(1.-smoothstep(.12,.74,p.z))*step(a.z,1.4);
  float barb=a.y-abs(a.x)*.94;
  float fringe=.1*cos(690.*barb+floor(a.w));
  return 1.-(.56+.28*transition)*smoothstep(.65-.21*transition,.998,fract(a.w)+fringe);
 }`;
 if(!wgsl)return 'float polar(vec2 v){return atan(v.y,v.x);}\nvec4 biological(vec3 p,vec4 a,float lod){'+materialBody+'}'+coverage;
 return 'fn polar(v:vec2f)->f32{return atan2(v.y,v.x);}\nfn biological(p:vec3f,a:vec4f,lod:f32)->vec4f{'+(materialBody+'}'+coverage.replace('float marginCoverage(vec3 p,vec4 a)','fn marginCoverage(p:vec3f,a:vec4f)->f32'))
  .replace('if(id<.5)', 'if(!plumage && id<.5)').replace('if(id<4.5)', 'if(plumage)')
  .replace(/\b(?:float|vec[234]) (\w+)=/g,'var $1=').replace(/\bvec([234])\(/g,'vec$1f(');
}
