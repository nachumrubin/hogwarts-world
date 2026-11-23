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
    [.375,1.99,.46,1.25,.99,.02],[.305,2.01,.48,1.58,1.015,.12],
    [.246,2.035,.505,1.83,.915,.44],[.222,2.075,.505,2.02,.86,.8],
    [.265,2.145,.475,2.135,.89,1],[.321,2.22,.455,2.215,.925,1],
    [.355,2.285,.47,2.29,.94,1],[.366,2.345,.485,2.352,.915,1],
    [.355,2.405,.518,2.405,.857,1],[.194,2.46,.555,2.448,.797,1],
    [.107,2.495,.572,2.488,.77,1],[.103,2.59,.575,2.59,.773,1]
  ],
  unicorn:[
    [.295,2.03,.50,1.34,.95,.015],[.217,2.115,.61,1.68,1.02,.16],
    [.165,2.24,.76,1.955,1.10,.46],[.139,2.37,.905,2.12,1.21,.81],
    [.12,2.47,1.055,2.245,1.31,.97],[.112,2.49,1.16,2.32,1.34,1]
  ],
  hippogriff:[
    [.37,2.00,.46,1.21,1.04,.03],[.33,2.06,.49,1.51,1.10,.19],
    [.267,2.16,.55,1.81,1.13,.61],[.199,2.27,.64,2.03,1.10,.93],
    [.15,2.35,.74,2.17,1.01,1]
  ]
};

// The side of the ribcage opens into the deltoid. Its boundary vertices
// are the first arm ring, so counter-swing cannot open a shoulder seam.
function extendArm(side,opening,positions,indices,bones,weights,colors,skin){
  const ringSize=opening.length;
  const profile=opening.map(index=>{
    const y=positions[3*index+1],z=positions[3*index+2];
    return Math.atan2((z-.702)/.202,(y-2.312)/.093);
  });
  // Ring centres move out over the acromion, then back toward the elbow.
  // The unequal front and rear depths carry the biceps and triceps masses.
  const rows=[
    [.358,2.274,.702,.066,.148,.146,.60,.068],
    [.379,2.235,.705,.079,.128,.127,.86,.040],
    [.391,2.188,.703,.083,.108,.110,1,.017],
    [.396,2.137,.701,.071,.086,.094,1],
    [.402,2.066,.693,.070,.092,.084,1],
    [.409,1.993,.676,.058,.074,.078,1],
    [.412,1.949,.665,.054,.057,.068,1],
    [.418,1.893,.679,.069,.078,.067,1],
    [.424,1.81,.699,.064,.066,.061,1],
    [.431,1.702,.725,.042,.047,.044,1],
    [.432,1.665,.733,.038,.039,.036,1]
  ];
  let previous=opening;
  for(const [cx,cy,cz,rx,front,back,influence,rise=0] of rows){
    const ring=[];
    for(let j=0;j<ringSize;j++){
      const a=profile[j],v=Math.sin(a);
      ring.push(positions.length/3);
      positions.push(side*(cx+rx*Math.cos(a)),cy+rise*Math.cos(a),cz+v*(v>0?front:back));
      bones.push(1,side<0?2:3,0,0);weights.push(1-influence,influence,0,0);
      colors.push(skin.r,skin.g,skin.b);
    }
    for(let j=0;j<ringSize;j++){
      const k=(j+1)%ringSize;
      indices.push(previous[j],previous[k],ring[j],previous[k],ring[k],ring[j]);
    }
    previous=ring;
  }
  for(let j=1;j<ringSize-1;j++)indices.push(previous[0],previous[j],previous[j+1]);
}

