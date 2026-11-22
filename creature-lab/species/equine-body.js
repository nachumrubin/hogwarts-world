// Each station describes width, dorsal (y,z), ventral (y,z), and the
// moving bone's influence. Independent outlines let the withers run into
// the back of the neck while the brisket rises into its front.
import * as T from '../vendor/three.module.js';
import {smoothSections} from './form.js';

const barrel=[
  [.05,1.51,-1.11,1.24,-1.09,0],
  [.29,1.74,-1.00,1.05,-.94,0],
  [.43,1.89,-.76,.99,-.71,0],
  [.405,1.83,-.47,1.05,-.44,0],
  [.405,1.78,-.17,.99,-.16,0],
  [.45,1.83,.11,.91,.14,0],
  [.455,1.92,.28,.89,.48,0],
  [.395,1.97,.41,.98,.78,0]
];

const forequarters={
  centaur:[
    [.33,1.99,.48,1.27,.98,.02],[.295,2.02,.49,1.61,1.02,.12],
    [.24,2.05,.50,1.87,.92,.44],[.235,2.12,.51,2.05,.875,.8],
    [.285,2.23,.48,2.21,.89,1],[.338,2.34,.49,2.34,.905,1],
    [.365,2.405,.54,2.42,.86,1],[.23,2.49,.56,2.48,.79,1],
    [.103,2.55,.574,2.55,.77,1],[.099,2.65,.58,2.65,.776,1]
  ],
  unicorn:[
    [.32,2.04,.48,1.23,1.02,.015],[.26,2.14,.57,1.53,1.115,.14],
    [.203,2.28,.70,1.84,1.16,.48],[.158,2.40,.85,2.07,1.20,.86],
    [.127,2.47,1.005,2.225,1.24,1],[.12,2.46,1.13,2.29,1.26,1]
  ],
  hippogriff:[
    [.37,2.00,.46,1.21,1.04,.03],[.33,2.06,.49,1.51,1.10,.19],
    [.267,2.16,.55,1.81,1.13,.61],[.199,2.27,.64,2.03,1.10,.93],
    [.15,2.35,.74,2.17,1.01,1]
  ]
};

export function equineBody(actor,parent,kind,coat,foreColor,pivot){
  const stations=barrel.concat(forequarters[kind]);
  const coatColor=new T.Color(coat),frontColor=new T.Color(foreColor);
  const surface=actor.mesh(parent,0xffffff,lod=>{
    const sides=[28,16,10][lod],rings=smoothSections(stations,[3,2,1][lod]);
    const positions=[],colors=[],indices=[],bones=[],weights=[];
    for(const [i,[width,backY,backZ,frontY,frontZ,weight]] of rings.entries()){
      for(let j=0;j<sides;j++){
        const angle=2*Math.PI*j/sides,x=Math.cos(angle),v=Math.sin(angle);
        const t=(v+1)/2;
        const y=T.MathUtils.lerp(frontY,backY,t),z=T.MathUtils.lerp(frontZ,backZ,t);
        // Narrow the underside of the rib basket and flatten the broad back.
        positions.push(width*Math.sign(x)*Math.abs(x)**.88*(.94+.09*v),y,z);
        const transition=T.MathUtils.smoothstep(weight+(1-t)*.12,.11,.60);
        colors.push(...coatColor.clone().lerp(frontColor,transition).toArray());
        bones.push(0,1,0,0);weights.push(1-weight,weight,0,0);
        if(i){const k=i*sides+j,n=i*sides+(j+1)%sides;indices.push(k-sides,n-sides,k,n-sides,n,k)}
      }
    }
    const last=(rings.length-1)*sides;
    for(let j=1;j<sides-1;j++)indices.push(0,j+1,j,last,last+j,last+j+1);
    const g=new T.BufferGeometry();
    for(const [name,data] of [['position',positions],['color',colors]])g.setAttribute(name,new T.Float32BufferAttribute(data,3));
    g.setAttribute('skinIndex',new T.Uint16BufferAttribute(bones,4));
    g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
    g.setIndex(indices);g.computeVertexNormals();return g;
  },T.SkinnedMesh);
  surface.material.vertexColors=true;
  const base=new T.Bone(),neck=new T.Bone();
  surface.add(base);base.add(neck);neck.position.set(...pivot);
  surface.updateWorldMatrix(true,true);
  const skeleton=new T.Skeleton([base,neck]);
  surface.bind(skeleton);
  // Animated neck and attached head can leave the bind-pose bounding sphere.
  surface.frustumCulled=false;
  return neck;
}
