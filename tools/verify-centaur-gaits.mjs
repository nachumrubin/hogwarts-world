// Sample the rendered hoof bearing rims through both directions of every transition.
import assert from 'node:assert/strict';
import {Centaur} from '../creature-lab/species/centaur.js';
import {Vector3} from '../creature-lab/vendor/three.module.js';

for(const slope of [0,.035]){
  const actor=new Centaur(),legs=actor.horse.legs;
  const rims=legs.map(leg=>{
    const pos=leg.hoofMesh.geometry.attributes.position,points=[];
    for(let i=0;i<pos.count;i++)if(Math.abs(pos.getY(i)+leg.ref[4].y)<.00002)points.push(new Vector3().fromBufferAttribute(pos,i));
    return points;
  });
  assert.ok(rims.every(rim=>rim.length>=3),'All four hoof bearing rims must be present');
  const terrainHeight=(x,z)=>slope*(z+.2*x);
  let time=0,maxSlip=0,maxGroundError=0;
  const plants=new Map();
  for(const action of ['Walk','Trot','Gallop','Trot','Walk','Stop']){
    let flight=0,clearFlight=0,paired=0,firstPair=0,secondPair=0,walkSupport=4;
    const hits=[];
    for(let frame=0;frame<240;frame++){
      const prev=legs.map(l=>l.stance);
      actor.update(1/60,time+=1/60,action,{terrainHeight});actor.root.updateMatrixWorld(true);
      const down=legs.map(l=>l.stance),count=down.filter(Boolean).length;
      if(frame>90){
        if(!count){
          flight++;
          if(legs.every((leg,k)=>rims[k].every(point=>{
            const p=leg.hoofMesh.localToWorld(point.clone());
            return p.y-terrainHeight(p.x,p.z)>.004;
          })))clearFlight++;
        }
        if(count===2){paired++;if(down[0]&&down[3])firstPair++;if(down[1]&&down[2])secondPair++;}
        walkSupport=Math.min(walkSupport,count);
        down.forEach((d,i)=>{if(d&&!prev[i])hits.push(i);});
      }
      legs.forEach((leg,k)=>{
        if(!leg.stance){plants.delete(k);return;}
        const rim=rims[k].map(p=>leg.hoofMesh.localToWorld(p.clone()));
        for(const [i,p] of rim.entries()){
          maxGroundError=Math.max(maxGroundError,Math.abs(p.y-terrainHeight(p.x,p.z)));
          if(plants.has(k))maxSlip=Math.max(maxSlip,p.distanceTo(plants.get(k)[i]));
        }
        if(!plants.has(k))plants.set(k,rim);
      });
    }
    if(action==='Walk')assert.ok(walkSupport>=2&&hits.length>=4&&hits.every((k,i)=>k===(hits[0]+i)%4));
    if(action==='Trot')assert.ok(clearFlight>0&&firstPair>0&&secondPair>0&&firstPair+secondPair===paired);
    if(action==='Gallop'){
      const order=[0,2,1,3];
      assert.ok(clearFlight>0&&hits.length>=8&&hits.every((k,i)=>k===order[(i+order.indexOf(hits[0]))%4]));
    }
    console.log({action,flight,clearFlight,hits:hits.join(''),maxSlip,maxGroundError});
  }
  assert.ok(maxSlip<.0002&&maxGroundError<.0002,'Planted hoof moved or left the terrain');
  actor.dispose();
}
