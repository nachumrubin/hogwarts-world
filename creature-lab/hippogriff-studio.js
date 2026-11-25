// Live motion-inspection renderer. The C.4 vertex/index streams are uploaded
// once per selected actor/LOD. Both renderers use the actor's skin palette.
import * as T from './vendor/three.module.js';
import {surfaceAttribute} from './hippogriff-surface.js';
import {studioTile} from './hippogriff-pigment.js';
import {finishShader} from './hippogriff-finish.js';
const shader=`
override plumage:bool=false;
override finished:bool=false;
struct Frame { vp:mat4x4f, motion:vec4f, root:vec4f, feet:array<vec4f,4>, eye:vec4f };
@group(0) @binding(0) var<uniform> f:Frame;
@group(0) @binding(1) var<storage,read> bone:array<mat4x4f>;
struct In { @location(0) p:vec3f,@location(1) n:vec3f,@location(2) ids:u32,@location(3) w:f32,
 @location(4) fold:vec3f,@location(5) fnorm:vec3f,@location(6) lift:vec3f,@location(7) tint:f32,@location(8) detail:vec4f };
struct Out { @builtin(position) pos:vec4f,@location(0) n:vec3f,@location(1) world:vec3f,@location(2) tint:f32,@location(3) rest:vec3f,@location(4) detail:vec4f };
fn clip(p:vec3f)->vec4f {let q=f.vp*vec4f(p,1.);return vec4f(q.xy,(q.z+q.w)*.5,q.w);}
@vertex fn vs(v:In)->Out{
 let skin=bone[v.ids&255u]*v.w+bone[(v.ids>>8u)&255u]*(1.-v.w);
 let p=(skin*vec4f(v.p+f.motion.x*v.fold+f.motion.y*v.lift,1.)).xyz;
 let n=(skin*vec4f(v.n+f.motion.x*v.fnorm,0.)).xyz;
 return Out(clip(p),n,p,v.tint,v.p,v.detail);
}
@vertex fn floorVS(@builtin(vertex_index) i:u32)->Out{
 let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,1),vec2f(1,-1),vec2f(-1,-1),vec2f(-1,1),vec2f(1,1));
 let p=vec3f(f.root.x,0.,f.root.z)+vec3f(corners[i].x,0.,corners[i].y)*70.;
 return Out(clip(p),vec3f(0,1,0),p,1.,p,vec4f(0));
}
${finishShader}
@fragment fn floorFS(v:Out)->@location(0) vec4f{
 if(f.motion.z>0.){let wood=f.motion.w;var base=vec3f(.38,.39,.39);if(wood>.5){base=vec3f(.30,.31,.23)*(.66+.44*canopy(v.world));}
 let delta=v.world.xz-f.root.xz;let shadow=.24*exp(-dot(delta,delta*vec2f(1.4,.50)))*exp(-.7*f.root.y);
 return vec4f(base-shadow,1.);}
 let uv=v.world.xz;let grid=abs(fract(uv+.5)-.5)/max(fwidth(uv),vec2f(.0001));
 let lines=1.-smoothstep(.2,1.3,min(grid.x,grid.y));
 let delta=uv-f.root.xz;
 var shade=.16*exp(-dot(delta,delta)/2.8)*exp(-.45*f.root.y);
 for(var i=0;i<4;i++){
  let r=uv-f.feet[i].xz;shade+=.27*exp(-dot(r,r)/.028)*exp(-9.*max(f.feet[i].y,0.));
 }
 let fade=exp(-.035*length(uv-f.eye.xz));
 let station=abs(fract(uv.y/5.+.5)-.5)*5.;
 let marker=(1.-smoothstep(.045,.075,station))*(1.-smoothstep(.36,.40,abs(uv.x-2.)));

 return vec4f(mix(vec3f(.21,.23,.24),mix(vec3f(.48,.49,.48),vec3f(.95,.75,.32),marker)-shade-lines*.085,fade),1.);
}
@fragment fn fs(v:Out)->@location(0) vec4f{
 let n=faceForward(normalize(v.n),v.world-f.eye.xyz,normalize(v.n));
 let key=max(0.,dot(n,normalize(vec3f(-.46,.78,.55))));
 let rim=max(0.,dot(n,normalize(vec3f(.58,.48,-.72))));
 let clay=vec3f(.79,.774,.744)*v.tint*(.49+.065*n.y+.40*key+.13*rim);
 if(finished){var coverage=1.;if(plumage){coverage=marginCoverage(v.rest,v.detail);}
 return vec4f(silver(v,n),coverage);}
 return vec4f(clay,1.);
}`;
function vertices(actor,parts=actor.parts){
 const items=parts.slice().sort((a,b)=>rank(a.mesh)-rank(b.mesh));
 function rank(mesh){return mesh.userData.study?4:mesh.name==='folded'?2:mesh.name==='wing'?3:mesh.geometry.userData.vanes?1:0;}
 const count=items.reduce((n,p)=>n+p.mesh.geometry.attributes.position.count,0);
 const packed=new Float32Array(count*22),ints=new Uint32Array(packed.buffer);
 const indices=new Uint32Array(items.reduce((n,p)=>n+p.mesh.geometry.index.count,0)),runs=[0,0,0,0,0];
 let v=0,k=0;
 for(const {mesh} of items){
   const g=mesh.geometry,{position,normal,skinIndex,skinWeight}=g.attributes;
   const fold=g.morphAttributes.position?.[0],lift=g.morphAttributes.position?.[1],fn=g.morphAttributes.normal?.[0];
   const surface=surfaceAttribute(mesh,actor.level).array;
   for(let i=0;i<position.count;i++){
     const o=(v+i)*22;
     for(let j=0;j<3;j++){
       packed[o+j]=position.array[i*3+j];packed[o+3+j]=normal.array[i*3+j];
       if(fold){packed[o+8+j]=fold.array[i*3+j];packed[o+11+j]=fn.array[i*3+j];packed[o+14+j]=lift.array[i*3+j];}
     }
     packed.set(surface.subarray(i*4,i*4+4),o+18);
     ints[o+6]=skinIndex.getX(i)|(skinIndex.getY(i)<<8);packed[o+7]=skinWeight.getX(i);
     packed[o+17]=mesh.userData.clayTone??1;
   }
   for(const id of g.index.array)indices[k++]=id+v;
   runs[rank(mesh)]+=g.index.count;v+=position.count;
 }
 return {packed,indices,runs};
}
export class MotionStudio {
 constructor(parent,study=null){
   this.study=study;
   this.canvas=document.createElement('canvas');this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
   parent.insertAdjacentElement('afterend',this.canvas);this.cpuCanvas=this.canvas.getContext('2d');
   this.ready=this.init();this.ready.catch(e=>{this.error=e;console.error(e);});
 }
 async init(){
   const adapter=await navigator.gpu?.requestAdapter();
   if(!adapter)throw Error('WebGPU adapter unavailable for motion inspection.');
   this.device=await adapter.requestDevice({requiredFeatures:this.study&&adapter.features.has('timestamp-query')?['timestamp-query']:[]});const d=this.device;
   this.adapter=adapter.info?.description||adapter.info?.architecture||adapter.info?.vendor||'WebGPU';
   d.addEventListener('uncapturederror',e=>{this.error=e.error;console.error(e.error);});
   this.frame=d.createBuffer({size:176,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   this.palette=d.createBuffer({size:128*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   const module=d.createShaderModule({code:shader+(this.study?.shader??'')});
   const messages=await module.getCompilationInfo();if(messages.messages.some(m=>m.type==='error'))throw Error(messages.messages.map(m=>m.message).join('\n'));
   const depthStencil={format:'depth24plus',depthCompare:'less',depthWriteEnabled:true};
   const attr=['float32x3','float32x3','uint32','float32','float32x3','float32x3','float32x3','float32','float32x4'];
   const layout=d.createBindGroupLayout({entries:[
    {binding:0,visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,buffer:{}},
    {binding:1,visibility:GPUShaderStage.VERTEX,buffer:{type:'read-only-storage'}},
    {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},
    {binding:3,visibility:GPUShaderStage.FRAGMENT,sampler:{}},...(this.study?.layout??[])
   ]});
   const modelLayout=d.createPipelineLayout({bindGroupLayouts:[layout]});
   const vertex={module,entryPoint:'vs',buffers:[{arrayStride:88,attributes:attr.map((format,i)=>({shaderLocation:i,format,offset:[0,12,24,28,32,44,56,68,72][i]}))}]};
   const pipeline=(finished,plumage,entryPoint='fs')=>d.createRenderPipeline({layout:modelLayout,vertex,
     fragment:{module,entryPoint,constants:entryPoint==='fs'?{finished,plumage}:{},targets:[{format:'rgba8unorm'}]},primitive:{cullMode:'none'},multisample:{count:4,alphaToCoverageEnabled:plumage},depthStencil});
   this.clay=pipeline(false,false);this.skin=pipeline(true,false);this.feathers=pipeline(true,true);
   if(this.study)await this.study.init(d,pipeline,modelLayout,vertex);
   this.floor=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'floorVS'},fragment:{module,entryPoint:'floorFS',targets:[{format:'rgba8unorm'}]},multisample:{count:4},depthStencil});
   this.bind=d.createBindGroup({layout,entries:[{binding:0,resource:{buffer:this.frame}},{binding:1,resource:{buffer:this.palette}},{binding:2,resource:studioTile(d)},{binding:3,resource:d.createSampler({addressModeU:"repeat",addressModeV:"repeat",minFilter:"linear",magFilter:"linear",mipmapFilter:"linear"})},...(this.study?.bindings??[])]});
   this.floorBind=d.createBindGroup({layout:this.floor.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frame}}]});
   this.initialized=true;
 }
 async draw(actor,camera,width,height){
   await this.ready;if(this.error)throw this.error;
   const d=this.device;
   if(this.actor!==actor||this.lod!==actor.level){
     this.vb?.destroy();this.ib?.destroy();const {packed,indices,runs}=vertices(actor,this.study?.parts(actor));this.runs=runs;
     const upload=(data,usage)=>{const b=d.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(b,0,data);return b;};
     this.vb=upload(packed,GPUBufferUsage.VERTEX);this.ib=upload(indices,GPUBufferUsage.INDEX);this.actor=actor;this.lod=actor.level;
   }
   if(width!==this.width||height!==this.height){
     this.samples?.destroy();this.color?.destroy();this.depth?.destroy();this.buffer?.destroy();
     this.width=this.canvas.width=width;this.height=this.canvas.height=height;
     this.color=d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
     this.samples=d.createTexture({size:[width,height],sampleCount:4,format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT});
     this.depth=d.createTexture({size:[width,height],sampleCount:4,format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
     this.stride=Math.ceil(width/64)*256;this.buffer=d.createBuffer({size:this.stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     this.image=new ImageData(width,height);
   }
   actor.root.updateMatrixWorld(true);actor.rig.skeleton.update();camera.updateMatrixWorld(true);
   const data=new Float32Array(44);
   data.set(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements);
   const wing=actor.rig.groups.wing[0].mesh;
   data.set(camera.position.toArray(),40);data.set(wing.morphTargetInfluences,16);data.set(actor.root.position.toArray(),20);data[18]=Number(this.finish);data[19]=Number(this.woodland);
   actor.contacts.forEach((c,i)=>data.set(c.footWorld.toArray(),24+i*4));
   d.queue.writeBuffer(this.frame,0,data);d.queue.writeBuffer(this.palette,0,actor.rig.skeleton.boneMatrices);
   const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({...this.study?.passDescriptor,colorAttachments:[{view:this.samples.createView(),resolveTarget:this.color.createView(),loadOp:'clear',storeOp:'discard',clearValue:[.21,.23,.24,1]}],
     depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'discard'}});
   pass.setPipeline(this.floor);pass.setBindGroup(0,this.floorBind);pass.draw(6);
   const [skin,tract,closed,open]=this.runs;
   pass.setPipeline(this.finish?this.skin:this.clay);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.vb);pass.setIndexBuffer(this.ib,'uint32');
   pass.drawIndexed(skin);
   if(this.finish)pass.setPipeline(this.feathers);
   if(wing.visible){pass.drawIndexed(tract,1,skin);pass.drawIndexed(open,1,skin+tract+closed);}
   else pass.drawIndexed(tract+closed,1,skin);
   const studyCount=this.runs[4];
   if(studyCount){pass.setPipeline(this.study.pipeline);pass.drawIndexed(studyCount,1,skin+tract+closed+open);}
   this.triangles=(skin+tract+(wing.visible?open:closed)+studyCount)/3;pass.end();
   const copy=this.study?.profile?await this.study.finishPass(d,encoder):encoder;
   copy.copyTextureToBuffer({texture:this.color},{buffer:this.buffer,bytesPerRow:this.stride},[width,height]);
   d.queue.submit([copy.finish()]);await this.buffer.mapAsync(GPUMapMode.READ);
   this.study?.mapped();
   const bytes=new Uint8Array(this.buffer.getMappedRange());
   if(this.stride===width*4)this.image.data.set(bytes);else for(let i=0;i<height;i++)this.image.data.set(bytes.subarray(i*this.stride,i*this.stride+width*4),i*width*4);
   this.buffer.unmap();this.cpuCanvas.putImageData(this.image,0,0);await this.study?.presented();
 }
}
