// Reference silhouette fit, in Creature Lab metres (Y up, +Z forward).
import {loadCentaurB4Geometry} from './centaur-b4.js';

function ease(a,b,x) {
  const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
  return t*t*(3-2*t);
}
function bell(x,width) { return Math.exp(-((x/width)**2)); }

// Cranial envelope down the sternum. Each row pairs the observed B.4 surface
// with the desired profile, registered to the crown and the standing surface.
const breastProfile=[
  [.78,.666,.664],[.88,.698,.667],[.99,.768,.686],[1.09,.826,.710],
  [1.16,.838,.731],[1.25,.815,.744],[1.34,.804,.752],[1.42,.825,.766],
  [1.50,.854,.779],[1.58,.840,.794],[1.65,.865,.813],[1.70,.844,.822],
  [1.76,.883,.842],[1.80,.884,.850],[1.86,.826,.813],[1.92,.773,.773]
];
function breastCorrection(h) {
  if(h<=breastProfile[0][0] || h>=breastProfile.at(-1)[0])return 0;
  const i=breastProfile.findIndex(row=>row[0]>=h);
  const [y0,z0,target0]=breastProfile[i-1],[y1,z1,target1]=breastProfile[i];
  // Cubic Hermite interpolation keeps the profile tangent through each station.
  const delta=j=>breastProfile[j][2]-breastProfile[j][1];
  const slope=j=>{
    const l=Math.max(0,j-1),r=Math.min(breastProfile.length-1,j+1);
    return (delta(r)-delta(l))/(breastProfile[r][0]-breastProfile[l][0]);
  };
  const t=(h-y0)/(y1-y0),u=1-t;
  return (1+2*t)*u*u*(target0-z0)+(3-2*t)*t*t*(target1-z1)
    +(y1-y0)*t*u*(u*slope(i-1)-t*slope(i));
}

// A continuous frontal cross-section from the breastbone through the abdomen to
// the clavicle. Columns are height, centre-front depth, half-width and rib arc.
const sections=[
  [.81,.645,.244,.049],[.88,.670,.250,.060],[.98,.698,.274,.076],
  [1.09,.715,.289,.088],[1.21,.736,.285,.091],[1.32,.752,.253,.107],
  [1.43,.768,.210,.116],[1.52,.781,.182,.102],[1.61,.792,.177,.105],
  [1.70,.807,.205,.115],[1.77,.816,.227,.111],[1.83,.812,.230,.093],
  [1.90,.777,.217,.061],[1.96,.746,.165,.045]
];
function sectionAt(h,k) {
  const i=sections.findIndex(row=>row[0]>=h);
  if(i<=0)return sections[i===0?0:sections.length-1][k];
  const a=sections[i-1],b=sections[i],t=(h-a[0])/(b[0]-a[0]),u=1-t;
  const prev=sections[Math.max(0,i-2)],next=sections[Math.min(sections.length-1,i+1)];
  const ma=(b[k]-prev[k])/(b[0]-prev[0]),mb=(next[k]-a[k])/(next[0]-a[0]);
  return u*u*(1+2*t)*a[k]+t*t*(3-2*t)*b[k]+(b[0]-a[0])*t*u*(u*ma-t*mb);
}
function frontSurface(x,h) {
  const a=Math.abs(x),w=sectionAt(h,2),arc=sectionAt(h,3);
  const shell=sectionAt(h,1)-arc*(1-Math.sqrt(Math.max(.012,1-(a/w)**2)));
  // The inferior pectoral border curves up toward the humeral insertion.
  const pec=.056*bell(a-.104,.097)*bell(h-1.775-.12*a,.083)
    *ease(1.689,1.735,h-.104*a);
  let abs=0;
  for(const [level,depth] of [[1.475,.013],[1.547,.024],[1.614,.029],[1.677,.029]]) {
    abs+=depth*bell(a-.055,.054)*bell(h-level-.16*a,.036);
  }
  const serratus=.012*bell(a-.149,.035)*(bell(h-1.665-.45*a,.018)+bell(h-1.621-.47*a,.017));
  const oblique=.014*bell(a-(.128+.25*(1.52-h)),.042)*bell(h-1.50,.139);
  const pectoral=.047*bell(h-(1.255-.62*a),.154)*bell(a-.105,.10);
  const cleft=-.006*bell(a,.030)*bell(h-1.19,.148);
  return shell+pec+abs+serratus+oblique+pectoral+cleft;
}

