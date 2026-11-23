// B.4 refits the B.3 surface in lab coordinates (metres, Y up, +Z anterior).
import {loadCentaurB3Geometry} from './centaur-b3.js';

function blend(lo, hi, value) {
  const t = Math.max(0, Math.min(1, (value-lo)/(hi-lo)));
  return t*t*(3-2*t);
}

function falloff(offset, radius) {
  return Math.exp(-((offset/radius)**2));
}

function fitTrunk(p, i) {
  const x=p.getX(i), h=p.getY(i), z=p.getZ(i), a=Math.abs(x);
  // From the costal margin up to the clavicle, expand through the thickness of
  // the cage about its sagittal centre. The lateral fade terminates at the axilla.
  const ribs=blend(1.595,1.754,h)*(1-blend(1.929,2.022,h));
  const medial=1-blend(.151,.194,a);
  const chestDepth=.18*(z-.705)*ribs*medial;
  // Lift the abdominal attachment towards the costal margin. The back fans
  // caudally, following the lumbar columns down onto the top of the scapula.
  const root=blend(.245,.515,z)*(1-blend(.174,.225,a));
  const attachment=blend(1.21,1.465,h)*(1-blend(1.488,1.706,h));
  const oblique=falloff(h-(1.49+.24*(.14-a)),.132);
  // Seat the intact shoulder girdle, head and arms closer to the withers.
  // Beneath the axilla the hands lie lateral and anterior to the scapular plane.
  const upperBody=blend(1.29,1.54,h)*blend(.33,.56,z);
  const outsideArm=blend(.090,.241,a)*blend(.47,.65,z)*blend(.86,1.17,h);
  const seated=upperBody+(1-upperBody)*outsideArm;
  const widen=.024*oblique*blend(.032,.136,a)*root;
  const backPlane=1-blend(.595,.702,z);
  const lumbar=falloff(h-1.53,.14)*(.041+.014*falloff(a-.058,.034));
  const linea=falloff(a-.048,.047)*falloff(h-1.486,.093);
  const sideWall=falloff(a-(.111+.27*(1.5-h)),.040)*falloff(h-1.44,.133);
  const abdominalWall=blend(.677,.790,z)*(.012*linea+.014*sideWall);
  const breast=.009*falloff(h-1.39,.14)*blend(.68,.795,z)*falloff(a-.079,.097);
  const withers=.043*falloff(z-.505,.145)*falloff(h-1.475,.108)
    *(1-blend(.118,.229,a))*blend(.22,.31,z);
  p.setXYZ(i,x+Math.sign(x)*widen,
    h-.064*seated+.016*attachment*root+withers,
    z+chestDepth+root*(abdominalWall+breast-lumbar*backPlane));
}

// Anterior centres of the B.3 cannon, fetlock and foot in an unstaggered stance.
const centres=[
  [0,.670,-.630],[.077,.648,-.650],[.136,.617,-.676],
  [.183,.600,-.693],[.285,.609,-.706],[.435,.619,-.719],
  [.505,.623,-.721],[.568,.610,-.693],[.65,.60,-.64]
];
function fitLimb(p, i) {
  const x=p.getX(i),h=p.getY(i),z=p.getZ(i);
  const fore=z>0,side=Math.sign(x);
  const lane=side*(fore?.215:.220);
  const j=centres.findIndex(row=>row[0]>=h);
  const lo=centres[Math.max(0,j-1)],hi=centres[j];
  const t=hi[0]===lo[0]?0:(h-lo[0])/(hi[0]-lo[0]);
  const col=fore?1:2;
  const center=lo[col]+t*(hi[col]-lo[col])+side*(fore?-.037:.053);
  const dx=x-lane, dz=z-center;
  const rear=1-blend(-.046,.005,dz), dorsal=blend(.002,.043,dz);
  // The calcaneal point sits above and behind the tarsus; the accessory
  // carpal projection is smaller and more lateral on the forelimb.
  const joint=falloff(h-(fore?.483:.524),fore?.045:.059);
  const jointLift=joint*rear*(fore?.007:.024);
  const cannon=falloff(h-.324,.108);
  const lateral=Math.min(1,Math.abs(dx)/.031);
  const fetlock=falloff(h-.175,.041);
  const hoof=1-blend(.047,.096,h);
  const toe=hoof*dorsal;
  // Angle the toe wall into the pastern. The posterior quarters have a low
  // heel and paired bulbs, with a shallow central cleft above the bearing edge.
  const pastern=falloff(h-.124,.054);
  const heel=rear*falloff(h-.051,.023);
  const bulbs=heel*falloff(Math.abs(dx)-.028,.017);
  const axialHeel=heel*falloff(dx,.014);
  const quarters=hoof*(fore?.070:.015)*(1-.55*dorsal);
  const width=1+quarters-.105*fetlock*dorsal-.060*joint
    +.065*cannon*rear-.085*pastern*rear+.060*bulbs;
  const forward=(fore?.017:.012)*toe-.009*fetlock
    -.011*rear*joint*(fore?.55:1)+.005*joint*dorsal
    -.006*cannon*rear+.005*cannon*dorsal-.007*bulbs+.008*axialHeel;
  const coronet=falloff(h-.078,.019);
  const height=h+jointLift-.006*fetlock*rear+.004*coronet*dorsal
    -.005*coronet*rear*blend(.013,.036,h);
  p.setXYZ(i,lane+dx*width+side*.003*cannon*lateral,h===0?0:height,z+forward);
}

export async function loadCentaurB4Geometry() {
  const geometry=await loadCentaurB3Geometry();
  const p=geometry.attributes.position;
  for(let i=0;i<p.count;i++) {
    const h=p.getY(i), z=p.getZ(i);
    if(h>.86 && z>.22) fitTrunk(p,i);
    else if(h<.65 && z>-.90) fitLimb(p,i);
  }
  p.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.name='Centaur B.4 static anatomy';
  return geometry;
}
