import * as T from '../vendor/three.module.js';
import {Specimen,joint} from './form.js';
import {
  armPivots,batchSweeps,eyeGeometry,eyeY,faceAt,hairCapGeometry,headPivot,membranes,skullGeometry,
  tailPivots,torsoGeometry
} from './merperson-anatomy.js';

const SKIN=0xffffff;
const FIN=0xfffefa;
const HAIR=0xfdffff;
const DETAIL=0xfefeff;
const hairColors=[0x293a33,0x34473e,0x3b4840,0x263b36,0x4a5142].map(c=>new T.Color(c));
const TAU=2*Math.PI;

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

function applySkinFinish(material) {
  // Rest-space detail travels with the skin and fades as individual scales
  // approach a pixel. Use the standard material's own lighting and roughness.
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader
      .replace('#include <common>','#include <common>\nvarying vec3 vMerpersonSkin;')
      .replace('#include <begin_vertex>','#include <begin_vertex>\nvMerpersonSkin = position;');
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
  ].map(([x,y,z,bx,by,bz])=>[x,y*sign*(sign<0?.76:1),z,bx,by*sign*(sign<0?.76:1),bz+(sign<0?.033:0)])
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

export class Merperson extends Specimen {
  constructor() {
    super();
    this.body.position.y=1.25;
    this.body.rotation.order='YXZ';
    const chest=bone(this.body,[0,0,0]);
    this.head=bone(chest,headPivot);
    const bones=[chest,this.head];
    this.tail=[];
    tailPivots.forEach((point,i)=>{
      const next=bone(this.tail.at(-1)||chest,point,tailPivots[i-1]);
      this.tail.push(next);
      bones.push(next);
    });
    this.arms=[];
    for(const sign of [-1,1]) {
      const pivots=armPivots.map(([x,y,z])=>[sign*x,y,z]);
      const shoulder=bone(chest,pivots[0]);
      const elbow=bone(shoulder,pivots[1],pivots[0]);
      const wrist=bone(elbow,pivots[2],pivots[1]);
      this.arms.push({sign,shoulder,elbow,wrist});
      bones.push(shoulder,elbow,wrist);
    }
    const body=tinted(this,this.body,SKIN,.73,torsoGeometry,T.SkinnedMesh);
    body.name='Continuous merperson skin';
    applySkinFinish(body.material);
    this.root.updateMatrixWorld(true);
    body.bind(new T.Skeleton(bones));
    // The default mesh bound is calculated at bind pose. The flexible tail
    // can extend outside that bound when the creature banks near the camera.
    body.frustumCulled=false;
    this.skin=body;

    const head=tinted(this,this.head,SKIN,.73,skullGeometry);
    head.name='Merperson head';
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

    const caudal=tinted(this,this.tail.at(-1),FIN,.65,level=>membranes(caudalOutlines,level));
    caudal.name='Forked caudal fin';
    this.caudal=caudal;
    tinted(this,this.tail[3],FIN,.65,level=>membranes([dorsalOutline],level));
    this.pectoral=[-1,1].map(s=>{
      const mount=joint(this.tail[1],s*.134,-.004,-.035);
      tinted(this,mount,FIN,.65,level=>membranes([pairedOutline(s)],level));
      return mount;
    });
    for(const {sign,wrist} of this.arms) {
      const fingers=handRows(sign);
      const hand=tinted(this,wrist,SKIN,.73,level=>batchSweeps(level,
        fingers.map((path,i)=>({path,color:new T.Color(i===0?0x74867a:0x849285)}))));
      hand.name='Merperson fingers';
      const web=new T.Color(0x697c6e);
      tinted(this,wrist,FIN,.65,level=>membranes(fingers.slice(0,-1).map((a,i)=>{
        const b=fingers[i+1];
        const ribs=[0,1,2].map(j=>[...a[j].slice(0,3),...b[j].slice(0,3)]);
        // The thumb web fades back further than the membranes between fingers.
        const u=i===0?.61:.87;
        ribs[2]=ribs[1].map((v,j)=>T.MathUtils.lerp(v,ribs[2][j],u));
        return {ribs,color:web,edge:new T.Color(0x788a78),reverse:sign<0};
      }),level));
    }
    this.phase=.36;
    this.drive=0;
    this.bank=0;
    this.heading=0;
    this.update(0,0,'Idle');
  }

