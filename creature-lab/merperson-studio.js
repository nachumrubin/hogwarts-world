// Textured inspection pass for the imported merperson. Habitat rendering and
// its effects remain on the normal Lab path.
import * as T from './vendor/three.module.js';
const shader=`
struct Frame { vp:mat4x4f, eye:vec4f, factors:vec4f };
@group(0) @binding(0) var<uniform> frame:Frame;
@group(0) @binding(1) var<storage,read> palette:array<mat4x4f>;
@group(0) @binding(2) var texSampler:sampler;
@group(0) @binding(3) var albedo:texture_2d<f32>;
@group(0) @binding(4) var packed:texture_2d<f32>;
@group(0) @binding(5) var normalMap:texture_2d<f32>;
struct Out { @builtin(position) clip:vec4f, @location(0) pos:vec3f,
  @location(1) n:vec3f, @location(2) uv:vec2f };
@vertex fn vs(@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,
  @location(3) ids:vec4u,@location(4) w:vec4f)->Out {
  let skin=palette[ids.x]*w.x+palette[ids.y]*w.y+palette[ids.z]*w.z+palette[ids.w]*w.w;
  let world=skin*vec4f(p,1);
  let q=frame.vp*world;
  return Out(vec4f(q.xy,(q.z+q.w)*.5,q.w),world.xyz,(skin*vec4f(n,0)).xyz,uv);
}
fn brdf(n:vec3f,v:vec3f,l:vec3f,c:vec3f,f0:vec3f,r:f32)->vec3f {
  let h=normalize(v+l);
  let nl=max(dot(n,l),0.);
  let nv=max(dot(n,v),.001);
  let nh=max(dot(n,h),0.);
  let vh=max(dot(v,h),0.);
  let a=r*r;
  let d=a*a/(3.14159*pow(nh*nh*(a*a-1.)+1.,2.));
  let k=(r+1.)*(r+1.)*.125;
  let g=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);
  let f=f0+(1.-f0)*pow(1.-vh,5.);
  return nl*(c*(1.-f)/3.14159+d*g*f/max(4.*nv*nl,.001));
}
@fragment fn fs(i:Out,@builtin(front_facing) front:bool)->@location(0) vec4f {
  let n=normalize(i.n)*select(-1.,1.,front);
  let du=dpdx(i.uv); let dv=-dpdy(i.uv);
  let px=dpdx(i.pos); let py=-dpdy(i.pos);
  let t=cross(py,n)*du.x+cross(n,px)*dv.x;
  let b=cross(py,n)*du.y+cross(n,px)*dv.y;
  let span=inverseSqrt(max(max(dot(t,t),dot(b,b)),1e-12));
  let mapN=textureSample(normalMap,texSampler,i.uv).xyz*2.-1.;
  let N=normalize(n*mapN.z+span*(t*mapN.x+b*mapN.y));
  let c=textureSample(albedo,texSampler,i.uv).rgb;
  let mr=textureSample(packed,texSampler,i.uv).gb*frame.factors.xy;
  let r=max(mr.x,.06);
  let f0=mix(vec3f(.04),c,mr.y);
  let v=normalize(frame.eye.xyz-i.pos);
  let diffuse=c*(1.-mr.y);
  let lit=diffuse*(.22+.15*N.y)+f0*.14+
    brdf(N,v,normalize(vec3f(-.55,.74,.71)),diffuse,f0,r)*vec3f(2.8,2.63,2.48)+
    brdf(N,v,normalize(vec3f(.86,.38,-.52)),diffuse,f0,r)*vec3f(1.18,1.50,1.76);
  let tone=clamp((lit*(2.51*lit+.03))/(lit*(2.43*lit+.59)+.14),vec3f(0),vec3f(1));
  return vec4f(select(1.055*pow(tone,vec3f(1./2.4))-.055,tone*12.92,tone<vec3f(.0031308)),1);
}`;

export class MerpersonStudio {
  constructor(parent) {
    this.canvas=document.createElement('canvas');
    this.canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none';
    parent.insertAdjacentElement('afterend',this.canvas);
    this.ready=this.init();
  }

  async init() {
    const adapter=await navigator.gpu?.requestAdapter();
    if(!adapter) throw Error('Native WebGPU unavailable for merperson inspection.');
    this.adapter=adapter.info?.description||adapter.info?.architecture||'WebGPU';
    const d=this.device=await adapter.requestDevice();
    d.lost.then(()=>{this.available=false});
    d.addEventListener('uncapturederror',event=>{
      this.available=false;
      console.warn(event.error);
    });
    // Like the existing MotionStudio, present a readback into a 2D canvas.
    // This keeps capture support and avoids requiring a WebGPU swap chain.
    this.context=this.canvas.getContext('2d');
    const format='rgba8unorm';
    const module=d.createShaderModule({code:shader});
    this.pipeline=await d.createRenderPipelineAsync({layout:'auto',
      vertex:{module,entryPoint:'vs',buffers:['float32x3','float32x3','float32x2','uint16x4','float32x4'].map((format,shaderLocation)=>({
        arrayStride:[12,12,8,8,16][shaderLocation],attributes:[{format,shaderLocation,offset:0}]
      }))},
      fragment:{module,entryPoint:'fs',targets:[{format}]},multisample:{count:4},
      depthStencil:{format:'depth24plus',depthWriteEnabled:true,depthCompare:'less'}});
    this.format=format;
    this.sampler=d.createSampler({addressModeU:'repeat',addressModeV:'repeat',magFilter:'linear',minFilter:'linear',mipmapFilter:'linear',maxAnisotropy:4});
    this.available=true;
  }

  releaseAsset() {
    for(const resource of this.resources??[])resource.destroy();
    this.geometry=null;
    this.resources=[];

  }

