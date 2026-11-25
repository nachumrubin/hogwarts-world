// Live motion-inspection renderer. The C.4 vertex/index streams are uploaded
// once per selected actor/LOD. Both renderers use the actor's skin palette.
import * as T from './vendor/three.module.js';
const shader=`
struct Frame { vp:mat4x4f, motion:vec4f, root:vec4f, feet:array<vec4f,4> };
@group(0) @binding(0) var<uniform> f:Frame;
@group(0) @binding(1) var<storage,read> bone:array<mat4x4f>;
struct In { @location(0) p:vec3f,@location(1) n:vec3f,@location(2) ids:u32,@location(3) w:f32,
 @location(4) fold:vec3f,@location(5) fnorm:vec3f,@location(6) lift:vec3f,@location(7) tint:f32 };
struct Out { @builtin(position) pos:vec4f,@location(0) n:vec3f,@location(1) world:vec3f,@location(2) tint:f32 };
fn clip(p:vec3f)->vec4f {let q=f.vp*vec4f(p,1.);return vec4f(q.xy,(q.z+q.w)*.5,q.w);}
@vertex fn vs(v:In)->Out{
 let skin=bone[v.ids&255u]*v.w+bone[(v.ids>>8u)&255u]*(1.-v.w);
 let p=(skin*vec4f(v.p+f.motion.x*v.fold+f.motion.y*v.lift,1.)).xyz;
 let n=(skin*vec4f(v.n+f.motion.x*v.fnorm,0.)).xyz;
 return Out(clip(p),n,p,v.tint);
}
@vertex fn floorVS(@builtin(vertex_index) i:u32)->Out{
 let corners=array<vec2f,6>(vec2f(-1,-1),vec2f(1,1),vec2f(1,-1),vec2f(-1,-1),vec2f(-1,1),vec2f(1,1));
 let p=vec3f(f.root.x,0.,f.root.z)+vec3f(corners[i].x,0.,corners[i].y)*70.;
 return Out(clip(p),vec3f(0,1,0),p,1.);
}
@fragment fn floorFS(v:Out)->@location(0) vec4f{
 let uv=v.world.xz;let grid=abs(fract(uv+.5)-.5)/max(fwidth(uv),vec2f(.0001));
 let lines=1.-smoothstep(.2,1.3,min(grid.x,grid.y));
 let delta=uv-f.root.xz;
 var shade=.16*exp(-dot(delta,delta)/2.8)*exp(-.45*f.root.y);
 for(var i=0;i<4;i++){
  let r=uv-f.feet[i].xz;shade+=.27*exp(-dot(r,r)/.028)*exp(-9.*max(f.feet[i].y,0.));
 }
 let fade=exp(-.065*length(delta));
 return vec4f(mix(vec3f(.21,.23,.24),vec3f(.48,.49,.48)-shade-lines*.063,fade),1.);
}
@fragment fn fs(v:Out,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let n=normalize(v.n)*select(-1.,1.,front);
 let key=max(0.,dot(n,normalize(vec3f(-.46,.78,.55))));
 let rim=max(0.,dot(n,normalize(vec3f(.58,.48,-.72))));
 let clay=vec3f(.79,.774,.744)*v.tint*(.42+.12*n.y+.44*key+.14*rim);
 return vec4f(clay,1.);
}`;
function vertices(actor){
 const items=actor.parts.slice().sort((a,b)=>rank(a.mesh)-rank(b.mesh));
 function rank(mesh){return mesh.name==='folded'?1:mesh.name==='wing'?2:0;}
 const count=items.reduce((n,p)=>n+p.mesh.geometry.attributes.position.count,0);
 const packed=new Float32Array(count*18),ints=new Uint32Array(packed.buffer);
 const indices=new Uint32Array(items.reduce((n,p)=>n+p.mesh.geometry.index.count,0)),runs=[0,0,0];
 let v=0,k=0;
 for(const {mesh} of items){
   const g=mesh.geometry,{position,normal,skinIndex,skinWeight}=g.attributes;
   const fold=g.morphAttributes.position?.[0],lift=g.morphAttributes.position?.[1],fn=g.morphAttributes.normal?.[0];
   for(let i=0;i<position.count;i++){
     const o=(v+i)*18;
     for(let j=0;j<3;j++){
       packed[o+j]=position.array[i*3+j];packed[o+3+j]=normal.array[i*3+j];
       if(fold){packed[o+8+j]=fold.array[i*3+j];packed[o+11+j]=fn.array[i*3+j];packed[o+14+j]=lift.array[i*3+j];}
     }
     ints[o+6]=skinIndex.getX(i)|(skinIndex.getY(i)<<8);packed[o+7]=skinWeight.getX(i);
     packed[o+17]=mesh.userData.clayTone??1;
   }
   for(const id of g.index.array)indices[k++]=id+v;
   runs[rank(mesh)]+=g.index.count;v+=position.count;
 }
 return {packed,indices,runs};
}
export class MotionStudio {
 constructor(parent){
   this.canvas=document.createElement('canvas');this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
   parent.insertAdjacentElement('afterend',this.canvas);this.cpuCanvas=this.canvas.getContext('2d');
   this.ready=this.init();this.ready.catch(e=>{this.error=e;console.error(e);});
 }
 async init(){
   const adapter=await navigator.gpu?.requestAdapter();
   if(!adapter)throw Error('WebGPU adapter unavailable for motion inspection.');
   this.device=await adapter.requestDevice();const d=this.device;
   this.adapter=adapter.info?.description||adapter.info?.architecture||adapter.info?.vendor||'WebGPU';
   d.addEventListener('uncapturederror',e=>{this.error=e.error;console.error(e.error);});
   this.frame=d.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
   this.palette=d.createBuffer({size:128*64,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
   const module=d.createShaderModule({code:shader});
   const messages=await module.getCompilationInfo();if(messages.messages.some(m=>m.type==='error'))throw Error(messages.messages.map(m=>m.message).join('\n'));
   const depthStencil={format:'depth24plus',depthCompare:'less',depthWriteEnabled:true};
   const attr=['float32x3','float32x3','uint32','float32','float32x3','float32x3','float32x3','float32'];
   this.model=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:72,attributes:attr.map((format,i)=>({shaderLocation:i,format,offset:[0,12,24,28,32,44,56,68][i]}))}]},
     fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{cullMode:'back'},depthStencil});
   this.floor=d.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'floorVS'},fragment:{module,entryPoint:'floorFS',targets:[{format:'rgba8unorm'}]},depthStencil});
   this.bind=d.createBindGroup({layout:this.model.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frame}},{binding:1,resource:{buffer:this.palette}}]});
   this.floorBind=d.createBindGroup({layout:this.floor.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.frame}}]});
   this.initialized=true;
 }
 async draw(actor,camera,width,height){
   await this.ready;if(this.error)throw this.error;
   const d=this.device;
   if(this.actor!==actor||this.lod!==actor.level){
     this.vb?.destroy();this.ib?.destroy();const {packed,indices,runs}=vertices(actor);this.runs=runs;
     const upload=(data,usage)=>{const b=d.createBuffer({size:data.byteLength,usage:usage|GPUBufferUsage.COPY_DST});d.queue.writeBuffer(b,0,data);return b;};
     this.vb=upload(packed,GPUBufferUsage.VERTEX);this.ib=upload(indices,GPUBufferUsage.INDEX);this.actor=actor;this.lod=actor.level;
   }
   if(width!==this.width||height!==this.height){
     this.color?.destroy();this.depth?.destroy();this.buffer?.destroy();
     this.width=this.canvas.width=width;this.height=this.canvas.height=height;
     this.color=d.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
     this.depth=d.createTexture({size:[width,height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});
     this.stride=Math.ceil(width/64)*256;this.buffer=d.createBuffer({size:this.stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
     this.image=new ImageData(width,height);
   }
   actor.root.updateMatrixWorld(true);actor.rig.skeleton.update();camera.updateMatrixWorld(true);
   const data=new Float32Array(40);
   data.set(new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements);
   const wing=actor.rig.groups.wing[0].mesh;
   data.set(wing.morphTargetInfluences,16);data.set(actor.root.position.toArray(),20);
   actor.contacts.forEach((c,i)=>data.set(c.footWorld.toArray(),24+i*4));
   d.queue.writeBuffer(this.frame,0,data);d.queue.writeBuffer(this.palette,0,actor.rig.skeleton.boneMatrices);
   const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.color.createView(),loadOp:'clear',storeOp:'store',clearValue:[.21,.23,.24,1]}],
     depthStencilAttachment:{view:this.depth.createView(),depthLoadOp:'clear',depthClearValue:1,depthStoreOp:'discard'}});
   pass.setPipeline(this.floor);pass.setBindGroup(0,this.floorBind);pass.draw(6);
   pass.setPipeline(this.model);pass.setBindGroup(0,this.bind);pass.setVertexBuffer(0,this.vb);pass.setIndexBuffer(this.ib,'uint32');
   const [base,closed,open]=this.runs;
   if(wing.visible){pass.drawIndexed(base);pass.drawIndexed(open,1,base+closed);}else pass.drawIndexed(base+closed);
   this.triangles=(base+(wing.visible?open:closed))/3;pass.end();
   encoder.copyTextureToBuffer({texture:this.color},{buffer:this.buffer,bytesPerRow:this.stride},[width,height]);
   d.queue.submit([encoder.finish()]);await this.buffer.mapAsync(GPUMapMode.READ);
   const bytes=new Uint8Array(this.buffer.getMappedRange());
   if(this.stride===width*4)this.image.data.set(bytes);else for(let i=0;i<height;i++)this.image.data.set(bytes.subarray(i*this.stride,i*this.stride+width*4),i*width*4);
   this.buffer.unmap();this.cpuCanvas.putImageData(this.image,0,0);
 }
}
