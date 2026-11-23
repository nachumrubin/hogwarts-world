// Bind each visible neck ring to a rigid cross-section. Successive centres
// follow the resting centreline's segment lengths in physical coordinates.
import * as T from '../vendor/three.module.js';
import {smoothSections} from './form.js';

const firstStation=5;
const phases=[0,2,3,4];
const grazeAngles=[0,.16,.62,1.40,1.92,2.12,2.20,2.17,2.08];

export function cervicalBoneIndex(station){
  if(station<=firstStation)return 0;
  const offset=station-firstStation,whole=Math.floor(offset);
  return 1+whole*4+phases.indexOf(Math.round((offset-whole)*6));
}

export function cervicalRig(base,stations,pivot,scale){
  const metric=new T.Group();
  metric.scale.set(1/scale.x,1,1/scale.z);
  base.add(metric);
  const sections=smoothSections(stations,6);
  const angles=smoothSections(grazeAngles.map(a=>[a]),6);
  const rings=[];
  for(let i=firstStation*6;i<sections.length;i++){
    if(!phases.includes(i%6))continue;
    const [width,dorsalY,dorsalZ,ventralY,ventralZ]=sections[i];
    const bone=new T.Bone();
    metric.add(bone);
    const restY=(dorsalY+ventralY)*.5,restZ=(dorsalZ+ventralZ)*.5;
    bone.position.set(0,restY,restZ*scale.z);
    rings.push({bone,restY,restZ,angle:angles[i-firstStation*6][0],
      width,dorsalY,dorsalZ,ventralY,ventralZ});
  }
  const terminal=rings.at(-1);
  const neck=new T.Group();
  neck.scale.copy(scale);
  neck.position.set(0,pivot[1]-terminal.restY,(pivot[2]-terminal.restZ)*scale.z);
  terminal.bone.add(neck);
  return {
    bones:[base,...rings.map(r=>r.bone)],neck,
    // Mane roots use the same station, cross-section and deformation as skin.
    crest(station){
      const ring=rings[cervicalBoneIndex(station)-1],attachment=new T.Group();
      const x=-.30,v=Math.sqrt(1-x*x),t=(v+1)*.5;
      attachment.scale.copy(scale);
      attachment.position.set(
        scale.x*ring.width*Math.sign(x)*Math.abs(x)**.88*(.94+.09*v),
        T.MathUtils.lerp(ring.ventralY,ring.dorsalY,t)-ring.restY,
        scale.z*(T.MathUtils.lerp(ring.ventralZ,ring.dorsalZ,t)-ring.restZ)
      );
      ring.bone.add(attachment);
      return attachment;
    },
    pose(reach,idle){
      let y=rings[0].restY,z=rings[0].restZ*scale.z,previousAngle=0;
      for(let i=0;i<rings.length;i++){
        const ring=rings[i];
        const angle=ring.angle*reach+idle*(ring.angle/grazeAngles.at(-1));
        if(i){
          const previous=rings[i-1],mid=(angle+previousAngle)*.5;
          const dy=ring.restY-previous.restY,dz=(ring.restZ-previous.restZ)*scale.z;
          y+=dy*Math.cos(mid)-dz*Math.sin(mid);
          z+=dy*Math.sin(mid)+dz*Math.cos(mid);
        }
        ring.bone.position.set(0,y,z);
        ring.bone.rotation.x=angle;
        previousAngle=angle;
      }
      return previousAngle;
    }
  };
}