  upload(actor) {
    this.releaseAsset();
    const d=this.device,{geometry,skeleton}=actor.model;
    this.geometry=geometry;
    this.resources=[];
    const buffer=(size,usage,data)=>{
      const b=d.createBuffer({size,usage:usage|GPUBufferUsage.COPY_DST});
      if(data)d.queue.writeBuffer(b,0,data);
      this.resources.push(b);
      return b;
    };
    this.vertices=['position','normal','uv','skinIndex','skinWeight'].map(name=>{
      const data=geometry.attributes[name].array;
      return buffer(data.byteLength,GPUBufferUsage.VERTEX,data);
    });
    this.index=buffer(geometry.index.array.byteLength,GPUBufferUsage.INDEX,geometry.index.array);
    const textures=actor.textures.map(({image},i)=>{
      const mipLevelCount=1+Math.floor(Math.log2(Math.max(image.width,image.height)));
      const texture=d.createTexture({size:[image.width,image.height],mipLevelCount,
        format:i===0?'rgba8unorm-srgb':'rgba8unorm',
        usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      const scratch=document.createElement('canvas'),ctx=scratch.getContext('2d',{willReadFrequently:true});
      ctx.imageSmoothingQuality='high';
      for(let mipLevel=0;mipLevel<mipLevelCount;mipLevel++) {
        const width=Math.max(1,image.width>>mipLevel),height=Math.max(1,image.height>>mipLevel);
        scratch.width=width;scratch.height=height;
        ctx.drawImage(image,0,0,width,height);
        const {data}=ctx.getImageData(0,0,width,height);
        d.queue.writeTexture({texture,mipLevel},data,{bytesPerRow:width*4},[width,height]);
      }
      this.resources.push(texture);
      return texture;
    });
    this.instances=Array.from({length:2},()=>{
      const frame=buffer(96,GPUBufferUsage.UNIFORM),palette=buffer(skeleton.bones.length*64,GPUBufferUsage.STORAGE);
      const bind=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[
        {binding:0,resource:{buffer:frame}},{binding:1,resource:{buffer:palette}},{binding:2,resource:this.sampler},
        ...textures.map((texture,i)=>({binding:i+3,resource:texture.createView()}))
      ]});
      return {frame,palette,bind};
    });
  }

  async draw(actor,extra,camera,width,height) {
    if(!width||!height)return;
    if(this.geometry!==actor.model.geometry)this.upload(actor);
    const d=this.device;
    if(width!==this.canvas.width||height!==this.canvas.height||!this.depth) {
      this.depth?.destroy();this.color?.destroy();this.output?.destroy();this.readback?.destroy();
      this.canvas.width=width;this.canvas.height=height;
      const attachment=format=>d.createTexture({size:[width,height],sampleCount:4,format,usage:GPUTextureUsage.RENDER_ATTACHMENT});
      this.depth=attachment('depth24plus');this.color=attachment(this.format);
      this.output=d.createTexture({size:[width,height],format:this.format,
        usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
      this.stride=Math.ceil(width*4/256)*256;
      this.readback=d.createBuffer({size:this.stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
      this.image=new ImageData(width,height);
    }
    camera.updateMatrixWorld(true);
    const vp=new T.Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    const encoder=d.createCommandEncoder();
    const pass=encoder.beginRenderPass({colorAttachments:[{view:this.color.createView(),
      resolveTarget:this.output.createView(),clearValue:[.16,.19,.20,1],
      loadOp:'clear',storeOp:'discard'}],depthStencilAttachment:{view:this.depth.createView(),depthClearValue:1,
      depthLoadOp:'clear',depthStoreOp:'discard'}});
    pass.setPipeline(this.pipeline);
    this.vertices.forEach((buffer,i)=>pass.setVertexBuffer(i,buffer));
    pass.setIndexBuffer(this.index,'uint32');
    const actors=extra?[actor,extra]:[actor],matrix=new T.Matrix4();
    for(const [i,specimen] of actors.entries()){
      const mesh=specimen.model,{frame,palette,bind}=this.instances[i];
      specimen.root.updateMatrixWorld(true);
      mesh.skeleton.update();
      // The WebGL path may pad boneMatrices for a square bone texture.
      const matrices=mesh.skeleton.boneMatrices.slice(0,mesh.skeleton.bones.length*16);
      for(let offset=0;offset<matrices.length;offset+=16){
        // The mesh uses Three's attached bind mode. Its current world matrix
        // cancels the inverse bind matrix before multiplication by the view.
        matrix.fromArray(matrices,offset).multiply(mesh.bindMatrix).toArray(matrices,offset);
      }
      d.queue.writeBuffer(palette,0,matrices);
      const data=new Float32Array(24);
      vp.toArray(data);camera.position.toArray(data,16);
      data.set([mesh.material.roughness,mesh.material.metalness],20);
      d.queue.writeBuffer(frame,0,data);
      pass.setBindGroup(0,bind);
      pass.drawIndexed(this.geometry.index.count);
    }
    pass.end();
    encoder.copyTextureToBuffer({texture:this.output},{buffer:this.readback,bytesPerRow:this.stride},[width,height]);
    d.queue.submit([encoder.finish()]);
    await this.readback.mapAsync(GPUMapMode.READ);
    const pixels=new Uint8Array(this.readback.getMappedRange());
    for(let row=0;row<height;row++)this.image.data.set(pixels.subarray(row*this.stride,row*this.stride+width*4),row*width*4);
    this.readback.unmap();
    this.context.putImageData(this.image,0,0);
    this.drawCalls=actors.length;
    this.triangles=this.geometry.index.count/3*actors.length;
  }
}
