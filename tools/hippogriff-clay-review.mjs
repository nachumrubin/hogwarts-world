// Bundle with esbuild as a browser ESM before serving (the world pipeline is TypeScript).
// Browser entry for the C.1 plates. Submit the lab's generated triangles to
// the world's native WebGPU prop renderer, retaining normals and handedness.
import {Hippogriff} from '../creature-lab/species/hippogriff.js';
import {Vector3,Matrix3} from '../creature-lab/vendor/three.module.js';
import {PropRenderer} from '../src/gpu/prop-renderer.ts';
import {GpuContext} from '../src/gpu/gpu-context.js';
import {FRAME_FLOATS} from '../src/gpu/shaders/common.wgsl.js';
import {frustumPlanes} from '../src/core/math.js';

function pack(node){
 const geo=node.geometry,p=geo.attributes.position,n=geo.attributes.normal;
 const vertices=new ArrayBuffer(16*p.count),pos=new Float32Array(vertices),bytes=new Int8Array(vertices);
 const normalMatrix=new Matrix3().getNormalMatrix(node.matrixWorld),v=new Vector3();
 let radius=0,minY=Infinity,maxY=-Infinity;
 for(let i=0;i<p.count;i++){
   v.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld);
   pos.set(v.toArray(),4*i);radius=Math.max(radius,v.length());minY=Math.min(minY,v.y);maxY=Math.max(maxY,v.y);
   v.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix);
   bytes.set(v.toArray().map(x=>Math.round(127*x)),16*i+12);
   bytes[16*i+15]=17; // the prop shader's uniform matte albedo
 }
 const indices=Uint32Array.from(geo.index.array);
 if(node.matrixWorld.determinant()<0)for(let i=0;i<indices.length;i+=3)
   [indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
 return {name:'hippogriff',vertices,indices,vertexCount:p.count,radius,minY,maxY};
}

