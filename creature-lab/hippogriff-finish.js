// All coordinates are attached to the rest mesh so pigment follows the skin.
export const finishShader=`
fn hash(p:vec3f)->f32 {var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
fn noise(p:vec3f)->f32{
 let i=floor(p);let t=fract(p);let u=t*t*(3.-2.*t);
 let a=mix(hash(i),hash(i+vec3f(1,0,0)),u.x);
 let b=mix(hash(i+vec3f(0,1,0)),hash(i+vec3f(1,1,0)),u.x);
 let c=mix(hash(i+vec3f(0,0,1)),hash(i+vec3f(1,0,1)),u.x);
 let d=mix(hash(i+vec3f(0,1,1)),hash(i+vec3f(1)),u.x);
 return mix(mix(a,b,u.y),mix(c,d,u.y),u.z);
}
fn fiber(phase:f32,width:f32)->f32{return cos(phase)*clamp(1.-width/4.,0.,1.);}
fn canopy(p:vec3f)->f32{return smoothstep(.26,.70,noise(vec3f(p.x*.86+p.y*.43,p.z*.95-p.y*.61,.38)));}
fn silver(v:Out,n:vec3f)->vec3f{
 let footprint=length(fwidth(v.rest));let vaneWidth=fwidth(v.detail.x);let vaneLength=fwidth(v.detail.y);
 let p=v.rest;let a=v.detail;let id=round(a.z);let eye=normalize(f.eye.xyz-v.world);
 let wood=f.motion.w;let L=normalize(mix(vec3f(-.52,.69,.5),vec3f(.43,.84,.35),wood));
 let H=normalize(eye+L);let diffuse=max(dot(n,L),0.);let sky=.5+.5*n.y;
 let light=mix(vec3f(1),vec3f(1.06,.98,.84)*(.64+.40*canopy(v.world)),wood);
 let grain=noise(p*48.);var col=vec3f(.56,.57,.58);var gloss=.045;var power=27.;var scatter=0.;
 if(id==1.||id==2.||id==3.||id==4.){
  let flight=select(0.,1.,id==2.||id==3.);let quill=abs(a.x);
  let t=a.y;let salt=a.w;let field=smoothstep(.5,2.7,p.y);
  var value=.54+.27*field+.12*(salt-.5);
  if(id!=1.){value=mix(.53,.32,flight)+.18*salt+.10*clamp(-n.y,0.,1.);
    value-=flight*.10*smoothstep(.24,.84,sin(t*23.+quill*11.+salt*.8));}
  let shaft=1.-smoothstep(.0005,.0028+flight*.001,quill);
  let barbs=fiber(t*1080.-quill*(690.+180.*salt)+3.*sin(t*23.+salt),vaneLength*1080.+vaneWidth*800.);
  value+=.038*barbs+.10*shaft-.07*exp(-t*18.);
  col=vec3f(value*.99,value,value*1.018);scatter=.095*(1.-shaft);gloss=.055;
 }else if(id==0.){
  let horse=1.-smoothstep(.14,.71,p.z+.14*noise(p*8.));
  let pigment=noise(p*vec3f(9.,8.,7.)+noise(p*4.)*.7);
  let dapples=smoothstep(.45,.72,pigment);let flow=p.z*.43+p.y+.14*sin(p.z*3.)+.08*p.x;
  let fur=fiber(1200.*flow+8.*sin(p.z*45.)+grain*2.,footprint*1200.);
  let value=mix(.74,.43+.23*dapples+.08*noise(p*3.),horse)+.036*fur;
  col=vec3f(value*.98,value,value*1.02);gloss=.075;
 }else if(id==5.){
  let value=.48+.17*a.w+.085*fiber(a.x*72.+6.*sin(a.y*9.),vaneWidth*72.)+.11*a.y;
  col=vec3f(value,value*.985,value*.96);gloss=.13;power=40.;
 }else if(id==6.||id==7.||id==8.){
  let angle=atan2(p.y-2.635,(p.z-1.41)*1.65);
  let streak=.5+.5*sin(angle*62.+sin(angle*19.)*2.);
  col=select(vec3f(.12,.105,.085),vec3f(.81,.48,.13)*(.73+.30*streak+.12*grain),id==7.);
  if(id==8.){col=vec3f(.026,.023,.021);}
  gloss=.8;power=84.;
 }else if(id==9.){
  col=mix(vec3f(.57,.53,.42),vec3f(.17,.18,.19),smoothstep(1.48,1.82,p.z))+.025*(grain-.5);gloss=.12;
 }else if(id==10.){col=vec3f(.13,.115,.10);}
 else if(id==11.){col=vec3f(.46,.42,.32)*(.88+.20*grain)+.025*fiber(a.y*95.,vaneLength*95.);}
 else{col=mix(vec3f(.21,.215,.205),vec3f(.36,.34,.30),grain*.65)+.035*fiber((p.x+p.z*.22)*420.,footprint*420.);gloss=.12;}
 let base=col*(vec3f(.42,.44,.47)+.17*sky+.46*diffuse*light);
 let reflection=gloss*pow(max(dot(n,H),0.),power);
 return base+light*(reflection+scatter*pow(max(dot(-L,eye),0.),3.)*(1.-diffuse));
}`;
