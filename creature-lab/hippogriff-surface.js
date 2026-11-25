import {surfaceTile,pigmentSource} from './hippogriff-pigment.js';
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
       // Pack the fractional margin coordinate with a constant per-vane seed.
       const {offset,stride}=vanes[feather],column=(i-offset)%stride;
       const row=i-column,mid=stride/2-1;
       const width=Math.abs(detail.getX(row+(detail.getX(i)>0?mid:0)));
       const margin=Math.min(1,Math.abs(detail.getX(i))/Math.max(width,.000001));
       variation=Math.floor(125+124*Math.sin(feather*73.31))+.02+.94*margin;
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
let pattern;
export function habitatFinish(actor){
 for(const {mesh} of actor.parts)surfaceAttribute(mesh,actor.level);
 if(!pattern){
  pattern=new T.DataTexture(surfaceTile(),512,512);
  pattern.wrapS=pattern.wrapT=T.RepeatWrapping;
  pattern.minFilter=T.LinearMipmapLinearFilter;
  pattern.magFilter=T.LinearFilter;pattern.generateMipmaps=true;pattern.needsUpdate=true;
 }
 for(const material of actor.materials.values()){
  material.alphaToCoverage=true;
  material.onBeforeCompile=shader=>{
   shader.uniforms.surfaceTile={value:pattern};
   shader.vertexShader='attribute vec4 surfaceDetail; varying vec4 tissue; varying vec3 restPoint;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n tissue=surfaceDetail;restPoint=position;');
   shader.fragmentShader=`varying vec4 tissue;
    varying vec3 restPoint;
    uniform sampler2D surfaceTile;
    vec4 tile(vec2 uv,float lod){return textureLod(surfaceTile,uv,max(lod,0.));}
    ${pigmentSource(false)}
    `+shader.fragmentShader.replace('#include <color_fragment>',`
    float pixel=max(length(dFdx(restPoint)),length(dFdy(restPoint)));
    vec4 biologicalSurface=biological(restPoint,tissue,log2(max(.125,pixel*512.)));
    diffuseColor.rgb=pow(max(biologicalSurface.rgb,vec3(.001)),vec3(2.2));
   `).replace('#include <opaque_fragment>','#include <opaque_fragment>\n gl_FragColor.a=marginCoverage(restPoint,tissue);')
   .replace('#include <lights_fragment_end>',`
    #include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
     float region=floor(tissue.z+.5);
     bool vane=region>=1.&&region<=4.;
     float across=vane||region==5.?tissue.x:restPoint.y+.21*sin(2.6*restPoint.z);
     vec3 along=dFdx(geometryPosition)*dFdy(across)-dFdy(geometryPosition)*dFdx(across);
     along*=inversesqrt(max(dot(along,along),1e-18));
     for(int i=0;i<NUM_DIR_LIGHTS;i++){
      vec3 l=directionalLights[i].direction;
      float incidence=dot(l,normal);
      float axial=dot(along,normalize(l+geometryViewDir));
      if(region<=5.)reflectedLight.directSpecular+=directionalLights[i].color*
       (.015*(1.-roughnessFactor)*max(incidence,0.)*pow(max(1.-axial*axial,0.),7.));
      if(vane)reflectedLight.directDiffuse+=directionalLights[i].color*diffuseColor.rgb*
       (.055*smoothstep(.04,.83,-incidence)*pow(max(dot(-l,geometryViewDir),0.),2.));
     }
    #endif
   `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor=biologicalSurface.w;');
  };
  material.needsUpdate=true;
 }
}