// Fair the caudal scapular margin across adjacent triangles. Only the latent
// shoulder ridge is relaxed, and the wrist and fingers are outside this region.
function fairAttachments(geometry,seed) {
  const p=geometry.attributes.position.array,tri=geometry.index.array;
  const rows=[],list=new Map();
  for(let i=0;i<p.length/3;i++){
    const x=Math.abs(p[3*i]),h=p[3*i+1],z=p[3*i+2];
    const shoulder=ease(.235,.405,z)*(1-ease(.585,.70,z))*ease(1.00,1.21,h)
      *(1-ease(1.45,1.57,h))*ease(.055,.167,x);
    const breast=ease(.59,.73,z)*(1-ease(.182,.245,x))*ease(.83,.98,h)*(1-ease(1.40,1.51,h));
    const back=bell(h-1.49,.072)*bell(z-.49,.114)*(1-ease(.13,.23,x));
    const flank=bell(h-1.17,.19)*bell(z+.34,.077)*ease(.17,.29,x);
    const fingers=bell(seed[3*i+1]-1.25,.055)*bell(Math.abs(seed[3*i])-.223,.035)
      *ease(.67,.74,seed[3*i+2]);
    const w=Math.max(shoulder,.72*breast,back,.83*flank,fingers);
    if(w>.002){const row={i,w,preserve:ease(.02,.50,fingers),edges:new Set()};rows.push(row);list.set(i,row);}
  }
  for(let t=0;t<tri.length;t+=3)for(let k=0;k<3;k++){
    const r=list.get(tri[t+k]);
    if(r)r.edges.add(tri[t+(k+1)%3]).add(tri[t+(k+2)%3]);
  }
  const next=new Float32Array(3*rows.length);
  for(let pass=0;pass<175;pass++){
    for(let j=0;j<rows.length;j++){
      const {i,w,preserve,edges}=rows[j];
      for(let k=0;k<3;k++){
        const val=p[3*i+k];let d=0;
        for(const n of edges)d+=p[3*n+k]-val-preserve*(seed[3*n+k]-seed[3*i+k]);
        next[3*j+k]=val+.88*w*d/edges.size;
      }
    }
    for(let j=0;j<rows.length;j++)for(let k=0;k<3;k++)p[3*rows[j].i+k]=next[3*j+k];
  }
}

