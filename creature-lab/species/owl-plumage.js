// Colour and short contour tips follow the same sphere coordinates as the
// accepted breast. Geometry is emitted into its existing indexed draw.
import * as T from '../vendor/three.module.js';
export function breastPlumage(lod){
  const g=new T.SphereGeometry(1,[48,30,18][lod],[32,20,12][lod]);
  const coords=g.attributes.position,uv=g.attributes.uv;
  const p=[],tex=Array.from(uv.array),indices=Array.from(g.index.array);
  function surface(x,y,z,lift=0){
    const t=(1+y)/2,skirt=Math.max(0,z)**2*T.MathUtils.clamp((.68-y)/.8,0,1);
    p.push(x*(.051+.022*t+.004*skirt+lift),
      y*.090-.048*z+.151-.023*skirt+lift*(.68*y-.73*z),
      -.036+y*.093+z*.058-.002*t*t+.013*skirt+lift*(.73*y+.68*z));
  }
  for(let i=0;i<coords.count;i++)surface(coords.getX(i),coords.getY(i),coords.getZ(i));
  const count=[232,98,24][lod];
  for(let i=0;i<count;i++){
    const u=(i*.61803398875)%1,v=.15+.70*((i*.754877666)%1);
    const length=.053+.028*(.5+.5*Math.sin(i*6.83));
    const width=.012+.006*(.5+.5*Math.sin(i*3.18));
    const drift=.009*Math.cos(2*Math.PI*u),start=p.length/3;
    for(const along of [0,.58,1])for(const across of [-1,0,1]){
      const s=u+drift*along+width*across*(1-.83*along**2);
      const t=v-length*along+.002*across;
      const theta=(1-t)*Math.PI,phi=s*2*Math.PI;
      const lift=-.0014+.0040*along+.0013*Math.sin(Math.PI*along)*(1-across*across)-.00085*Math.abs(across);
      surface(-Math.cos(phi)*Math.sin(theta),Math.cos(theta),Math.sin(phi)*Math.sin(theta),lift);
      tex.push(s,t);
    }
    for(let j=1;j<3;j++)for(let k=1;k<3;k++){
      const a=start+j*3+k;indices.push(a-4,a-1,a,a-4,a,a-3);
    }
  }
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(tex,2));g.setIndex(indices);
  g.deleteAttribute('normal');g.computeVertexNormals();
  // Blend a lifted hem into the smooth tract beneath it. Coplanar thin
  // edges should catch only a little more light than the adjacent down.
  const normal=g.attributes.normal,baseCount=coords.count,base=normal.array;
  const vane=new T.Vector3(),underlying=new T.Vector3();
  for(let i=baseCount;i<normal.count;i++){
    const col=Math.round(tex[2*i]*g.parameters.widthSegments);
    const row=Math.round((1-tex[2*i+1])*g.parameters.heightSegments);
    const n=3*(row*(g.parameters.widthSegments+1)+(col%g.parameters.widthSegments+g.parameters.widthSegments)%g.parameters.widthSegments);
    const hem=.36;
    vane.fromBufferAttribute(normal,i);underlying.fromArray(base,n);
    if(vane.dot(underlying)<0)vane.negate();
    vane.multiplyScalar(hem).addScaledVector(underlying,1-hem).normalize();
    normal.setXYZ(i,vane.x,vane.y,vane.z);
  }
  return g;
}