export async function renderClay(canvas,view,extended){
 const gpu=new GpuContext(canvas),device=await gpu.init();
 const actor=new Hippogriff();actor.update(0,0,extended?'Unfold':'Idle');
 actor.root.updateMatrixWorld(true);
 const meshes=[],instances=[];
 actor.root.traverseVisible(node=>{
   if(!node.isMesh)return;
   const tone=node.material.color.r/.462;
   instances.push({mesh:meshes.length,x:0,y:0,z:0,rot:0,scale:1,tint:[tone*.88,tone*.93,tone]});
   meshes.push(pack(node));
 });
 const frame=device.createBuffer({size:FRAME_FLOATS*4,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const overview=device.createTexture({size:[1,1],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING});
 const width=canvas.width,height=canvas.height;
 const depth=device.createTexture({size:[width,height],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const color=device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});
 const renderer=new PropRenderer(device,{sampleCount:1,colorFormat:'rgba8unorm',depthFormat:'depth32float',
   frameBuffer:frame,overviewView:overview.createView(),sampler:device.createSampler()});
 renderer.setMeshes(meshes);renderer.setInstances(instances);
 const direction=new Vector3(...({front:[0,.045,1],side:[1,.035,0],'three-quarter':extended?[.50,.63,1]:[.83,.185,1]})[view]).normalize();
 const right=new Vector3(0,1,0).cross(direction).normalize(),up=direction.clone().cross(right);
 let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
 const point=new Vector3();
 for(const m of meshes){
   const p=new Float32Array(m.vertices);
   for(let i=0;i<p.length;i+=4){
     point.fromArray(p,i);
     const x=point.dot(right),y=point.dot(up);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
   }
 }
 const span=Math.max((x1-x0)*height/width,y1-y0)*1.13;
 const data=new Float32Array(FRAME_FLOATS),sx=2*height/(width*span),sy=2/span;
 for(let i=0;i<3;i++){
   data[4*i]=right.getComponent(i)*sx;data[4*i+1]=up.getComponent(i)*sy;
   data[4*i+2]=direction.getComponent(i)*.04;
 }
 data[12]=-(x0+x1)*sx/2;data[13]=-(y0+y1)*sy/2;data[14]=.5;data[15]=1;
 const camera=direction.clone().multiplyScalar(12);
 data.set(camera.toArray(),16);data.set([.44,.78,.445,6.8],24);data.set([.14,1,.68,2.1],52);data.set(camera.toArray(),56);
 device.queue.writeBuffer(frame,0,data);
 renderer.update(0,0,frustumPlanes(data,new Float32Array(20)),camera.x,camera.y,camera.z,100);
 const encoder=device.createCommandEncoder();
 const pass=encoder.beginRenderPass({colorAttachments:[{view:color.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}],
   depthStencilAttachment:{view:depth.createView(),depthClearValue:0,depthLoadOp:'clear',depthStoreOp:'store'}});
 renderer.record(pass);pass.end();

 // Contact shading from the same pose's depth buffer. Apply at a fixed
 // physical radius so creases stay consistent when framing the full span.
 const module=device.createShaderModule({code:`
 @group(0) @binding(0) var plate:texture_2d<f32>;
 @group(0) @binding(1) var zbuf:texture_depth_2d;
 @vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{
   let uv=vec2f(f32((i<<1u)&2u),f32(i&2u));return vec4f(uv*2.-1.,0.,1.);
 }
 @fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f{
   let xy=vec2i(p.xy);let d=textureLoad(zbuf,xy,0);
   let size=vec2f(textureDimensions(plate));let uv=p.xy/size;
   if(d==0.){let v=1.-length((uv-vec2f(.49,.44))*vec2f(.87,.68));
      return vec4f(vec3f(.18,.197,.209)+v*vec3f(.12),1.);}
   var occ=0.;
   for(var i=0;i<32;i++){
     let t=(f32(i)+.5)/32.;let a=f32(i)*2.39996;
     let xy2=xy+vec2i(vec2f(cos(a),sin(a))*sqrt(t)*${(height*.105/span).toFixed(4)});
     let dz=(textureLoad(zbuf,xy2,0)-d)*25.;
     occ+=smoothstep(.006,.050,dz)*(1.-smoothstep(.09,.32,dz));
   }
   let radiance=dot(textureLoad(plate,xy,0).rgb,vec3f(.299,.587,.114));
   let base=vec3f(.105+radiance*.88)*(1.-occ/32.*.80);
   return vec4f(pow(base,vec3f(.48))*vec3f(1.015,1.,.977),1.);
 }`});
 const post=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]}});
 const bind=device.createBindGroup({layout:post.getBindGroupLayout(0),entries:[
   {binding:0,resource:color.createView()},{binding:1,resource:depth.createView()}]});
 const output=device.createTexture({size:[width,height],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const stride=Math.ceil(width*4/256)*256;
 const readback=device.createBuffer({size:stride*height,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const final=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store',clearValue:[0,0,0,1]}]});
 final.setPipeline(post);final.setBindGroup(0,bind);final.draw(3);final.end();
 encoder.copyTextureToBuffer({texture:output},{buffer:readback,bytesPerRow:stride},[width,height]);
 device.queue.submit([encoder.finish()]);
 await readback.mapAsync(GPUMapMode.READ);
 const pixels=new Uint8Array(readback.getMappedRange()),image=new ImageData(width,height);
 for(let y=0;y<height;y++)image.data.set(pixels.subarray(y*stride,y*stride+width*4),y*width*4);
 readback.unmap();
 const plate=document.createElement('canvas');plate.width=width;plate.height=height;
 plate.getContext('2d').putImageData(image,0,0);
 const result=plate.toDataURL();
 await device.queue.onSubmittedWorkDone();if(gpu.errors.length)throw Error(gpu.errors.join('\n'));
 actor.dispose();device.destroy();return result;
}