  setLOD(level) {
    super.setLOD(level);
    this.skin.boundingBox=null;
    this.faceScales.visible=level!==2;
  }

  update(dt,time,action) {
    const ease=1-Math.exp(-dt*3.4);
    const effort=action==='Swim'?1:action==='Turn'?.54:0;
    this.drive+=(effort-this.drive)*ease;
    this.bank+=((action==='Turn'?1:0)-this.bank)*ease;
    const drive=this.drive, turn=this.bank;
    this.phase=(this.phase+dt*(3.0+2.65*drive))%TAU;
    const phase=this.phase;
    const yawSpeed=.92*turn;
    this.heading=(this.heading+dt*yawSpeed)%TAU;
    const thrust=drive*(.56+.76*drive)*(.90+.10*Math.cos(phase*2-1.1));
    this.root.position.x+=dt*thrust*Math.sin(this.heading);
    this.root.position.z+=dt*thrust*Math.cos(this.heading);
    this.body.position.y=1.25+(.052-.026*drive)*Math.sin(phase-.92);
    this.body.rotation.set(-.21*drive+.056*Math.cos(phase-.65),
      this.heading-(.023+.027*drive)*Math.sin(phase),-.24*turn+.040*Math.sin(phase+.70));
    this.head.rotation.y=.12*turn+.087*Math.sin(time*.88)-.032*Math.sin(phase);
    this.head.rotation.x=.14*drive+.032*Math.sin(phase-.42);
    this.head.rotation.z=.084*turn-.024*Math.sin(phase);

    let previousYaw=0,previousPitch=0;
    for(let i=0;i<this.tail.length;i++) {
      const link=this.tail[i],u=(i+1)/this.tail.length;
      const yaw=(.29+.68*drive)*u**1.48*Math.sin(phase-u*4.48)-.33*turn*u;
      const pitch=(.045+.038*drive)*u*Math.cos(phase-u*3)-.13*drive*u;
      link.rotation.y=yaw-previousYaw;
      link.rotation.x=pitch-previousPitch;
      previousYaw=yaw;
      previousPitch=pitch;
    }
    this.caudal.rotation.y=(.075+.10*drive)*Math.sin(phase-5.3);
    this.caudal.rotation.z=.057*Math.cos(phase-4.6);
    for(let i=0;i<this.pectoral.length;i++) {
      const fin=this.pectoral[i];
      fin.rotation.z=(i===0?-1:1)*(.12*Math.sin(phase-1.9+i*.52)+.14*turn);
      fin.rotation.y=.068*Math.sin(phase-2.1+i*.57);
    }
    for(const {sign,shoulder,elbow,wrist} of this.arms) {
      const scull=Math.sin(phase+sign*.38);
      shoulder.rotation.x=.18*drive+.18*(1-.63*drive)*scull;
      shoulder.rotation.z=sign*(.10+.15*(1-drive)*Math.cos(phase))+.15*turn;
      shoulder.rotation.y=-sign*.14*drive+.12*turn;
      elbow.rotation.x=.23*drive+.13*(1-drive)*Math.sin(phase-.78);
      elbow.rotation.y=sign*(.21*drive+.08*Math.cos(phase-.6));
      wrist.rotation.x=-.09*drive+.19*Math.sin(phase-1.28+sign*.45);
      wrist.rotation.z=sign*.12*Math.cos(phase-.72);
    }
    for(let i=0;i<this.hair.length;i++) {
      const lock=this.hair[i];
      lock.rotation.y=.14*Math.sin(phase-1.3-i*.51)-.17*turn;
      lock.rotation.x=.17*drive+.13*Math.cos(phase-1.54-i*.74);
      lock.rotation.z=.052*Math.sin(phase-.88-i*.66);
    }
    const blink=Math.max(0,1-Math.abs(time%6.5-3.94)/.11);
    for(const {lens,lid} of this.eyes) {
      lens.scale.y=1-blink*.96;
      lid.scale.y=1-blink*.50;
      lid.position.y=-.008*blink;
    }
  }
}
