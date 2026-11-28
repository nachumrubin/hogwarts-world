import {studyParts} from './geometry.js';

function atlasBase(){
 return typeof HIPP_PAGES_ATLASES!=='undefined'
  ?new URL('review/hippogriff-e3/',document.baseURI)
  :import.meta.url;
}
async function upload(device,name){
 const url=typeof HIPP_BUNDLED_ATLASES!=='undefined'
  ?HIPP_BUNDLED_ATLASES[name]
  :new URL('./assets/'+name+'.png',atlasBase());
 const response=await fetch(url);
 if(!response.ok)throw Error('Hippogriff atlas failed to load: '+name);
 const blob=await response.blob();
 const image=await createImageBitmap(blob,{colorSpaceConversion:'none'});
 const ctx=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
 const levels=1+Math.log2(image.width);
 const texture=device.createTexture({size:[image.width,image.height],mipLevelCount:levels,format:'rgba8unorm',usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING});
 let bytes=0,occupied=0;
 for(let i=0;i<levels;i++){
  const n=image.width>>i;ctx.canvas.width=ctx.canvas.height=n;ctx.imageSmoothingQuality='high';
  ctx.drawImage(image,0,0,n,n);const data=ctx.getImageData(0,0,n,n).data;
  if(!i)for(let k=3;k<data.length;k+=4)occupied+=data[k]>12?1:0;
  device.queue.writeTexture({texture,mipLevel:i},data,{bytesPerRow:n*4},[n,n]);bytes+=data.length;
 }
 const fill=occupied/(image.width*image.height);image.close();
 return {view:texture.createView(),bytes,fill};
}
const feather=`
 let cell=round(v.detail.w);let uv=(vec2f(cell%4.,floor(cell/4.))+clamp(v.detail.xy,vec2f(.001),vec2f(.999)))/vec2f(4,2);
 let vane=textureSample(atlas,filtering,uv);
 let pigment=vane.rgb*(.89+.11*fract(cell*.37))*(.81+.19*smoothstep(.07,.75,v.detail.y))*select(1.,.93,v.detail.z==13.);
 return lit(v,n,pigment,.78,vane.a);`;
const facialFeather=feather.replace('return lit(v,n,pigment,.78,vane.a);',
 `var coverage=vane.a;
 if(v.detail.z==13.){
  let eyePlane=vec2f(((abs(v.rest.x)-.192)*.58168-(v.rest.z-1.386)*.81342)/.078,(v.rest.y-2.635)/.057);
  coverage*=smoothstep(.96,1.13,length(eyePlane));
 }
 return lit(v,n,pigment,.78,coverage);`).replace('textureSample(atlas,filtering,uv)','textureSampleGrad(atlas,filtering,uv,atlasDx,atlasDy)');
const tail=`
 let cell=round(v.detail.w);let uv=(vec2f(cell%4.,floor(cell/4.))+clamp(v.detail.xy,vec2f(.001),vec2f(.999)))/vec2f(4,2);
 let lock=textureSample(atlas,filtering,uv);
 let fiber=normalize(dpdy(v.world)*dpdx(v.detail.x)-dpdx(v.world)*dpdy(v.detail.x)+vec3f(.000001));
 let halfVector=normalize(normalize(f.eye.xyz-v.world)+keyLight);
 let highlight=.105*pow(max(.0,1.-pow(dot(halfVector,fiber),2.)),12.);
 return lit(v,n,lock.rgb+highlight,.72,lock.a);`;
