import * as T from '../vendor/three.module.js';
import {unzlibSync} from '../vendor/fflate.js';
import {headFinish,bodyFinish,wingFinish,detailFinish} from './owl-finish-atlas.js';

const atlasData={
  body:[bodyFinish,512,384],head:[headFinish,1024,512],
  wing:[wingFinish,512,512],detail:[detailFinish,256,256]
};
const atlases=new Map();

export function guideMap(kind){
  const existing=atlases.get(kind);
  if(existing){existing.users++;return existing.map;}
  const [encoded,width,height]=atlasData[kind];
  const bytes=unzlibSync(Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)));
  // RGB holds sRGB pigment. Alpha is linear height, never transparency.
  const map=new T.DataTexture(bytes,width,height);
  map.colorSpace=T.SRGBColorSpace;
  map.generateMipmaps=true;
  map.minFilter=T.LinearMipmapLinearFilter;
  map.magFilter=T.LinearFilter;
  map.name=kind;
  if(kind==='body'||kind==='head')map.wrapS=T.RepeatWrapping;
  map.needsUpdate=true;
  atlases.set(kind,{map,users:1});
  return map;
}

export function releaseGuideMap(map){
  const entry=atlases.get(map.name);
  if(entry?.map===map&&--entry.users===0){atlases.delete(map.name);map.dispose();}
}

export function atlasUV(geometry,kind,sides,vertex,level){
  const uv=geometry.getAttribute('uv');
  const count=geometry.getAttribute('position').count;
  let u,v;
  if(kind==='leg'||kind==='tail'){
    const rows=[11,8,5][level],local=vertex%(3*rows);
    u=[.11,.49,.89][local%3];
    v=Math.floor(local/3)/(rows-1);
  }else if(uv){
    u=uv.getX(vertex);
    v=uv.getY(vertex);
  }else{
    u=(vertex%sides)/sides;
    v=Math.floor(vertex/sides)/(count/sides-1);
  }
  const tile={leg:0,hock:0,tail:0,toe:1,claw:2,bill:3}[kind];
  // Keep filtering inside the selected tile near the UV endpoints.
  return [((tile%2)+.02+.96*u)*.5,(Math.floor(tile/2)+.02+.96*v)*.5];
}