export async function loadCentaurB5Geometry() {
  const geometry=await loadCentaurB4Geometry();
  const p=geometry.attributes.position;
  const seed=p.array.slice();
  for(let i=0;i<p.count;i++) {
    const x=p.getX(i),h=p.getY(i),z=p.getZ(i),a=Math.abs(x),side=Math.sign(x);
    const human=ease(1.25,1.52,h)*ease(.34,.56,z)*(1-ease(1.88,2.015,h));
    const wrist=ease(.185,.248,a)*ease(1.04,1.22,h)*ease(.55,.68,z);
    const chest=ease(.585,.779,z)*(1-ease(.149,.222,a));
    const pec=bell(h-(1.762+.19*a),.068);
    // Broader pectoral insertion, costal arch and external obliques. Move the
    // arm outward from its socket, preserving the individual fingers.
    const width=.142*a*human+.011*bell(h-1.58,.123)*ease(.035,.136,a)*human;
    const deltoid=.006*bell(a-.246,.053)*bell(h-1.856,.062);
    const handSpread=.037*wrist*(1-human);
    const rectus=bell(a-.062,.048);
    const lowerAbdomen=.012*rectus*bell(h-1.464,.056);
    const pecFront=.016*bell(a-.091,.078)*pec;
    const oblique=.016*bell(a-(.125+.24*(1.47-h)),.044)*bell(h-1.40,.148);

    // Straighten the hanging axis of the chest into the leading forearm;
    // the attenuation keeps the anterior abdomen flowing into both pectorals.
    const front=breastCorrection(h)*ease(.57,.777,z)*(1-.27*ease(.09,.21,a))*(1-wrist);
    const pectoral=.012*bell(a-.10,.057)*bell(h-1.10+.55*a,.11)*ease(.58,.76,z);
    const forequarter=bell(z-.61,.29)*bell(h-1.11,.23);
    const spread=.022*forequarter*ease(.075,.235,a)*(1-wrist);
    // Keep the croup and its loaded hind limbs together while bringing them
    // closer to the shoulder. Bring the hanging end of the tail under its dock.
    const haunch=.136*(1-ease(-.35,.54,z));
    const tail=.060*(1-ease(.29,1.31,h))*(1-ease(-.945,-.84,z));
    const top=ease(1.18,1.405,h)*(1-ease(1.53,1.72,h));
    const back=-.079*bell(z-.24,.258)*top-.030*bell(z+.62,.30)*top;
    const lumbar=.044*bell(z-.462,.120)*top*bell(a,.17);
    const belly=ease(.64,.735,h)*.068*bell(h-.776,.187)*bell(z-.065,.48)*(1-ease(.125,.302,a));
    const shin=ease(.22,.42,z)*(1-ease(.68,.92,h));
    const cannonSetback=.022*shin;
    const taper=1-.11*bell(h-.505,.057)-.10*bell(h-.176,.044);
    const limb=(h<.67 && z>-.91)?(x-side*(z>0?.215:.220))*(taper-1):0;
    // Extend the lower row of the abdominal wall toward the pectoral sling.
    const lowerSlip=-.046*bell(h-1.513,.128)*ease(.51,.72,z)*(1-ease(.145,.206,a));
    const armCenter=.276+.20*(1.79-h);
    const arm=ease(.195,.247,a)*ease(.56,.64,z)*(1-ease(.768,.810,z));
    const shoulderCap=bell(a-.257,.063)*bell(h-1.85,.063);
    const biceps=bell(h-1.737,.087)*bell(a-armCenter,.055);
    const reach=.028*bell(h-1.42,.133)*ease(.094,.174,a)*(1-ease(.199,.244,a))*ease(.50,.67,z);
    const X=x+side*(width+deltoid+handSpread+spread+reach+.007*shoulderCap
      +.007*arm*biceps*Math.tanh((a-armCenter)/.028))+limb;
    const Y=h+back+lumbar+belly+lowerSlip+.008*shoulderCap;
    const baseZ=z+haunch+tail+front+chest*(lowerAbdomen+pecFront+oblique)+pectoral-cannonSetback;
    const lumbarSlope=.065*bell(h-1.514,.080)*bell(z-.547,.119)*bell(a,.187);
    const fade=ease(.81,.945,h)*(1-ease(1.886,1.956,h));
    const arcWidth=sectionAt(Y,2);
    const anterior=ease(.684,.762,z)*(1-ease(.74*arcWidth,1.03*arcWidth,Math.abs(X)));
    const sculpt=fade*anterior*(1-wrist);
    // Carry the hamstrings toward the gaskin and let the gluteus turn over the hip.
    const thigh=ease(.17,.28,a)*(1-ease(-.25,-.08,z))*ease(-.92,-.73,z);
    const bicepsFemoris=.026*bell(z-(-.61+.30*(1.18-h)),.100)*bell(h-1.17,.203);
    const semitendinosus=.016*bell(z+.805,.064)*bell(h-1.12,.17);
    const hamstringGroove=-.013*bell(z-(-.718+.28*(1.17-h)),.041)*bell(h-1.16,.16);
    const armDepth=arm*(.022*shoulderCap+.021*biceps)*Math.tanh((z-.68)/.036);
    const Z=baseZ+(frontSurface(X,Y)-baseZ)*sculpt-lumbarSlope+armDepth;
    p.setXYZ(i,X+side*thigh*(bicepsFemoris+semitendinosus+hamstringGroove),Y,Z);
  }
  fairAttachments(geometry,seed);
  // Broad sternal heads separate below the abdominal aponeurosis and turn
  // outward onto the proximal humeri. Keep the medial sternal groove shallow.
  for(let i=0;i<p.count;i++) {
    const h=p.getY(i),x=Math.abs(p.getX(i)),z=p.getZ(i);
    if(h<.86 || h>1.62 || z<.59 || x>.235)continue;
    const front=ease(.59,.72,z)*(1-ease(.174,.235,x));
    const fan=.049*bell(h-(1.266-.95*x),.128)*bell(x-.107,.083);
    const medial=-.011*bell(h-1.17,.144)*bell(x,.030);
    const abdominal=.019*bell(x-(.098+.34*(h-1.42)),.034)*bell(h-1.45,.105);
    const border=ease(.86,.95,h)*(1-ease(1.53,1.62,h));
    p.setZ(i,z+front*border*(fan+medial+abdominal));
  }
  p.needsUpdate=true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.name='Centaur B.5 reference fit';
  return geometry;
}
