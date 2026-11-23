import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';
import {
  armPivots,batchSweeps,eyeGeometry,eyeY,faceAt,hairCapGeometry,handGeometry,headPivot,
  membranes,skullGeometry,torsoGeometry
} from './merperson-anatomy.js';
import {SwimMotion,SwimTail,bendFluke} from './merperson-swim.js';

const SKIN=0xffffff;
const FIN=0xfffefa;
const HAIR=0xfdffff;
const DETAIL=0xfefeff;
const hairColors=[0x293a33,0x34473e,0x3b4840,0x263b36,0x4a5142].map(c=>new T.Color(c));
const V=(x,y,z)=>new T.Vector3(x,y,z);

function bone(parent,point,previous=[0,0,0]) {
  const node=new T.Bone();
  node.position.set(point[0]-previous[0],point[1]-previous[1],point[2]-previous[2]);
  parent.add(node);
  return node;
}

function tinted(specimen,parent,key,roughness,make,Type) {
  const mesh=specimen.mesh(parent,key,make,Type);
  mesh.material.vertexColors=true;
  mesh.material.roughness=roughness;
  return mesh;
}

function applySkinFinish(material,deforming=false) {
  material.customProgramCacheKey=()=>deforming?'merperson-deforming-skin':'merperson-skin';
  // Rest-space detail travels with the skin and fades as individual scales
  // approach a pixel. Use the standard material's own lighting and roughness.
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>',`#include <common>\nvarying vec3 vMerpersonSkin;${deforming?'\nattribute vec3 merpersonRest;':''}`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>\nvMerpersonSkin = ${deforming?'merpersonRest':'position'};`);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>','#include <common>\nvarying vec3 vMerpersonSkin;')
      .replace('#include <color_fragment>',`
        #include <color_fragment>
        vec3 skinPoint = vMerpersonSkin;
        float mottling = sin(31.0*skinPoint.x+21.0*skinPoint.y)
          * sin(43.0*skinPoint.z-24.0*skinPoint.y);
        float row = (-skinPoint.z-.25)*36.0;
        float around = atan(skinPoint.x,skinPoint.y+.461)*3.82;
        float offset = (1.0-cos(3.14159*floor(row)))*.25;
        float across = 2.0*fract(around+offset)-1.0;
        float tip = fract(row);
        float scaleLip = smoothstep(.07,.18,tip-.41*across*across)
          * (1.0-smoothstep(.21,.36,tip-.41*across*across));
        float tailBlend = smoothstep(.31,.57,-skinPoint.z)
          * (1.0-smoothstep(.018,.045,fwidth(skinPoint.z)));
        float pores = sin(167.0*skinPoint.x+77.0*skinPoint.y)
          * cos(140.0*skinPoint.y+101.0*skinPoint.z)
          * (1.0-smoothstep(.002,.010,length(fwidth(skinPoint))));
        float skinHeight = .00020*pores + .00051*scaleLip*tailBlend;
        diffuseColor.rgb *= 1.0 + .095*mottling + .19*tailBlend*scaleLip + .035*pores;
      `)
      .replace('#include <roughnessmap_fragment>',`
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + .10*mottling - .17*tailBlend*scaleLip,.39,.90);
      `)
      .replace('#include <normal_fragment_maps>',`
        #include <normal_fragment_maps>
        vec3 skinDx = dFdx(-vViewPosition);
        vec3 skinDy = dFdy(-vViewPosition);
        vec3 crossX = cross(skinDy,normal);
        vec3 crossY = cross(normal,skinDx);
        float skinDet = dot(skinDx,crossX);
        vec3 skinGradient = sign(skinDet)*(dFdx(skinHeight)*crossX+dFdy(skinHeight)*crossY);
        normal = normalize(max(abs(skinDet),1e-12)*normal-skinGradient);
      `);
  };
}

function addEye(actor,sign) {
  const pivot=joint(actor.head,0,eyeY,0);
  const lens=tinted(actor,pivot,0xfdfefc,.34,level=>eyeGeometry(level,sign));
  const lid=tinted(actor,pivot,DETAIL,.72,level=>eyeGeometry(level,sign,true));
  return {lens,lid};
}

function earFin(sign) {
  const ribs=[
    [.143,.179,.028,.149,.103,.009],
    [.169,.203,.013,.174,.106,-.003],
    [.194,.220,-.022,.192,.111,-.052],
    [.222,.239,-.060,.219,.122,-.082],
    [.247,.256,-.114,.235,.145,-.124],
    [.263,.251,-.153,.259,.240,-.153]
  ].map(row=>row.map((v,i)=>i%3===0?v*sign:v));
  return {ribs,reverse:sign<0,color:new T.Color(0x61796b),edge:new T.Color(0x838b70)};
}

