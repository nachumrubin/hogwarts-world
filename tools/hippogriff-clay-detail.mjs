// Depth-matched WGSL relief over the clay pass. Feather coordinates
// are distances across and along each shaft. Hair coordinates wrap each lock.
export function addClayDetail(device,encoder,meshes,frame,color,depth){
 const parts=meshes.filter(m=>m.detail);
 if(!parts.length)return;
 const vertexCount=parts.reduce((sum,m)=>sum+m.vertexCount,0);
 const indexCount=parts.reduce((sum,m)=>sum+m.indices.length,0);
 const data=new Float32Array(6*vertexCount),indices=new Uint32Array(indexCount);
 let vertex=0,index=0;
 for(const mesh of parts){
   const pos=new Float32Array(mesh.vertices);
   for(let i=0;i<mesh.vertexCount;i++){
     const j=6*(vertex+i);
     data[j]=pos[4*i];data[j+1]=pos[4*i+1];data[j+2]=pos[4*i+2];
     data[j+3]=mesh.detail[3*i];data[j+4]=mesh.detail[3*i+1];data[j+5]=mesh.detail[3*i+2];
   }
   for(const id of mesh.indices)indices[index++]=vertex+id;
   vertex+=mesh.vertexCount;
 }
 function upload(array,usage){
   const buffer=device.createBuffer({size:array.byteLength,usage:usage|GPUBufferUsage.COPY_DST});
   device.queue.writeBuffer(buffer,0,array);return buffer;
 }
 const vb=upload(data,GPUBufferUsage.VERTEX),ib=upload(indices,GPUBufferUsage.INDEX);
 const module=device.createShaderModule({code:`
 @group(0) @binding(0) var<uniform> vp:mat4x4f;
 struct Sample { @builtin(position) p:vec4f, @location(0) detail:vec3f };
 @vertex fn vs(@location(0) p:vec3f,@location(1) detail:vec3f)->Sample {
   return Sample(vp*vec4f(p,1.),detail);
 }
 fn relief(phase:f32)->f32 {
   return sin(6.2831853*phase)*(1.-smoothstep(.19,.50,fwidth(phase)));
 }
 @fragment fn fs(v:Sample)->@location(0) vec4f {
   let s=v.detail.x;let t=v.detail.y;
   let vane=t*121.-abs(s)*(72.+9.*sin(25.*t))+0.19*sin(173.*s+21.*t);
   let barb=relief(vane)*smoothstep(.0004,.003,abs(s));
   let hair=relief(21.*s+0.36*sin(7.*t+3.*s));
   // Imbricated dorsal shields taper out at the sides of each toe.
   // Small staggered cells fill the flanks, with a smooth horn sheath distally.
   let a=abs(s);let front=1.-smoothstep(.78,1.45,a);
   let band=t*14.3+.32*sin(s)*sin(s);
   let edge=abs(fract(band+.5)-.5);
   let fw=max(.012,fwidth(band));
   let groove=(1.-smoothstep(.045-fw,.075+fw,edge))*(1.-smoothstep(.15,.45,fw));
   let cells=relief(t*28.+.36*cos(9.*s))*.36+relief(8.*s+.33*cos(120.*t))*.24;
   let toe=mix(.09*cells,-.17*groove,front)*smoothstep(.10,.21,t)*(1.-smoothstep(.73,.80,t));
   let surface=select(select(.070*barb,.10*hair,v.detail.z>1.5),toe,v.detail.z>2.5);
   return vec4f(vec3f(.5+surface),.5);
 }`});
 const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[
   {arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},
     {shaderLocation:1,offset:12,format:'float32x3'}]}]},
   fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm',blend:{
     color:{srcFactor:'dst',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'zero',dstFactor:'one'}}}]},
   primitive:{cullMode:'back'},depthStencil:{format:'depth32float',depthWriteEnabled:false,depthCompare:'equal'}});
 const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:frame}}]});
 const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'load',storeOp:'store'}],
   depthStencilAttachment:{view:depth.createView(),depthReadOnly:true}});
 pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.setVertexBuffer(0,vb);
 pass.setIndexBuffer(ib,'uint32');pass.drawIndexed(indexCount);pass.end();
}
