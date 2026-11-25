import * as T from './vendor/three.module.js';

// xy locates the point on its vane, strand or digit. z identifies the
// tissue and w identifies the individual feather or hair bundle.
export function surfaceAttribute(mesh,level){
 const g=mesh.geometry;
 if(g.attributes.surfaceDetail)return g.attributes.surfaceDetail;
 const position=g.attributes.position,vanes=g.userData.vanes;
 const data=new Float32Array(position.count*4);
 let feather=0;
 for(let i=0;i<position.count;i++){
     const detail=g.attributes.clayDetail,region=mesh.name,y=position.getY(i),z=position.getZ(i);
     let kind=0,variation=0;
     if(vanes){
       if(vanes[feather+1]?.offset===i)feather++;
       const spread=region==='wing', wing=spread||region==='folded';
       kind=wing?(feather<(spread?15:10)?(spread?3:2):feather<(spread?25:23)?(spread?2:3):4):1;
       variation=(Math.sin(feather*73.31)*8304)%1*.5+.5;
     }else if(region==='tail'){kind=5;variation=.5+.5*Math.sin(Math.floor(i/([171,98,60][level]))*3.2);}
     else if(region==='orbit'){kind=mesh.userData.clayTone<.35?8:mesh.userData.clayTone<.69?7:6;}
     else if(region==='lid'){kind=10;}
     else if(region==='head'){kind=mesh.userData.clayTone<.85?10:9;}
     else if(region==='foot'){kind=detail?.getY(i)>.79?12:11;}
     else if(region==='leg'){kind=z>0&&y<1?11:z<0&&y<.12?12:0;}
     data[i*4]=detail?.getX(i)??0;data[i*4+1]=detail?.getY(i)??0;data[i*4+2]=kind;data[i*4+3]=variation;
 }
 const attribute=new T.Float32BufferAttribute(data,4);
 g.setAttribute('surfaceDetail',attribute);
 return attribute;
}

// The habitat uses the Lab's existing lit material, including its terrain
// lights and fog. Supply pigment and roughness before its lighting pass.
export function habitatFinish(actor){
 for(const {mesh} of actor.parts)surfaceAttribute(mesh,actor.level);
 for(const material of actor.materials.values()){
  material.onBeforeCompile=shader=>{
   shader.vertexShader='attribute vec4 surfaceDetail; varying vec4 tissue; varying vec3 restPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n tissue=surfaceDetail;restPoint=position;');
   shader.fragmentShader='varying vec4 tissue; varying vec3 restPoint;\n'+shader.fragmentShader.replace('#include <color_fragment>',`
    vec3 p=restPoint;
    float id=floor(tissue.z+.5),t=tissue.y,u=abs(tissue.x),value=.65;
    vec3 pigment=vec3(.65);
    if(id<.5){
     vec3 q=p*vec3(17.,18.,16.);
     float dapples=smoothstep(.08,.64,sin(q.x+sin(q.z))*sin(q.y+.7*cos(q.z))+sin(q.z+sin(q.y))*.45);
     value=mix(.43+.22*dapples,.74,smoothstep(.14,.71,p.z))+.014*sin(p.y*630.+p.z*240.);
     pigment=vec3(.98,1.,1.02)*value;
    }else if(id<4.5){
     value=id==1.?(.54+.27*smoothstep(.5,2.7,p.y)):(id==4.?.53:.32);
     if(id==2.||id==3.)value-=.09*smoothstep(.24,.84,sin(t*23.+u*11.+tissue.w*.8));
     value+=.12*(tissue.w-.5)+.085*(1.-smoothstep(.0006,.003,u))+.035*cos(t*1080.-u*760.)*clamp(1.-fwidth(t)*280.,0.,1.);
     pigment=value*vec3(.99,1.,1.018);
    }else if(id==5.)pigment=vec3(.98,.97,.95)*(.48+.17*tissue.w+.11*t+.06*cos(u*72.));
    else if(id==6.||id==10.)pigment=vec3(.14,.12,.095);
    else if(id==7.)pigment=vec3(.84,.49,.14)*(.84+.16*sin(62.*atan(p.y-2.635,(p.z-1.41)*1.65)));
    else if(id==8.)pigment=vec3(.025);
    else if(id==9.)pigment=mix(vec3(.57,.53,.42),vec3(.17,.18,.19),smoothstep(1.48,1.82,p.z));
    else if(id==11.)pigment=vec3(.46,.42,.32);
    else pigment=vec3(.25,.25,.23);
    diffuseColor.rgb=pow(max(pigment,vec3(.001)),vec3(2.2));
   `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=(id>=6.&&id<=8.)?.13:id==5.?.48:id>=9.?.60:.80;');
  };
  material.needsUpdate=true;
 }
}
