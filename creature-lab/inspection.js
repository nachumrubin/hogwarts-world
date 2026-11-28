import * as T from './vendor/three.module.js';

export const reviewAngles=['front','side','three-quarter','rear'];
export const background=new T.Color(0xe4e3dc);
export function studioLights(){
  const group=new T.Group();
  group.add(new T.HemisphereLight(0xffffff,0xa39c91,1.6));
  const key=new T.DirectionalLight(0xfff7ec,2.25);key.position.set(-4,6,5);
  const rim=new T.DirectionalLight(0xdde9ff,1.25);rim.position.set(4,3,-4);
  group.add(key,rim);return group;
}
export function inspectionMaterials(){
  return {
    neutral:new T.MeshStandardMaterial({color:0xa8a59e,roughness:.82,side:T.DoubleSide}),
    silhouette:new T.MeshBasicMaterial({color:0x202422,toneMapped:false,side:T.DoubleSide})
  };
}

// Render a fresh specimen at a fixed time. All four plates share scale,
// pose, exposure and projection. Capturing never advances the live rig.
export function comparisonPlates(renderer,kind,Model,mode='neutral'){
  const width=640,height=480,aspect=width/height;
  const originalSize=renderer.getSize(new T.Vector2()),ratio=renderer.getPixelRatio();
  const specimen=new Model(),scene=new T.Scene(),materials=inspectionMaterials();
  try{
    scene.background=background;scene.overrideMaterial=materials[mode]||null;
    scene.add(studioLights(),specimen.root);
    const action=({squid:'Rest',owl:'Perch',hippogriff:'Unfold'})[kind]||'Idle';
    for(let i=1;i<=30;i++)specimen.update(1/30,i/30,action);
    const box=new T.Box3().setFromObject(specimen.root,true);
    const size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
    const extent=Math.hypot(size.x,size.z);
    const half=.56*Math.max(size.y+.20*extent,extent/aspect);
    const camera=new T.OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,160);
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);
    return reviewAngles.map((angle,i)=>{
      const yaw=[0,Math.PI/2,Math.PI/4,Math.PI][i]+(kind==='squid'?Math.PI/2:0);
      camera.position.copy(center).addScaledVector(new T.Vector3(Math.sin(yaw),i===2?.23:.065,Math.cos(yaw)).normalize(),extent+size.y+5);
      camera.lookAt(center);renderer.render(scene,camera);
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      canvas.getContext('2d').drawImage(renderer.domElement,0,0);
      return {angle,canvas};
    });
  }finally{
    specimen.dispose();Object.values(materials).forEach(m=>m.dispose());
    renderer.setPixelRatio(ratio);renderer.setSize(originalSize.x,originalSize.y,false);
  }
}