export function equineBody(actor,parent,kind,coat,foreColor,pivot){
  const stations=barrel.concat(forequarters[kind]);
  const coatColor=new T.Color(coat),frontColor=new T.Color(foreColor);
  const surface=actor.mesh(parent,0xffffff,lod=>{
    const sides=[28,16,10][lod],rings=smoothSections(stations,[3,2,1][lod]);
    const steps=[3,2,1][lod];
    const armBottom=(barrel.length+5)*steps,armTop=(barrel.length+8)*steps;
    const armArc=Math.round(sides*.16);
    const positions=[],colors=[],indices=[],bones=[],weights=[];
    for(const [i,[width,backY,backZ,frontY,frontZ,weight]] of rings.entries()){
      for(let j=0;j<sides;j++){
        const angle=2*Math.PI*j/sides,x=Math.cos(angle),v=Math.sin(angle);
        const t=(v+1)/2;
        let y=T.MathUtils.lerp(frontY,backY,t),z=T.MathUtils.lerp(frontZ,backZ,t);
        if(kind==='centaur'){
          const lateral=Math.abs(width*x),front=Math.max(0,-v);
          const bump=(d,r)=>Math.exp(-((d/r)**2));
          // Sternum, costal arch and clavicle change the surface planes.
          const pec=.047*bump(lateral-.17,.115)*bump(y-2.29,.083);
          const clavicle=.026*bump(y-(2.382+.035*lateral/.32),.024)*bump(lateral-.16,.15);
          const sternum=.023*bump(lateral,.046)*bump(y-2.29,.106);
          const ribs=.018*bump(y-(2.104+.105*(1-lateral/.32)),.036)*bump(lateral-.17,.13);
          // The descending pectorals meet at the equine breastbone.
          const breast=bump(z-.83,.22)*bump(y-1.47,.37);
          z+=front*(pec+clavicle-sternum+ribs+breast*(.09*bump(lateral-.16,.105)-.048*bump(lateral,.06)));
          y+=.037*bump(lateral,.064)*bump(z-.61,.27)*bump(y-1.06,.22);
        }
        // Narrow the underside of the rib basket and flatten the broad back.
        positions.push(width*Math.sign(x)*Math.abs(x)**.88*(.94+.09*v),y,z);
        const transition=T.MathUtils.smoothstep(weight+(1-t)*.12,.11,.60);
        colors.push(...coatColor.clone().lerp(frontColor,transition).toArray());
        bones.push(0,1,0,0);weights.push(1-weight,weight,0,0);
        const nearSide=Math.min(j+.5,sides-j-.5,Math.abs(j+.5-sides/2));
        const shoulderOpening=kind==='centaur' && i>armBottom && i<=armTop && nearSide<armArc;
        if(i && !shoulderOpening){const k=i*sides+j,n=i*sides+(j+1)%sides;indices.push(k-sides,n-sides,k,n-sides,n,k)}
      }
    }
    if(kind==='centaur'){
      for(const side of [-1,1]){
        const center=side<0?sides/2:0;
        const vertex=(i,j)=>i*sides+(center+j+sides)%sides;
        const opening=[];
        for(let j=-armArc;j<armArc;j++)opening.push(vertex(armBottom,j));
        for(let i=armBottom;i<armTop;i++)opening.push(vertex(i,armArc));
        for(let j=armArc;j>-armArc;j--)opening.push(vertex(armTop,j));
        for(let i=armTop;i>armBottom;i--)opening.push(vertex(i,-armArc));
        extendArm(side,opening,positions,indices,bones,weights,colors,frontColor);
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
  const bones=[base,neck];
  if(kind==='centaur'){
    for(const side of [-1,1]){
      const shoulder=new T.Bone();
      shoulder.name=side<0?'leftShoulder':'rightShoulder';
      shoulder.position.set(side*.35-pivot[0],2.34-pivot[1],.702-pivot[2]);
      neck.add(shoulder);bones.push(shoulder);
    }
  }
  surface.updateWorldMatrix(true,true);
  const skeleton=new T.Skeleton(bones);
  surface.bind(skeleton);
  // Animated neck and attached head can leave the bind-pose bounding sphere.
  surface.frustumCulled=false;
  return neck;
}