const coat=`
 let p=v.rest;
 let original=vec4f(silver(v,n),1);
 let leg=1.-smoothstep(.74,1.39,p.y);
 let flank=p.z+.33*abs(p.x);let arc=p.y+.23*sin(2.6*flank)+.16*flank;
 let flankUV=vec2f(flank,arc);let hindUV=vec2f(-p.y+.17*flank,flank+.12*p.y);
 let fibers=mix(textureSample(atlas,filtering,flankUV*3.8),textureSample(atlas,filtering,hindUV*3.8),leg);
 let dapple=textureSample(pattern,filtering,flankUV*1.17);
 let grey=.555+.145*dapple.r+.045*(dapple.a-.5)-.045*leg;
 let V=normalize(f.eye.xyz-v.world);let H=normalize(V+keyLight);
 let flow=mix(arc,hindUV.y,leg);
 let T=normalize(dpdx(v.world)*dpdy(flow)-dpdy(v.world)*dpdx(flow)+vec3f(.000001));
 let sheen=.105*pow(max(0.,1.-pow(dot(T,H),2.)),9.)*max(dot(n,keyLight),0.);
 let fiberNormal=normalize(n+(fibers.b-.5)*.34*cross(n,T));
 let color=vec3f(.988,1,1.011)*(grey+.105*(fibers.r-.5)+sheen);
 let fur=lit(v,fiberNormal,color,.58+.26*fibers.g,1.);
 if(v.detail.z>10.){return original;}
 if(p.z>.14){return mix(fur,original,smoothstep(.14,.66,p.z));}
 return fur;`;
const eye=`
 let id=round(v.detail.z);let p=v.rest;
 let atlasDx=dpdx(v.detail.xy)/vec2f(4,2);let atlasDy=dpdy(v.detail.xy)/vec2f(4,2);
 let irisLod=log2(max(1.,length(fwidth(p))*512./.088));
 if(id==1.||id==13.){${facialFeather}}
 let V=normalize(f.eye.xyz-v.world);
 if(id==7.||id==8.){
  let radial=vec2f((abs(p.x)-.192)*.58168-(p.z-1.386)*.81342,p.y-2.635)/.044;
  let shifted=radial*(.97+.035*(1.-abs(dot(n,V))));
  let irisColor=textureSampleLevel(iris,filtering,clamp(.5+.5*shifted,vec2f(.001),vec2f(.999)),irisLod).rgb;
  let shell=normalize(n*.74+normalize(vec3f(sign(p.x)*.813,.18,.582))*.26);
  let R=reflect(-V,shell);let sky=smoothstep(.18,.82,R.y);
  let reflection=.085*sky+.64*pow(max(dot(n,normalize(V+keyLight)),0.),74.)+.20*pow(max(dot(shell,normalize(V+keyLight)),0.),28.);
  return vec4f(irisColor*(.71+.25*max(dot(n,keyLight),0.))+reflection*vec3f(.88,.94,1),1);
 }
 let horn=textureSampleLevel(pattern,filtering,vec2f(p.z*1.9,p.y*2.1+abs(p.x)*.75),max(0.,irisLod-2.)).g;
 if(id==9.){
  let cere=1.-smoothstep(1.49,1.62,p.z);
  return lit(v,n,mix(vec3f(.25,.27,.283),vec3f(.57,.535,.414),cere)+.10*(horn-.5),.48+.19*cere,1.);
 }
 let rim=smoothstep(.045,.075,length(vec2f(p.y-2.635,(p.z-1.386)*.65)));
 return lit(v,n,mix(vec3f(.13,.105,.088),vec3f(.42,.395,.352),rim*(1.-step(1.50,p.z))),.60,1.);`;

const lighting=` const keyLight=vec3f(-.52,.69,.50);
 fn lit(v:Out,n:vec3f,pigment:vec3f,rough:f32,alpha:f32)->vec4f{
  let V=normalize(f.eye.xyz-v.world);let H=normalize(V+keyLight);
  let lighting=vec3f(.42,.44,.47)+.17*(.5+.5*n.y)+.46*max(dot(n,keyLight),0.);
  let shine=(1.-rough)*.16*pow(max(dot(H,n),0.),30.);
  return vec4f(lighting*pigment+shine,alpha);
 }
`;

