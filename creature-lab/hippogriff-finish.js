// All coordinates are attached to the rest mesh so pigment follows the skin.
import {pigmentSource} from './hippogriff-pigment.js';
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
@group(0) @binding(2) var pattern:texture_2d<f32>;
@group(0) @binding(3) var filtering:sampler;
fn tile(uv:vec2f,lod:f32)->vec4f{return textureSampleLevel(pattern,filtering,uv,max(lod,0.));}
${pigmentSource(true)}
fn silver(v:Out,n:vec3f)->vec3f{
 let p=v.rest;let id=round(v.detail.z);
 let lod=log2(max(.125,512.*max(length(dpdx(p)),length(dpdy(p)))));
 let surface=biological(p,v.detail,lod);
 let V=normalize(f.eye.xyz-v.world);let wood=f.motion.w;
 let L=normalize(mix(vec3f(-.52,.69,.5),vec3f(.43,.84,.35),wood));
 let H=normalize(V+L);let nl=dot(n,L);
 var light=vec3f(1);if(wood>.5){light=vec3f(1.06,.98,.84)*(.64+.40*canopy(v.world));}
 let feather=id>=1.&&id<=4.;let ocular=id>=6.&&id<=8.;
 let gloss=1.-surface.w;
 let axis=select(vec3f(0.,-.28,-.96),vec3f(0.,-1.,-.08),id==5.||p.y<1.);
 let tangent=normalize(axis-n*dot(axis,n)+vec3f(.00001));
 let sheen=pow(max(0.,1.-pow(dot(tangent,H),2.)),7.)*max(nl,0.)*gloss*.065;
 var color=surface.rgb*(vec3f(.42,.44,.47)+.17*(.5+.5*n.y)+.46*max(nl,0.)*light);
 color+=light*(sheen+gloss*.20*pow(max(dot(n,H),0.),15.+55.*gloss));
 if(feather){color+=light*.068*smoothstep(.04,.83,-nl)*pow(max(dot(-L,V),0.),2.);}
 if(ocular){
  let reflected=reflect(-V,n);
  color+=vec3f(.80,.86,.94)*(.065*smoothstep(.35,.90,reflected.y)+.78*pow(max(dot(H,n),0.),125.));
 }
 return color;
}`;
