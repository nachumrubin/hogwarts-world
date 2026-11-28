// Bind-space coordinates keep pigmentation, growth direction and pores fixed
// to the skinned surface. The lab still owns lights, shadows and tone mapping.
import {centaurDetail} from './centaur-detail.js';

const shared=`
varying vec3 restP,restN,opticalN;
varying vec2 finishUV;
varying float human;
uniform sampler2D detailField;
uniform vec2 gaze;
float h3(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float grain3(vec3 p){
 vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+1.),f.x),f.y),f.z);
}
float bell(float x,float r){return exp(-x*x/(r*r));}
`;
const hide=`
vec3 p=restP;float y=p.y,a=abs(p.x);
vec3 w=pow(abs(normalize(restN)),vec3(4.));w/=max(.001,w.x+w.y+w.z);
vec4 pores=texture2D(detailField,p.zy*29.)*w.x+texture2D(detailField,p.xz*29.)*w.y+texture2D(detailField,p.xy*29.)*w.z;
float m=grain3(p*13.),f=grain3(p*93.);
float skin=smoothstep(.01,.99,human+(m-.5)*.21+(f-.5)*.045);
vec3 flesh=mix(vec3(.33,.161,.096),vec3(.47,.256,.166),.65*m+.35*f);
float cheek=bell(y-2.087,.022)*bell(a-.050,.030)*smoothstep(.77,.81,p.z);
float ears=bell(a-.085,.017)*bell(y-2.107,.035);
float flushed=clamp(cheek+ears+.40*bell(y-2.08,.018)*bell(a,.018)*smoothstep(.812,.85,p.z),0.,1.);
flesh*=vec3(1.+.14*flushed,1.-.14*flushed,1.-.10*flushed);
float lip=bell(y-(2.046+.0015*cos(a*156.)),.0048)*(1.-smoothstep(.017,.034,a))*smoothstep(.804,.83,p.z);
flesh=mix(flesh,vec3(.315,.108,.087),.78*lip);
float freckle=smoothstep(.71,.84,grain3(p*520.))*smoothstep(.46,.71,m);
float vein=bell(grain3(p*28.+3.)+.13*f-.5,.024)*smoothstep(.20,.33,a)*bell(y-1.52,.16);
flesh*=vec3(1.-.12*freckle-.13*vein,1.-.15*freckle-.05*vein,1.-.17*freckle);
float crease=bell(y-2.158-.0018*cos(p.x*70.),.00065)+.70*bell(y-2.166-.0013*cos(p.x*70.),.00055);
crease*=smoothstep(.795,.824,p.z)*(1.-smoothstep(.035,.064,a));
float beard=(1.-smoothstep(2.024+.68*a,2.034+.68*a,y))*smoothstep(1.997,2.015,y)*smoothstep(.728,.796,p.z);
beard+=bell(y-2.057,.0045)*(1.-smoothstep(.017,.035,a))*smoothstep(.81,.83,p.z);
beard=clamp(beard*(1.-lip),0.,1.);
float stubble=1.-smoothstep(.48,.79,pores.r);
flesh=mix(flesh,vec3(.054,.029,.018),beard*(.28+.15*stubble+.08*f));
float crow=bell(a-.058,.014)*bell(y-2.114,.011)*bell(sin((y+.21*a)*1510.+12.*a+3.*m),.19);
float smile=bell(a-(.022+.43*(2.076-y)),.0018)*bell(y-2.059,.016);
crease+=(.49*crow+.54*smile)*smoothstep(.766,.805,p.z);
flesh*=1.-.09*crease;
float limb=1.-smoothstep(.27,.85,y);
float whorl=bell(p.z-.43,.26)*bell(y-1.13,.23);
float flow=mix(.13,-.73,limb)+.48*whorl+.17*(grain3(p*4.)-.5);
float lateral=p.y+p.z*flow+.26*p.x+.006*grain3(p*17.);
vec2 coatUV=vec2(lateral*4.3,(p.z*(1.-limb)-p.y*limb+p.x*.65)*2.4);
float fibre=texture2D(detailField,coatUV).b;
float copper=clamp(.39+.27*restN.y+.32*m+.10*f,0.,1.);
vec3 bay=mix(vec3(.074,.018,.009),vec3(.265,.078,.027),copper);
bay=mix(bay,vec3(.029,.015,.012),limb*(.88+.10*f));
bay*=.83+.29*fibre+.065*f;
diffuseColor.rgb*=mix(bay,flesh,skin);
float rough=mix(.32+.13*(1.-fibre)+.09*limb,.47+.15*pores.g-.10*lip,skin);
float relief=mix(.000105*(fibre-.5),.000062*(pores.r-.5)-.00009*crease,skin);
float transverse=lateral;
float silk=(1.-skin)*.054;
float scatter=skin*(.035+.055*flushed);
`;
const groom=`
float along=finishUV.y<-.5?-finishUV.y-1.:finishUV.y;
if(finishUV.y<-.5){
 float fringe=texture2D(detailField,vec2(finishUV.x*.64,along*.21)).a;
 if(along<.008+.064*smoothstep(.27,.72,fringe))discard;
}
float strand=texture2D(detailField,vec2(finishUV.x,along*.62)).a;
float breakUp=grain3(restP*33.);
diffuseColor.rgb*=.52+.69*strand+.13*breakUp;
float rough=.43+.12*(1.-strand);
float relief=.000068*(strand-.5), transverse=finishUV.x;
float silk=.021,scatter=0.;
`;
const horn=`
float fibre=texture2D(detailField,vec2((restP.x+.43*restP.z)*6.,restP.y*1.2)).b;
float ring=sin(restP.y*490.+2.2*grain3(restP*28.));
diffuseColor.rgb*=mix(vec3(.043,.033,.027),vec3(.16,.117,.079),.3+.36*fibre+.13*ring);
float rough=.43+.12*fibre,relief=.00007*(fibre+.17*ring),transverse=restP.x;
float silk=.025,scatter=0.;
`;
const eye=`
vec2 e=vec2(restP.x-sign(restP.x)*.032,restP.y-.1172)-gaze;
float r=length(e),angle=atan(e.y,e.x);
float spoke=texture2D(detailField,vec2(angle/6.2831853+.014*sin(r*650.),r*46.)).a;
float collarette=bell(r-.00325-.0003*sin(angle*18.),.0005);
spoke=clamp(spoke+.35*collarette+.20*sin(angle*37.+r*615.)+.10*cos(angle*19.-r*810.),0.,1.);
float iris=1.-smoothstep(.0058,.00635,r),pupil=1.-smoothstep(.00235,.00262,r);
float rim=smoothstep(.00495,.00625,r);
vec3 amber=mix(vec3(.034,.020,.011),vec3(.184,.093,.030),spoke*(1.-rim));
amber*=1.-.49*rim;
float vessel=bell(sin(restP.y*1450.+grain3(restP*180.)*3.),.095)*smoothstep(.006,.013,r);
diffuseColor.rgb=mix(vec3(.68,.60,.50)*vec3(1.,1.-.20*vessel,1.-.23*vessel),mix(amber,vec3(.004,.003,.002),pupil),iris);
float q=(abs(restP.x)-.032)/.014;
float upper=.116+.0011*q+.00365*max(0.,1.-q*q);
diffuseColor.rgb*=.63+.37*smoothstep(0.,.0030,upper-restP.y);
float tear=1.-smoothstep(.00012,.00065,abs(restP.y-(.116+.0011*q-.0030*max(0.,1.-q*q))));
float rough=.12-.05*tear,relief=0.,transverse=e.x,silk=0.,scatter=0.;
`;
const brow=`
float grain=texture2D(detailField,vec2(finishUV.x*.67+finishUV.y*.052,finishUV.y*.32)).a;
diffuseColor.rgb=mix(vec3(.051,.026,.017),vec3(.23,.116,.068),grain*.85+abs(finishUV.y-.5)*.25);
float rough=.56,relief=.000055*grain,transverse=finishUV.y,silk=.04,scatter=0.;
`;
export function finishMaterial(material,kind,gaze){
 const {field,ready}=centaurDetail();
 material.color.setHex(0xffffff);
 material.customProgramCacheKey=()=> 'centaur10-'+kind;
 material.onBeforeCompile=shader=>{
   shader.uniforms.detailField={value:field};shader.uniforms.gaze={value:gaze};
   const body=kind==='hide',lid=kind==='lid';
   shader.vertexShader='varying vec3 restP,restN,opticalN; varying vec2 finishUV; varying float human;\n'+(body?'attribute float skinCoverage;\n':'')+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    opticalN=normalMatrix*vec3((position.x-sign(position.x)*.032)/.0125,(position.y-.116)/.0125,1.);
    restP=position${lid?'+vec3(0.,2.003,.712)':''};restN=normal;finishUV=uv;human=${body?'skinCoverage':lid?'1.':'0.'};`);
   shader.fragmentShader=shared+shader.fragmentShader;
   const detail=body||lid?hide:kind==='hair'?groom:kind==='eye'?eye:kind==='brow'?brow:horn;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\n'+detail)
     .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=rough;')
     .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
       vec3 px=dFdx(-vViewPosition),py=dFdy(-vViewPosition);
       vec3 tx=cross(py,normal),ty=cross(normal,px);float det=dot(px,tx);
       normal=normalize(normal-sign(det)*(tx*dFdx(relief)+ty*dFdy(relief))/max(abs(det),1e-10));
       ${kind==='eye'?'normal=normalize(opticalN);':''}`)
     .replace('#include <opaque_fragment>',`
       #if NUM_DIR_LIGHTS > 0
       vec3 L=directionalLights[0].direction,V=normalize(vViewPosition),H=normalize(V+L);
       vec3 axis=px*dFdy(transverse)-py*dFdx(transverse);
       axis-=normal*dot(axis,normal);axis/=max(length(axis),1e-7);
       float ndl=max(dot(normal,L),0.);
       float lobe=pow(max(0.,1.-pow(dot(axis,H),2.)),18.)*pow(max(0.,dot(normal,H)),5.);
       outgoingLight+=directionalLights[0].color*(silk*lobe*ndl*vec3(.82,.65,.48)
         +scatter*diffuseColor.rgb*vec3(1.,.43,.25)*max(0.,(dot(normal,L)+.46)/1.46));
       #endif
       ${kind==='eye'?`// A domed tear film reflects the bright sky above the lab.
       vec3 optic=normalize(opticalN);
       vec3 reflection=reflect(-normalize(vViewPosition),optic);
       vec3 skyKey=normalize(mat3(viewMatrix)*vec3(-.23,.15,.96));
       float reflectedSky=smoothstep(.986,.998,dot(reflection,skyKey));
       outgoingLight+=vec3(1.4,1.38,1.29)*reflectedSky+vec3(.12,.10,.08)*tear;
       `:''}
       #include <opaque_fragment>`);
 };
 material.needsUpdate=true;
 return ready;
}
