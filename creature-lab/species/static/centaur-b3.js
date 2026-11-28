// Static sculpt in Creature Lab coordinates (metres, Y up, +Z anterior).
import * as T from '../../vendor/three.module.js';
import {smoothSections} from '../form.js';

const bell = (d, radius) => Math.exp(-((d / radius) ** 2));
function ramp(a, b, value) {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function warrior(x, h, z) {
  const a = Math.abs(x), side = Math.sign(x);
  const anterior = ramp(.69,.805,z), posterior = ramp(.685,.59,z);
  const trunk = 1 - ramp(.158,.206,a);
  const rectus = [1.555,1.635,1.71].reduce((sum, level, i) => {
    const mid = level + .085 * a;
    return sum + (.023 + .002*i) * bell(h-mid,.039) * bell(a-.046,.042);
  }, 0);
  // Lower slips lengthen and disappear into the equine sternum.
  const lower = .014*bell(h-1.465-.22*a,.086)*bell(a-.037,.036);
  const pecHeight = 1.847 + .18*a;
  const pec = .040*bell(a-.091,.081)*bell(h-pecHeight,.072)
    * ramp(1.760,1.810,h-.13*a);
  const sternum = -.005*bell(a,.018)*bell(h-1.838,.081);
  const oblique = .022*bell(a-(.086+.33*(h-1.50)),.035)*bell(h-1.60,.134);
  let serratus = 0;
  for (const height of [1.695,1.735,1.772]) {
    serratus += .013*bell(h-height-.50*(a-.13),.015)*bell(a-.137,.037);
  }
  const inscriptions = [1.595,1.674,1.748].reduce((sum,level) =>
    sum + .007*bell(h-level-.105*a,.012)*bell(a-.050,.044),0);
  const chest = anterior * trunk * (rectus+lower+pec+sternum+oblique+serratus-inscriptions);
  const taper = -.017*bell(h-1.59,.093) + .025*bell(h-1.805,.107);
  const lat = .022*bell(a-.14,.062)*bell(h-1.80-.42*a,.124);
  const trapezius = .026*bell(h-(2.039-.46*a),.053)*bell(a-.095,.10);
  const back = lat + trapezius + .016*bell(a-.042,.031)*bell(h-1.68,.26);
  const deltoid = bell(a-.226,.058)*bell(h-1.920,.077);
  const armAxis = .254 - .22*(h-1.81);
  const arm = bell(a-armAxis,.058)*ramp(.160,.213,a);
  const proximal = bell(h-1.803,.090), forearm = bell(h-1.606,.088);
  const armFront = ramp(.665,.719,z);
  const armBack = ramp(.690,.634,z);
  const armDepth = arm * ((.032*proximal+.022*forearm)*armFront
                        - (.029*proximal+.017*forearm)*armBack);
  const brachialis = .012*bell(a-armAxis-.033,.029)*bell(h-1.753,.061);
  const neck = .014*bell(h-2.026,.045)*bell(a-.055,.037);
  return [
    x + side*(taper*trunk*ramp(.055,.138,a) + .030*deltoid
      + arm*(.014*proximal+.014*forearm)*Math.tanh((a-armAxis)/.024) + neck + brachialis),
    h + .015*deltoid + .54*trapezius,
    z + chest - posterior*trunk*back + armDepth
      + .014*deltoid*Math.tanh((z-.682)/.035)
  ];
}

// Paired midline measurements from the B.2 sternum and the intended B.3 profile.
// Preserve the depth behind the shoulder while relaxing the overly prominent breast.
const sternumProfile = smoothSections([
  [.75,.630,.630],[.81,.742,.680],[.88,.810,.717],[.98,.860,.750],
  [1.08,.891,.779],[1.17,.897,.794],[1.25,.886,.803],[1.34,.869,.803],
  [1.42,.844,.797],[1.49,.815,.807],[1.56,.815,.815]
],4);
function sternalRetreat(h) {
  if(h<=sternumProfile[0][0] || h>=sternumProfile.at(-1)[0])return 0;
  const i=sternumProfile.findIndex(row=>row[0]>=h);
  const [y0,b0,p0]=sternumProfile[i-1],[y1,b1,p1]=sternumProfile[i];
  return p0-b0+(p1-b1-p0+b0)*(h-y0)/(y1-y0);
}

// Shoulder and pectoral attachment planes follow the cranial and lateral plates in
// University of Minnesota, Dissection Lab 2, Extrinsic Muscles and Associated Structures.
function bodyPoint(x, h, z) {
  if (h > 2.09) return [x,h,z];
  const a = Math.abs(x), side = Math.sign(x);
  const lateral = ramp(.10,.245,a);
  const front = ramp(.31,.74,z);
  const breast = ramp(.56,.80,z)*(1-ramp(.18,.30,a));
  const midline = 1-ramp(.04,.232,a);
  // Recede the breastbone and lift the ventral midline between the loaded forelimbs.
  const sternum = breast*(sternalRetreat(h) - .033*bell(a-.109,.067)*bell(h-1.09,.17));
  const pectoral = .022*front*bell(a-(.073+.43*(1.22-h)),.069)*bell(h-1.09,.145);
  const sling = .076*bell(z-.61,.34)*bell(h-.765,.21)*midline;
  const shoulderPlate = bell(z-(.635-.56*(h-1.115)),.115)*bell(h-1.25,.227);
  const shoulderPoint = bell(z-.688,.077)*bell(h-1.123,.084);
  const triceps = bell(z-(.535+.35*(h-1.025)),.090)*bell(h-1.03,.132);
  const elbow = bell(z-.487,.077)*bell(h-.897,.059);
  const gluteal = bell(z+.68,.245)*bell(h-1.17,.24);
  const stifle = bell(z+.53,.226)*bell(h-.843,.15);
  const limb = ramp(.10,.19,a);
  const dx = -.036*front*bell(h-1.16,.255)*ramp(.09,.26,a)
    + lateral*(-.017*shoulderPlate+.034*shoulderPoint+.029*triceps+.013*elbow-.038*gluteal);
  const y = h+sling+.011*bell(z-.344,.14)*bell(h-1.47,.06);
  const forward = z+sternum+pectoral - .055*stifle*limb;
  const upper = warrior(x,h,z);
  const human = ramp(1.35,1.48,h)*ramp(.37,.50,z);
  return [x+side*dx+(upper[0]-x)*human, y+(upper[1]-h)*human, forward+(upper[2]-z)*human];
}

// Distal sections: height, anterior centre, half width, toe-side and heel-side radii.
// The heel ends well below the coronet at the toe. The fetlock sits behind the toe.
const fore = [
  [.641,.603,.069,.077,.095],[.618,.604,.066,.073,.089],[.567,.610,.052,.059,.065],
  [.531,.616,.047,.052,.059],[.502,.623,.052,.059,.055],[.471,.624,.051,.055,.061],
  [.436,.619,.039,.041,.054],[.372,.614,.030,.034,.048],[.262,.608,.030,.033,.047],
  [.212,.606,.039,.041,.053],[.181,.600,.049,.051,.063],[.157,.604,.046,.048,.061],
  [.134,.617,.038,.043,.050],[.107,.633,.039,.045,.049],[.082,.646,.046,.050,.054],
  [.070,.650,.051,.053,.061],[.046,.659,.056,.060,.064],
  [.014,.668,.064,.073,.069],[.003,.670,.066,.077,.070],[0,.670,.065,.077,.069]
];
const hind = [
  [.641,-.650,.068,.090,.083],[.618,-.669,.064,.081,.075],[.566,-.694,.055,.066,.073],
  [.535,-.711,.049,.057,.084],[.508,-.721,.047,.052,.081],[.479,-.719,.047,.052,.065],
  [.446,-.720,.041,.047,.057],[.384,-.714,.033,.037,.050],[.272,-.705,.031,.035,.049],
  [.217,-.696,.039,.039,.056],[.184,-.693,.047,.050,.061],[.157,-.687,.046,.048,.058],
  [.127,-.672,.036,.041,.048],[.097,-.658,.040,.046,.048],[.079,-.651,.044,.048,.053],
  [.066,-.646,.047,.051,.056],[.042,-.639,.054,.058,.060],
  [.013,-.632,.061,.069,.067],[.003,-.630,.063,.073,.068],[0,-.630,.062,.073,.067]
];

const cutHeight = .657;
const turn = 2*Math.PI;
function angle(x,z) { return (Math.atan2(z,x)+turn)%turn; }

function legSurface(positions, indices, boundary, side, isFore) {
  const centerX = side*(isFore ? .215 : .220);
  const stagger = side*(isFore ? -.037 : .053);
  const depths=boundary.map(i=>positions[3*i+2]);
  const cutZ=(Math.min(...depths)+Math.max(...depths))/2;
  const edge = boundary.map(i=>({i,t:angle(positions[3*i]-centerX,positions[3*i+2]-cutZ)}))
    .sort((a,b)=>a.t-b.t);
  // Continue the circumference of the proximal limb into the gaskin or forearm.
  // A measured radius for each azimuth avoids a step at the cut on a staggered leg.
  function cutRadius(t) {
    let j=edge.findIndex(p=>p.t>=t);
    if(j<0)j=0;
    const right=edge[j],left=edge[(j+edge.length-1)%edge.length];
    const radial=p=>Math.hypot(positions[3*p.i]-centerX,positions[3*p.i+2]-cutZ);
    const fraction=((t-left.t+turn)%turn)/((right.t-left.t+turn)%turn || 1);
    return radial(left)+(radial(right)-radial(left))*fraction;
  }
  const sides = 40;
  let previous;
  for (const [height,center,width,toe,heel] of smoothSections(isFore ? fore : hind,2)) {
    const ring=[];
    for (let j=0;j<sides;j++) {
      const t=turn*j/sides,c=Math.cos(t),s=Math.sin(t);
      const hoof=1-ramp(.065,.115,height);
      const coronet=1+.060*bell(height-.079,.009)-.042*bell(height-.061,.008);
      const widthFactor=coronet*(1+hoof*(.08+.045*s-.18*Math.max(0,-s)**2));
      const tendon=1-.145*bell(s+.38,.22)*bell(height-.319,.127);
      const fetlock=1+.13*bell(height-.177,.022)*Math.max(0,-s);
      const h=height-.019*ramp(0,.030,height)*bell(height-.073,.030)*Math.max(0,-s);
      ring.push({i:positions.length/3,t});
      const blend=ramp(.525,cutHeight,height);
      const radius=cutRadius(t), distalWidth=width*c*widthFactor*tendon;
      const heelBulbs=.008*bell(height-.068,.025)*Math.max(0,-s)*bell(Math.abs(c)-.48,.24);
      const distalZ=center+stagger+s*(s>0?toe:heel)*fetlock*coronet-heelBulbs;
      const slope=isFore ? .12 : -.69;
      const proximalZ=cutZ+slope*(cutHeight-height)+s*radius*(1-.88*(cutHeight-height));
      positions.push(centerX+distalWidth*(1-blend)+c*radius*(1-1.05*(cutHeight-height))*blend,
        h,distalZ*(1-blend)+proximalZ*blend);
    }
    if (!previous) {
      // Stitch the irregular B.2 cut loop to the regular leg rings by angular order.
      let i=0,j=0;
      while (i<edge.length || j<sides) {
        const a=edge[i%edge.length].i,b=ring[j%sides].i;
        const nextA=i+1<edge.length?edge[i+1].t:turn;
        const nextB=j+1<sides?ring[j+1].t:turn;
        if (i<edge.length && (j===sides || nextA<=nextB)) {
          indices.push(a,edge[(i+1)%edge.length].i,b);i++;
        } else { indices.push(a,ring[(j+1)%sides].i,b);j++; }
      }
    } else {
      for (let j=0;j<sides;j++) {
        const k=(j+1)%sides;
        indices.push(previous[j].i,previous[k].i,ring[j].i,previous[k].i,ring[k].i,ring[j].i);
      }
    }
    previous=ring;
  }
  // Recess the sole slightly inside its level bearing rim.
  const sole=positions.length/3;
  positions.push(centerX,.004,(isFore?.670:-.630)+stagger);
  for(let j=0;j<sides;j++) indices.push(previous[j].i,previous[(j+1)%sides].i,sole);
}

// Relax the old loft junction across mesh edges. The caudal scapular border receives
// the largest correction; the waist and hanging fingers retain their contours.
function fairForequarters(geometry) {
  const p=geometry.attributes.position.array, tri=geometry.index.array;
  const weights=new Float32Array(p.length/3), rows=[];
  for(let i=0;i<weights.length;i++) {
    const x=Math.abs(p[3*i]),h=p[3*i+1],z=p[3*i+2];
    const hand=ramp(.194,.246,x)*ramp(.61,.69,z)*ramp(1.18,1.27,h);
    const region=ramp(.71,.89,h)*(1-ramp(1.45,1.56,h))*ramp(.21,.41,z)*(1-hand);
    if(region>0.001) {
      weights[i]=region*(.60+.36*bell(z-.46,.16));
      rows.push({i,neighbors:new Set()});
    }
  }
  const byId=new Map(rows.map(row=>[row.i,row]));
  for(let f=0;f<tri.length;f+=3) {
    for(let k=0;k<3;k++) {
      const row=byId.get(tri[f+k]);
      if(row)row.neighbors.add(tri[f+(k+1)%3]).add(tri[f+(k+2)%3]);
    }
  }
  const next=new Float32Array(3*rows.length);
  for(let pass=0;pass<100;pass++) {
    for(let r=0;r<rows.length;r++) {
      const {i,neighbors}=rows[r],weight=weights[i]/neighbors.size;
      let dx=0,dy=0,dz=0;
      for(const j of neighbors) {
        dx+=p[3*j]-p[3*i];dy+=p[3*j+1]-p[3*i+1];dz+=p[3*j+2]-p[3*i+2];
      }
      next[3*r]=p[3*i]+weight*dx;
      next[3*r+1]=p[3*i+1]+weight*dy;
      next[3*r+2]=p[3*i+2]+weight*dz;
    }
    for(let r=0;r<rows.length;r++) {
      const i=3*rows[r].i;p[i]=next[3*r];p[i+1]=next[3*r+1];p[i+2]=next[3*r+2];
    }
  }
  // Lay the descending pectorals across the faired sternum. Their distal fibres
  // fan laterally onto the humeri. The aponeurosis narrows toward the waist.
  for(const {i} of rows) {
    const x=Math.abs(p[3*i]),h=p[3*i+1],z=p[3*i+2];
    const surface=ramp(.63,.759,z)*(1-ramp(.188,.236,x));
    const descending=.030*bell(h-(1.235-.80*x),.073)*bell(x-.097,.099);
    const transverse=.015*bell(h-(1.105-.46*x),.052)*bell(x-.118,.081);
    const cleft=-.013*bell(x,.035)*bell(h-1.15,.137);
    const oblique=.016*bell(x-(.122+.24*(1.48-h)),.037)*bell(h-1.4,.111);
    p[3*i+2]+=surface*(descending+transverse+cleft+oblique);
  }
}

export function buildCentaurB3(basePositions, baseIndices) {
  const positions=[], indices=[], map=new Map(), cutEdges=new Map();
  const loops=[[],[],[],[]];
  function original(i) {
    if(!map.has(i)) {
      map.set(i,positions.length/3);
      positions.push(...bodyPoint(...basePositions.subarray(3*i,3*i+3)));
    }
    return map.get(i);
  }
  function intersection(a,b) {
    const key=Math.min(a,b)*basePositions.length+Math.max(a,b);
    if(cutEdges.has(key))return cutEdges.get(key);
    const h=basePositions[a*3+1],t=(cutHeight-h)/(basePositions[b*3+1]-h);
    const x=basePositions[a*3]+t*(basePositions[b*3]-basePositions[a*3]);
    const z=basePositions[a*3+2]+t*(basePositions[b*3+2]-basePositions[a*3+2]);
    const id=positions.length/3;
    cutEdges.set(key,id);loops[(x>0?2:0)+(z>0?1:0)].push(id);
    positions.push(...bodyPoint(x,cutHeight,z));return id;
  }
  for(let f=0;f<baseIndices.length;f+=3) {
    const tri=baseIndices.subarray(f,f+3);
    const keep=tri.map(i=>Number(basePositions[3*i+1]>=cutHeight || basePositions[3*i+2]<-.91));
    const count=keep[0]+keep[1]+keep[2];
    if(count===3) {indices.push(...Array.from(tri,original));continue;}
    if(count===0)continue;
    const poly=[];
    for(let k=0;k<3;k++) {
      const next=(k+1)%3;
      if(keep[k])poly.push(original(tri[k]));
      if(keep[k]!==keep[next])poly.push(intersection(tri[k],tri[next]));
    }
    for(let k=1;k<poly.length-1;k++)indices.push(poly[0],poly[k],poly[k+1]);
  }
  for(let i=0;i<4;i++) legSurface(positions,indices,loops[i],i<2?-1:1,Boolean(i%2));
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setIndex(indices);fairForequarters(geometry);
  geometry.computeVertexNormals();geometry.computeBoundingBox();
  geometry.name='Centaur B.3 static anatomy';
  return geometry;
}

// The checked-in B.2 seed contains a single indexed, tightly packed triangle primitive.
export async function loadCentaurB3Geometry() {
  const url=new URL('./centaur-b2.glb',import.meta.url);
  const response=await fetch(url);
  if(!response.ok)throw new Error('Unable to load the B.2 centaur geometry');
  const bytes=await response.arrayBuffer(),header=new DataView(bytes);
  const jsonLength=header.getUint32(12,true);
  const gltf=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,jsonLength)));
  const primitive=gltf.meshes[0].primitives[0],start=28+jsonLength;
  function attribute(id,Type,size) {
    const acc=gltf.accessors[id],view=gltf.bufferViews[acc.bufferView];
    return new Type(bytes,start+(view.byteOffset||0)+(acc.byteOffset||0),acc.count*size);
  }
  return buildCentaurB3(attribute(primitive.attributes.POSITION,Float32Array,3),
    attribute(primitive.indices,Uint32Array,1));
}
