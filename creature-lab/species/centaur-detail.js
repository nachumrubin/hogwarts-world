// Tileable linear material data: follicle height, pigment grain, short-coat
// fibres and long-hair fibres. Bake once per lab, then filter normally at all LODs.
import * as T from '../vendor/three.module.js';
const size=512;
const kernel=`
@group(0) @binding(0) var<storage,read_write> field:array<u32>;
fn hash(p:vec2i,n:i32)->f32{
  let q=vec2u((p%vec2i(n)+vec2i(n))%vec2i(n));
  var h=q.x*3266489917u+q.y*668265263u+374761393u;
  h=(h^(h>>13u))*1274126177u;
  return f32(h^(h>>16u))/4294967295.;
}
fn noise(p:vec2f,n:i32,ny:i32)->f32{
 let g=vec2i(n,ny);let i=(vec2i(floor(p))%g+g)%g;let f=fract(p);let w=f*f*(3.-2.*f);
 return mix(mix(hash(i,n),hash((i+vec2i(1,0))%g,n),w.x),
            mix(hash((i+vec2i(0,1))%g,n),hash((i+vec2i(1,1))%g,n),w.x),w.y);
}
@compute @workgroup_size(8,8)
fn bake(@builtin(global_invocation_id) id:vec3u){
 let uv=(vec2f(id.xy)+.5)/512.;let p=uv*41.;let i=vec2i(floor(p));var d=2.;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
  let j=i+vec2i(x,y);let center=vec2f(j)+.12+.76*vec2f(hash(j,41),hash(j+vec2i(17,19),41));
  d=min(d,length(p-center));
 }}
 let grain=noise(uv*128.,128,128);
 let pores=.76-.65*exp(-d*d*31.)+.12*grain;
 let warp=(noise(uv*8.,8,8)-.5)*1.8;
 let fur=noise(vec2f(uv.x*192.+warp,uv.y*14.),192,14);
 let silk=noise(vec2f(uv.x*224.+warp*.45,uv.y*4.),224,4);
 field[id.y*512u+id.x]=pack4x8unorm(vec4f(pores,grain,fur,silk));
}`;
let field,ready;
function fallback(){
 const pixels=new Uint8Array(size*size*4);
 let seed=29441;
 for(let i=0;i<pixels.length;i+=4){
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const x=(i/4)%size,y=Math.floor(i/(4*size)),v=seed>>>24;
   pixels[i]=v>235?75:174+v*.24;pixels[i+1]=v;
   pixels[i+2]=128+79*Math.sin(x*1.91+Math.sin(y*.12+x*.17));
   pixels[i+3]=128+84*Math.cos(x*2.33+.5*Math.sin(y*.07+x*.23));
 }
 return pixels;
}
async function bake(texture){
 const adapter=await globalThis.navigator?.gpu?.requestAdapter();
 if(!adapter)return 'procedural fallback';
 const device=await adapter.requestDevice();
 let output,staging;
 try{
   const module=device.createShaderModule({code:kernel});
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'bake'}});
   const bytes=size*size*4;
   output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
   staging=device.createBuffer({size:bytes,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:output}}]});
   const cmd=device.createCommandEncoder(),pass=cmd.beginComputePass();
   pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(size/8,size/8);pass.end();
   cmd.copyBufferToBuffer(output,0,staging,0,bytes);device.queue.submit([cmd.finish()]);
   await staging.mapAsync(GPUMapMode.READ);
   texture.image.data=new Uint8Array(staging.getMappedRange()).slice();texture.needsUpdate=true;
   return 'WebGPU/WGSL';
 }finally{output?.destroy();staging?.destroy();device.destroy();}
}
export function centaurDetail(){
 if(!field){
   field=new T.DataTexture(fallback(),size,size);
   field.wrapS=field.wrapT=T.RepeatWrapping;field.generateMipmaps=true;
   field.minFilter=T.LinearMipmapLinearFilter;field.magFilter=T.LinearFilter;field.needsUpdate=true;
   ready=bake(field).catch(error=>{console.warn('Centaur material bake:',error);return 'procedural fallback';});
 }
 return {field,ready};
}