export class SurfaceStudy{
 constructor(region){
  this.region=region;this.control=true;
  const imageCode={face:eye,chest:feather,coat,tail}[region];
  if(!imageCode)throw Error('Unknown study '+region);
  this.shader=`
 @group(0) @binding(4) var atlas:texture_2d<f32>;
 ${region==='face'?'@group(0) @binding(5) var iris:texture_2d<f32>;':''}
 ${lighting}
 @fragment fn studyFS(v:Out)->@location(0) vec4f{
 let n=faceForward(normalize(v.n),v.world-f.eye.xyz,normalize(v.n));
 ${imageCode}
 }`;
  this.shader+=`
 @fragment fn maskFS(v:Out)->@location(0) vec4f{
  let cell=round(v.detail.w);
  let uv=(vec2f(cell%4.,floor(cell/4.))+clamp(v.detail.xy,vec2f(.001),vec2f(.999)))/vec2f(4,2);
  let coverage=textureSample(atlas,filtering,uv).a;
  if(v.detail.z!=1.&&v.detail.z!=5.&&v.detail.z!=13.){discard;}
  return vec4f(1,coverage,0,0);
 }`;
  // The comparison keeps the same textures, draws, skin and pixels. The
  // generic variant dispatches at runtime using the uniform finish selector.
  if(region==='face')this.shader+=`
 fn faceMaterial(v:Out,n:vec3f)->vec4f{${eye}}
 fn coatMaterial(v:Out,n:vec3f)->vec4f{${coat}}
 fn tailMaterial(v:Out,n:vec3f)->vec4f{${tail}}
 fn breastMaterial(v:Out,n:vec3f)->vec4f{${feather}}
 @fragment fn mixedFS(v:Out)->@location(0) vec4f{
  let n=faceForward(normalize(v.n),v.world-f.eye.xyz,normalize(v.n));
  switch u32(f.motion.z){
   case 1u:{return faceMaterial(v,n);}
   case 2u:{return coatMaterial(v,n);}
   case 3u:{return tailMaterial(v,n);}
   default:{return breastMaterial(v,n);}
  }
 }`;
  this.names=region==='face'?[region,'iris']:[region];
  this.layout=this.names.map((_,i)=>({binding:4+i,visibility:GPUShaderStage.FRAGMENT,texture:{}}));
 }
 async init(d,pipeline,layout,vertex){
  const maps=await Promise.all(this.names.map(n=>upload(d,n)));
  this.bindings=maps.map((m,i)=>({binding:i+4,resource:m.view}));
  this.textureBytes=maps.reduce((sum,m)=>sum+m.bytes,0);this.fill=maps[0].fill;
  this.pipeline=pipeline(true,this.region!=='coat','studyFS');
  if(this.region==='face')this.mixed=pipeline(true,true,'mixedFS');
  if(this.region!=='coat'){
   const add={srcFactor:'one',dstFactor:'one',operation:'add'};
   this.maskPipeline=d.createRenderPipeline({layout,vertex,fragment:{module:vertex.module,entryPoint:'maskFS',targets:[{format:'rgba16float',blend:{color:add,alpha:add}}]},primitive:{cullMode:'none'}});
  }
  if(d.features.has('timestamp-query')){
   this.query=d.createQuerySet({type:'timestamp',count:2});
   this.resolve=d.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});
   this.result=d.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  }
 }
 // Add one per card footprint and its filtered opacity into separate channels.
 // This diagnostic uses no depth rejection, and is excluded from render timings.
 async overlap(renderer){
  if(!this.maskPipeline)return null;
  const {device:d,width,height}=renderer,row=Math.ceil(width*8/256)*256;
  const target=d.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const buffer=d.createBuffer({size:row*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  const enc=d.createCommandEncoder(),pass=enc.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',clearValue:[0,0,0,0],storeOp:'store'}]});
  pass.setPipeline(this.maskPipeline);pass.setBindGroup(0,renderer.bind);pass.setVertexBuffer(0,renderer.vb);pass.setIndexBuffer(renderer.ib,'uint32');
  pass.drawIndexed(renderer.runs[4],1,renderer.runs.slice(0,4).reduce((x,y)=>x+y,0));pass.end();
  enc.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:row},[width,height]);d.queue.submit([enc.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const raw=new Uint16Array(buffer.getMappedRange()),half=h=>(h>>10)?(1+(h&1023)/1024)*2**((h>>10)-15):h*2**-24;
  let layers=0,opacity=0,occupied=0;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const offset=y*row/2+4*x,count=half(raw[offset]);if(!count)continue;
   occupied++;layers+=count;opacity+=half(raw[offset+1]);
  }
  buffer.unmap();buffer.destroy();target.destroy();
  return {footprintPixels:occupied,meanLayers:layers/occupied,opacityFraction:opacity/layers};
 }
 parts(actor){if(!this.control)return studyParts(actor,this.region);}
 get passDescriptor(){
  return this.profile&&this.query?{timestampWrites:{querySet:this.query,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:{};
 }
 async finishPass(d,encoder){
  if(this.query){encoder.resolveQuerySet(this.query,0,2,this.resolve,0);encoder.copyBufferToBuffer(this.resolve,0,this.result,0,16);}
  const start=performance.now();d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();
  this.drawTime=performance.now()-start;this.copyStart=performance.now();
  return d.createCommandEncoder();
 }
 mapped(){if(this.profile)this.mapTime=performance.now();}
 async presented(){
  if(!this.profile)return;
  const presentTime=performance.now()-this.mapTime;let gpu=null;
  if(this.query){
   await this.result.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(this.result.getMappedRange());
   if(t[1]>t[0])gpu=Number(t[1]-t[0])/1e6;this.result.unmap();
  }
  this.timing={gpu,draw:this.drawTime,readback:this.mapTime-this.copyStart,present:presentTime};
 }
}

export const approvedRegions=['face','chest','coat','tail'];
const approvedAtlases=[...approvedRegions,'iris'];
const entries={face:eye,chest:feather,coat,tail};

export class ApprovedSurface{
 constructor(){
  this.layout=approvedAtlases.map((_,i)=>({binding:4+i,visibility:GPUShaderStage.FRAGMENT,texture:{}}));
  this.shader=approvedAtlases.map((name,i)=>`@group(0) @binding(${4+i}) var ${name}Atlas:texture_2d<f32>;`).join('\n')+lighting+
   approvedRegions.map(name=>{
    const code=name==='face'?entries.face.replace('if(v.detail.z==13.){','{')
     .replace('coverage*=smoothstep(.96,1.13,length(eyePlane));',`
      let depth=(abs(v.rest.x)-.192)*.81342+(v.rest.z-1.386)*.58168;
      let flare=max(0.,depth-.035);
      let uv=eyePlane*vec2f(.078/(.057+.9*flare),.057/(.049+.5*flare));
      coverage*=mix(1.,smoothstep(.94,1.12,length(uv)),smoothstep(-.045,-.020,depth));
     `):entries[name];
    return `
     @fragment fn ${name}FS(v:Out)->@location(0) vec4f{
      let n=faceForward(normalize(v.n),v.world-f.eye.xyz,normalize(v.n));
      ${code.replace(/\batlas\b/g,name+'Atlas').replace(/\biris\b/g,'irisAtlas')}
     }`;
   }).join('\n');
 }
 async init(device,pipeline){
  this.bindings=await Promise.all(approvedAtlases.map(async (name,i)=>({binding:4+i,resource:(await upload(device,name)).view})));
  this.pipelines=approvedRegions.map(name=>pipeline(true,name!=='coat',name+'FS'));
 }
 parts(actor){return studyParts(actor,'all');}
 mapped(){}
 presented(){}
}