export function owlFinish(material,kind,scale){
  material.name='owl-'+kind;
  material.defines={...material.defines,OWL_FINISH_DETAIL:1};
  material.customProgramCacheKey=()=>`owl-a8-${kind}-${scale}`;
  material.onBeforeCompile=shader=>{
    if(kind==='wing'){
      shader.vertexShader=`#if OWL_FINISH_DETAIL
        attribute float ventralMark;
        varying float owlVentralMark;
        #endif
      `+shader.vertexShader.replace('#include <begin_vertex>',`
        #include <begin_vertex>
        #if OWL_FINISH_DETAIL
          owlVentralMark=ventralMark;
        #endif
      `);
      shader.fragmentShader=`#if OWL_FINISH_DETAIL
        varying float owlVentralMark;
        #endif
      `+shader.fragmentShader;
    }
    const selectTexel=kind==='wing'?`
      vec2 wingUV=gl_FrontFacing?vec2(vMapUv.x,.75+.25*fract(vMapUv.y*4.0)):vMapUv;
      vec4 owlSample=texture2D(map,wingUV);
      if(gl_FrontFacing){
        #if OWL_FINISH_DETAIL
          float pigment=owlVentralMark;
        #else
          float pigment=.57;
        #endif
        owlSample.rgb=mix(vec3(.83,.79,.71),owlSample.rgb,pigment);
      }
    `:`vec4 owlSample=texture2D(map,vMapUv);`;
    const finish=kind==='lid'?'':kind==='detail'||kind==='bill'?
      'diffuseColor.rgb *= .22 + .95*owlSample.rgb;':'diffuseColor.rgb *= owlSample.rgb;';
    const condition=kind==='detail'||kind==='bill'||kind==='lid'?'#if OWL_FINISH_DETAIL':'';
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <map_fragment>',`
        ${condition}
          ${selectTexel}
          ${finish}
        ${condition?'#endif':''}
      `)
      .replace('#include <roughnessmap_fragment>',`
        #include <roughnessmap_fragment>
        #if OWL_FINISH_DETAIL
          roughnessFactor=clamp(roughnessFactor*(1.085-.23*owlSample.a),.39,1.0);
          ${kind==='detail'?'if(vMapUv.y > .5) roughnessFactor *= .70;':''}
        #endif
      `)
      .replace('#include <normal_fragment_maps>',`
        #include <normal_fragment_maps>
        #if OWL_FINISH_DETAIL
          // Screen-space derivatives of the mip-filtered height preserve
          // broad normals while responding to the vane and keratin relief.
          vec3 owlDx=dFdx(-vViewPosition),owlDy=dFdy(-vViewPosition);
          vec3 r1=cross(owlDy,normal),r2=cross(normal,owlDx);
          float det=dot(owlDx,r1)*faceDirection;
          vec3 relief=sign(det)*(dFdx(owlSample.a)*r1+dFdy(owlSample.a)*r2)*${scale.toFixed(6)};
          float magnitude=abs(det);
          relief *= min(1.0,.34*magnitude/max(length(relief),1e-12));
          normal=normalize((magnitude+1e-12)*normal-relief);
        #endif
      `);
    if(kind==='wing'){
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        #if OWL_FINISH_DETAIL
          vec2 vaneUV=fract(vMapUv*4.0);
          float margin=abs(vaneUV.x*2.0-1.0);
          float edgeWidth=fwidth(margin);
          float fringe=.934+.062*(owlSample.a-.50)+.011*sin(184.0*vaneUV.y+12.0*owlVentralMark);
          if(owlVentralMark>.08&&vaneUV.y>.25&&edgeWidth<.065&&margin>fringe)discard;
        #endif
        #include <opaque_fragment>
      `).replace('#include <lights_fragment_end>',`
        #include <lights_fragment_end>
        #if OWL_FINISH_DETAIL && !defined(OWL_SKIP_TRANSMISSION)
          // Thicker root and rachis transmit less than the distal webs.
          float shaft=1.0-smoothstep(.035,.13,abs(fract(vMapUv.x*4.0)-.5));
          float distal=smoothstep(.05,.87,fract(vMapUv.y*4.0));
          float throughput=(.075+.20*distal)*(1.0-.72*shaft);
          throughput *= gl_FrontFacing ? 1.0 : .58;
          throughput *= smoothstep(.005,.20,owlVentralMark);
          vec3 backLight=vec3(0.0);
          #if NUM_DIR_LIGHTS > 0
            for(int i=0;i<NUM_DIR_LIGHTS;i++){
              float back=max(0.0,-dot(nonPerturbedNormal,directionalLights[i].direction));
              backLight+=back*directionalLights[i].color;
            }
          #endif
          #if NUM_POINT_LIGHTS > 0
            for(int i=0;i<NUM_POINT_LIGHTS;i++){
              IncidentLight behind;
              getPointLightInfo(pointLights[i],geometryPosition,behind);
              float back=max(0.0,-dot(nonPerturbedNormal,behind.direction));
              backLight+=back*behind.color;
            }
          #endif
          reflectedLight.indirectDiffuse+=backLight*diffuseColor.rgb*vec3(1.0,.86,.65)*throughput*RECIPROCAL_PI;
        #endif
      `);
    }
  };
  return material;
}

// The shallow ocular mesh preserves the approved eyelid geometry. The
// optical normal approximates the unflattened cornea for light reflections.
export function owlCornea(material){
  material.name='owl-cornea';
  material.defines={...material.defines,OWL_FINISH_DETAIL:1};
  material.customProgramCacheKey=()=> 'owl-a8-cornea';
  material.onBeforeCompile=shader=>{
    shader.vertexShader='#if OWL_FINISH_DETAIL\nvarying vec3 owlOpticalNormal;\n#endif\n'+shader.vertexShader.replace('#include <begin_vertex>',`
      #include <begin_vertex>
      #if OWL_FINISH_DETAIL
        owlOpticalNormal=normalMatrix * vec3(.67*uv.x,.65*uv.y,1.0);
      #endif
    `);
    shader.fragmentShader='#if OWL_FINISH_DETAIL\nvarying vec3 owlOpticalNormal;\n#endif\n'+shader.fragmentShader.replace('#include <normal_fragment_maps>',`
      #include <normal_fragment_maps>
      #if OWL_FINISH_DETAIL
        normal=normalize(owlOpticalNormal);
      #endif
    `).replace('#include <lights_fragment_end>',`
      #include <lights_fragment_end>
      #if OWL_FINISH_DETAIL && NUM_HEMI_LIGHTS > 0
        vec3 reflected=reflect(-geometryViewDir,normal);
        float grazing=1.0-clamp(dot(geometryViewDir,normal),0.0,1.0);
        float fresnel=.024+.30*pow(grazing,5.0);
        for(int i=0;i<NUM_HEMI_LIGHTS;i++){
          float above=smoothstep(-.04,.47,dot(reflected,hemisphereLights[i].direction));
          vec3 environment=mix(.18*hemisphereLights[i].groundColor,hemisphereLights[i].skyColor,above);
          reflectedLight.indirectSpecular+=.51*fresnel*environment;
        }
      #endif
    `);
  };
}