function faceDetails(level) {
  const scales=[];
  for(const sign of [-1,1]) {
    const n=[14,6,0][level];
    for(let i=0;i<n;i++) {
      const x=sign*(.114+(i%4)*.010+Math.sin(i*71.9)*.002);
      const y=.138+Math.floor(i/4)*.012+Math.cos(i*57.1)*.003;
      const size=.005+Math.sin(i*64)*.0014;
      const z=faceAt(x,y)+.0008;
      scales.push({color:new T.Color(i%3===0?0x779077:0x536f63),path:[
        [x,y+size*.46,z-.003,size*.38,size*.19],
        [x+sign*.002,y,z,size*.50,size*.37],
        [x+sign*.004,y-size*.6,z-.004,.001,.001]
      ]});
    }
  }
  return scales;
}

function handRows(sign) {
  return [
    [[-.039,-.035,.035],[-.077,-.052,.064],[-.089,-.072,.093],[-.077,-.087,.113]],
    [[-.041,-.057,.089],[-.056,-.072,.129],[-.062,-.087,.158],[-.053,-.100,.177]],
    [[-.017,-.060,.096],[-.020,-.074,.141],[-.021,-.087,.172],[-.012,-.097,.192]],
    [[.009,-.058,.087],[.017,-.073,.132],[.023,-.088,.158],[.028,-.100,.172]],
    [[.031,-.051,.072],[.048,-.065,.109],[.054,-.083,.128],[.055,-.092,.140]]
  ].map((points,i)=>points.map(([x,y,z],j)=>[
    x*sign,y,z,[.012,.011,.008,.0028][j]*(i===4?.84:1),[.011,.009,.006,.003][j]
  ]));
}

const caudalOutlines=[1,-1].map(sign=>({
  reverse:sign<0,
  ribs:[
    [0,0,.102,0,.002,-.083],
    [.004,.064,.081,.005,.059,-.136],
    [.006,.137,.032,.009,.134,-.240],
    [.016,.215,-.031,.020,.214,-.316],
    [.020,.294,-.154,.025,.302,-.377],
    [.027,.366,-.303,.031,.360,-.416],
    [.034,.405,-.432,.035,.401,-.442]
  ].map(([x,y,z,bx,by,bz])=>{
    const span=sign<0?.86:1;
    return [y*sign*span,-x+.17*y,z,by*sign*span,-bx+.17*by,bz+(sign<0?.021:0)];
  })
}));
const dorsalOutline={ribs:[
  [0,.099,.27,0,.102,.273],[0,.113,.180,0,.174,.183],
  [0,.120,.103,.002,.275,.056],[0,.115,-.02,.005,.236,-.118],
  [0,.101,-.18,.005,.167,-.252],[0,.091,-.29,0,.093,-.294]
]};
const pairedOutline=s=>({reverse:s<0,ribs:[
  [s*.075,-.098,.147,s*.077,-.095,.146],
  [s*.057,-.109,.087,s*.220,-.161,-.032],
  [s*.035,-.111,-.038,s*.199,-.181,-.177],
  [s*.079,-.147,-.147,s*.127,-.181,-.241],
  [s*.066,-.145,-.205,s*.066,-.145,-.206]
]});

function lockPaths(level,group) {
  const count=[10,6,3][level], result=[];
  for(let i=0;i<count;i++) {
    const f=(i+.32)/count, s=group===0?-1:group===1?1:0;
    const x=s?(s*(.068+.102*f)):(f-.5)*.157;
    const y=s?.165+.094*f:.217+.092*Math.sin(f*Math.PI);
    const z=s?-.078-.042*(1-f):-.158;
    const length=.25+.19*Math.sin(f*2.48+group*.81)**2;
    const drift=s*(.047+.068*f)+.035*Math.sin(f*15+group);
    const width=.013+.013*Math.sin(f*8+group)**2;
    result.push({color:hairColors[(i+group*2)%hairColors.length],path:[
      [x,y,z,width*.79,width*.48],[x+drift*.19,y-.067,z-.064,width,width*.65],
      [x+drift*.49,y-.15,z-length*.51,width*.86,width*.52],
      [x+drift*.83,y-.19-.032*Math.sin(i*2),z-length*.82,width*.55,width*.35],
      [x+drift,y-.156-.075*Math.sin(f*2.37+group),z-length,.0028,.0017]
    ]});
  }
  return result;
}

const {clamp,smoothstep}=T.MathUtils;

