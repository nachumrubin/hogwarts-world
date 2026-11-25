// Skin the approved C.4 rest vertices once per LOD. All motion matrices
// are expressed in specimen coordinates, including the mirrored right foot.
import * as T from '../vendor/three.module.js';

export const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
export const legs=[-1,1].flatMap(s=>[false,true].map(fore=>{
 const x=s*(fore?.348:.32),shift=s*(fore?.065:.058);
 const points=(fore?[[1.70,.50],[.99,.432],[.46,.605],[.092,.72]]:
   [[1.56,-.932],[1.09,-.642],[.63,-1.052],[.212,-.993],[.103,-.917]])
   .map(([y,z])=>V(x,y,z+shift));
 return {s,fore,points};
}));
const toeEnds=[[-.258,.305],[.016,.412],[.258,.279],[-.097,-.271]];
export const toes=toeEnds.map(([x,z])=>V(x,0,z));
const identity=new T.Matrix4();
const paletteNames=['spine','neck','skull','tailRoot','tailTip','ruff'];
for(let k=0;k<2;k++)paletteNames.push('eye'+k,'lid'+k,...['shoulder','elbow','wrist','primary','secondary'].map(n=>n+k));
for(let k=0;k<4;k++){
 for(let j=0;j<legs[k].points.length;j++)paletteNames.push('leg'+k+'_'+j);
 if(legs[k].fore)for(let d=0;d<4;d++)paletteNames.push('toe'+k+'_'+d);
}
export const boneIndex=Object.fromEntries(paletteNames.map((v,i)=>[v,i]));
const neckMix=p=>smooth((p.y-1.78)/.68)*smooth((p.z-.22)/.58);
function binding(region,p,k,detail){
 const pair=(a,b,w)=>[boneIndex[a],boneIndex[b],clamp(w)];
 if(region==='wing'){
   const side=Number(p.x>0),x=Math.abs(p.x),tip=clamp(detail?.y??0);
   const names=['shoulder','elbow','wrist',x<1.85?'secondary':'primary'].map(n=>n+side);
   if(x<.56)return pair('spine',names[0],smooth((x-.22)/.34));
   if(x<1.30)return pair(names[0],names[1],smooth((x-.82)/.48));
   if(x<2.1 && p.z>-.25)return pair(names[1],names[2],smooth((x-1.48)/.57));
   return pair(x<1.8?names[1]:names[2],names[3],Math.max(tip,smooth((x-2.05)/1.4),smooth((-.22-p.z)/.94)));
 }
 if(region==='folded')return pair('spine','spine',0);
 if(region==='orbit'||region==='lid')return pair('skull',(region==='orbit'?'eye':'lid')+Number(p.x>0),1);
 if(region==='head')return pair('skull','skull',0);
 if(region==='tail')return pair('tailRoot','tailTip',smooth((1.52-p.y)/.87));
 if(region==='body'||region==='ruff'){
   if(p.y>2.29 && p.z>.57)return pair('neck','skull',smooth((p.y-2.29)/.31));
   if(region==='ruff'&&p.y<2.14)return pair('neck','ruff',1-smooth((p.y-1.97)/.17));
   return pair('spine','neck',neckMix(p));
 }
 const {points,s,fore}=legs[k],key=j=>'leg'+k+'_'+j;
 if(region==='foot'){
   const palm=points.at(-1),dx=(p.x-palm.x)*s,dz=p.z-palm.z+.02;
   let best=-Infinity,digit=0,fraction=0;
   toes.forEach((end,i)=>{const along=(dx*end.x+dz*end.z)/end.length(),off=Math.abs(dx*end.z-dz*end.x)/end.length();
     if(along-3*off>best){digit=i;best=along-3*off;fraction=along/end.length();}});
   return pair(key(points.length-1),'toe'+k+'_'+digit,smooth((fraction-.12)/.54));
 }
 if(p.y>points[0].y-.05)return pair(key(0),'spine',smooth((p.y-points[0].y+.05)/.24));
 for(let j=1;j<points.length;j++){
   const radius=j===1?.15:j===2?.105:.055;
   if(p.y>points[j].y-radius)return pair(key(j-1),key(j),smooth((points[j].y+radius-p.y)/(2*radius)));
 }
 return pair(key(points.length-1),key(points.length-1),0);
}