class SwimArm {
  constructor(chest,sign) {
    this.sign=sign;
    const pivots=armPivots.map(([x,y,z])=>[sign*x,y,z]);
    this.shoulder=bone(chest,pivots[0]);
    this.elbow=bone(this.shoulder,pivots[1],pivots[0]);
    this.wrist=bone(this.elbow,pivots[2],pivots[1]);
    this.upperLength=this.elbow.position.length();
    this.lowerLength=this.wrist.position.length();
    this.restUpper=this.elbow.position.clone().normalize();
    this.restLower=this.wrist.position.clone().normalize();
    this.restHand=V(.14*sign,-.49,.86).normalize();
    this.target=V();
    this.axis=V();
    this.pole=V();
    this.upper=V();
    this.lower=V();
    this.hand=V();
    this.q=new T.Quaternion();
    this.inv=new T.Quaternion();
    this.wristTurn=new T.Quaternion();

    this.fingers=handRows(sign);
    this.digits=this.fingers.map(path=>path.slice(0,3).map(row=>row.slice(0,3))
      .reduce((chain,p,i,points)=>{
        chain.push(bone(chain.at(-1)||this.wrist,p,points[i-1]));
        return chain;
      },[]));
  }

  update(motion) {
    const {phase,hover,turn,brake,coast,surge,flow}=motion;
    const s=this.sign, outside=Math.max(0,-s*turn), inside=Math.max(0,s*turn);
    const scull=phase+s*.38, flutter=Math.sin(scull);
    const streamline=smoothstep(flow,0,1.65);
    this.target.set(
      s*(.51-.061*streamline+.16*hover+.31*brake+.25*outside-.042*inside
        +.055*hover*Math.cos(scull-.44)),
      -.193-.045*streamline+.075*hover+.107*brake+.136*outside+.029*inside
        +(.022*hover+.009)*Math.cos(scull),
      .097-.147*streamline-.047*coast+.115*hover+.32*brake+.072*outside-.024*inside
        +.074*hover*flutter-.026*surge
    );
    this.axis.subVectors(this.target,this.shoulder.position);
    const reach=clamp(this.axis.length(),.28,this.upperLength+this.lowerLength-.018);
    this.axis.normalize();
    this.pole.set(s*(.74+.16*outside),-.29,-.68).addScaledVector(this.axis,
      -this.pole.dot(this.axis)).normalize();
    // Find the elbow on the circle where both fixed bone lengths agree.
    const along=(this.upperLength*this.upperLength-this.lowerLength*this.lowerLength+reach*reach)/(2*reach);
    const out=Math.sqrt(Math.max(0,this.upperLength*this.upperLength-along*along));
    this.upper.copy(this.axis).multiplyScalar(along).addScaledVector(this.pole,out);
    this.lower.copy(this.axis).multiplyScalar(reach).sub(this.upper).normalize();
    this.shoulder.quaternion.setFromUnitVectors(this.restUpper,this.upper.normalize());
    this.inv.copy(this.shoulder.quaternion).invert();
    this.elbow.quaternion.setFromUnitVectors(this.restLower,this.hand.copy(this.lower).applyQuaternion(this.inv));

    this.hand.copy(this.lower);
    this.hand.x+=s*(.27*hover*Math.sin(scull-.63)+.50*brake+.20*outside);
    this.hand.y+=.18*hover*Math.cos(scull-.76)+.26*brake;
    this.hand.z+=.2*hover*Math.cos(scull)+.56*brake;
    this.q.setFromUnitVectors(this.restHand,this.hand.normalize());
    this.wristTurn.setFromAxisAngle(this.restHand,s*(.39*hover*Math.sin(scull-.58)
      +.60*brake-.15*streamline+.29*outside));
    this.inv.multiplyQuaternions(this.shoulder.quaternion,this.elbow.quaternion).invert();
    this.wrist.quaternion.copy(this.inv).multiply(this.q).multiply(this.wristTurn);

    const spread=.15*hover+.32*brake+.15*outside-.045*streamline;
    for(let i=0;i<this.digits.length;i++) {
      const [knuckle,middle,tip]=this.digits[i];
      const ripple=Math.sin(scull-.96-i*.37);
      const leverage=i===0?.67:1;
      const curl=leverage*(.13+.15*streamline-.27*brake+.08*coast+.15*hover*ripple+.05*outside*ripple);
      knuckle.rotation.set(curl*.74,s*(i-2)*spread*.43,0);
      middle.rotation.x=curl;
      tip.rotation.x=curl*.67;
    }
  }
}

export class Merperson extends Specimen {
  constructor() {
    super();
    this.body.position.y=1.25;
    this.body.rotation.order='YXZ';
    const chest=bone(this.body,[0,0,0]);
    this.head=bone(chest,headPivot);
    const bones=[chest,this.head];
    this.motion=new SwimMotion();
    this.tail=new SwimTail();
    this.arms=[-1,1].map(sign=>new SwimArm(chest,sign));
    for(const {shoulder,elbow,wrist} of this.arms) bones.push(shoulder,elbow,wrist);
    const body=tinted(this,this.body,0xfffefe,.73,torsoGeometry,T.SkinnedMesh);
    body.name='Continuous merperson skin';
    applySkinFinish(body.material,true);
    this.root.updateMatrixWorld(true);
    body.bind(new T.Skeleton(bones));
    body.frustumCulled=false;
    this.skin=body;

    const head=tinted(this,this.head,SKIN,.73,skullGeometry);
    head.name='Merperson head';
    applySkinFinish(head.material);
    this.eyes=[-1,1].map(sign=>addEye(this,sign));
    this.faceScales=tinted(this,this.head,DETAIL,.76,level=>batchSweeps(level,faceDetails(level)));
    tinted(this,this.head,FIN,.65,level=>membranes([-1,1].map(earFin),level));
    tinted(this,this.head,HAIR,.80,hairCapGeometry);
    this.hair=Array.from({length:3},(_,i)=>{
      const pivot=joint(this.head,0,.177,-.105);
      const locks=tinted(this,pivot,HAIR,.80,level=>batchSweeps(level,lockPaths(level,i)));
      locks.position.set(0,-.177,.105);
      return pivot;
    });

    this.caudal=joint(this.body);
    this.caudalRest=V(0,-.45,-1.91);
    this.caudalCoordinate=this.tail.coordinate(this.caudalRest.z);
    this.fluke=tinted(this,this.caudal,FIN,.65,level=>membranes(caudalOutlines,level));
    this.fluke.name='Forked caudal fin';
    this.fluke.frustumCulled=false;
    this.secondaryFins=[
      tinted(this,this.body,FIN,.65,level=>membranes([dorsalOutline],level).translate(0,-.50,-1.33)),
      ...[-1,1].map(s=>tinted(this,this.body,FIN,.65,level=>
        membranes([pairedOutline(s)],level).translate(s*.134,-.424,-.655)))
    ];
    for(const fin of this.secondaryFins) fin.frustumCulled=false;

    for(const arm of this.arms) {
      arm.handMesh=tinted(this,arm.wrist,SKIN,.73,level=>
        handGeometry(level,arm.fingers),T.SkinnedMesh);
      arm.handMesh.name=arm.sign===1?'Left articulated webbed hand':'Right articulated webbed hand';
      arm.handMesh.frustumCulled=false;
      this.root.updateMatrixWorld(true);
      arm.handMesh.bind(new T.Skeleton(arm.digits.flat()));
    }
    this.lastTime=0;
    this.update(0,0,'Idle');
  }

  setLOD(level) {
    super.setLOD(level);
    this.skin.boundingBox=null;
    this.faceScales.visible=level!==2;
    this.pose(this.lastTime);
  }

  update(dt,time,action) {
    const motion=this.motion;
    motion.update(dt,action);
    this.root.position.x+=dt*motion.speed*Math.sin(motion.heading);
    this.root.position.z+=dt*motion.speed*Math.cos(motion.heading);
    this.lastTime=time;
    this.pose(time);
  }

  pose(time) {
    const motion=this.motion;
    const {phase,stroke,hover,turn,flow,brake,coast,surge}=motion;
    const spine=.105*stroke*Math.sin(phase-.22)+.041*hover*Math.sin(phase-.91);
    const pitch=motion.pitch+spine-.085*brake+.05*surge;
    const roll=-.33*turn+(.034*hover+.019*stroke)*Math.sin(phase+.68);
    this.body.position.y=1.25+.045*hover*Math.sin(phase-.76)+.059*stroke*Math.sin(phase-.79)-.062*brake;
    this.body.rotation.set(pitch,motion.heading+.034*stroke*Math.sin(phase+.37),roll);
    this.head.rotation.set(-.63*pitch-.034*stroke*Math.sin(phase-.30)+.07*brake,
      .22*turn+.043*Math.sin(time*.88)-.022*Math.sin(phase+.25),-.72*roll);

    this.tail.update(motion,pitch);
    this.tail.deform(this.skin,motion);
    this.tail.attach(this.caudal,this.caudalRest,this.caudalCoordinate);
    bendFluke(this.fluke,motion);
    for(const fin of this.secondaryFins) this.tail.deform(fin,motion,1);
    for(const arm of this.arms) arm.update(motion);
    for(let i=0;i<this.hair.length;i++) {
      const lock=this.hair[i];
      const drift=time*(1.67+i*.16)-i*.86;
      lock.rotation.y=.092*Math.sin(drift)-.22*turn;
      lock.rotation.x=.14*flow+.085*Math.cos(drift-.74)-.17*brake+.08*coast;
      lock.rotation.z=.049*Math.sin(drift+.42)-.10*turn;
    }
    const blink=Math.max(0,1-Math.abs(time%6.5-3.94)/.11);
    for(const {lens,lid} of this.eyes) {
      lens.scale.y=1-blink*.96;
      lid.scale.y=1-blink*.50;
      lid.position.y=-.008*blink;
    }
  }
}