// Primary, secondary and covert follicles retain their own order through
// folding. Both poses are sampled along the same shaft and across each vane.
function foldedTarget(open,closed){
 const pos=open.attributes.position,n=pos.count,target=new Float32Array(n*3),normal=new Float32Array(n*3),lift=new Float32Array(n*3);
 const src=closed.attributes.position,sn=closed.attributes.normal,rows=open.userData.vanes,dst=closed.userData.vanes;
 const v=V();
 for(let f=0;f<(rows?.length??1);f++){
   const row=rows?.[f];
   const start=row?.offset??0,count=row?(row.steps+1)*row.stride:n;
   let ref;
   if(row){
     const index=f<15?10+Math.round(f*12/14):f<25?f-15:23+Math.round((f-25)*(dst.length-24)/(rows.length-26));
     ref=dst[index];
   }
   for(let j=0;j<count;j++){
     const i=start+j;
     let a,b,t;
     if(ref){
       const g=Math.floor(j/row.stride)/row.steps*ref.steps;
       a=ref.offset+Math.floor(g)*ref.stride+j%row.stride;b=Math.min(ref.offset+ref.steps*ref.stride+j%row.stride,a+ref.stride);t=g%1;
     }else{
       // The two arm envelopes are swept in different directions. Match
       // normalized longitudinal stations and radial angle at the wrist.
       const sides=open.userData.sides,cs=closed.userData.sides;
       const g=Math.floor(i/sides)/(n/sides-1)*(src.count/cs-1),radial=(Math.round((i%sides)/sides*cs)+Math.round(cs/4))%cs;
       a=Math.floor(g)*cs+radial;b=Math.min(src.count-cs+radial,a+cs);t=g%1;
     }
     for(let d=0;d<3;d++){
       target[3*i+d]=src.array[3*a+d]*(1-t)+src.array[3*b+d]*t;
       normal[3*i+d]=sn.array[3*a+d]*(1-t)+sn.array[3*b+d]*t;
     }
     v.fromBufferAttribute(pos,i);const reach=clamp((Math.abs(v.x)-.26)/2.5);
     lift[3*i]=Math.sign(v.x)*(.28+.48*reach)*smooth((Math.abs(v.x)-.23)/.48);
     lift[3*i+1]=.37*reach;
   }
 }
 for(let i=0;i<n*3;i++){target[i]-=pos.array[i];normal[i]-=open.attributes.normal.array[i];}
 open.morphAttributes.position=[new T.Float32BufferAttribute(target,3),new T.Float32BufferAttribute(lift,3)];
 open.morphAttributes.normal=[new T.Float32BufferAttribute(normal,3),new T.Float32BufferAttribute(new Float32Array(n*3),3)];
 open.morphTargetsRelative=true;
}

export function bindSpecimen(actor){
 const bones=paletteNames.map(name=>{const bone=new T.Bone();bone.name=name;actor.body.add(bone);return bone;});
 const skeleton=new T.Skeleton(bones,bones.map(()=>identity.clone()));
 const original=actor.root.position.clone();actor.root.position.set(0,0,0);
 actor.body.add(actor.folded,actor.extended);actor.root.updateMatrixWorld(true);
 const groups={folded:[],wing:[]},records=[];
 for(const [i,part] of actor.parts.entries()){
   const m=part.mesh;
   let region=i===0?'body':i===1?'ruff':'head',k=0;
   for(let p=m;p;p=p.parent){
     if(p===actor.folded){region='folded';break;}
     if(p===actor.extended){region='wing';break;}
     if(p.name==='tail'){region='tail';break;}
     if(p.name==='orbit'){region=p.children.indexOf(m)<3?'orbit':'lid';break;}
     if(p.name==='fore'||p.name==='hind'){
       k=legs.findIndex(l=>l.fore===(p.name==='fore')&&l.s===Math.sign(p.position.x));
       region=m.parent.name==='talons'?'foot':'leg';break;
     }
   }
   const record={part,region,k,matrix:m.matrixWorld.clone(),make:part.make,levels:part.levels.slice()};
   records.push(record);groups[region]?.push(record);
 }
 function bake(record,lod){
   const g=record.levels[lod]??record.make(lod);
   g.applyMatrix4(record.matrix);
   if(record.matrix.determinant()<0){const ix=g.index.array;for(let i=0;i<ix.length;i+=3)[ix[i],ix[i+1]]=[ix[i+1],ix[i]];}
   const p=g.attributes.position,ids=new Uint16Array(p.count*4),weights=new Float32Array(ids.length),v=V(),detail=V();
   for(let i=0;i<p.count;i++){
     v.fromBufferAttribute(p,i);if(g.attributes.clayDetail)detail.fromBufferAttribute(g.attributes.clayDetail,i);
     const [a,b,w]=binding(record.region,v,record.k,detail);
     ids[4*i]=a;ids[4*i+1]=b;weights[4*i]=1-w;weights[4*i+1]=w;
   }
   g.setAttribute('skinIndex',new T.Uint16BufferAttribute(ids,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));
   if(record.region==='wing'){
     const partner=groups.folded[groups.wing.indexOf(record)];
     const closed=partner.part.levels[lod]??=partner.part.make(lod);
     g.userData.sides=closed.userData.sides=[20,12,7][lod];
     foldedTarget(g,closed);
   }
   return g;
 }
 for(const record of records){
   const part=record.part,m=part.mesh;
   part.make=lod=>bake(record,lod);part.levels=[];
   const g=part.levels[actor.level]=part.make(actor.level);
   const skin=new T.SkinnedMesh(g,m.material);skin.frustumCulled=false;skin.bind(skeleton,identity);
   skin.userData.clayTone=Math.min(1,Math.sqrt(m.material.color.r/.462));skin.name=record.region;m.removeFromParent();actor.body.add(skin);part.mesh=skin;record.mesh=skin;
 }
 actor.root.position.copy(original);
 actor.folded.removeFromParent();actor.extended.removeFromParent();
 return {bones,skeleton,groups};
}
