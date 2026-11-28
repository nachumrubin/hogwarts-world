// Export the original rig's bind landmarks for the offline surface fit.
import {Unicorn} from '../creature-lab/species/unicorn.js';
import {Vector3} from '../creature-lab/vendor/three.module.js';
const actor=new Unicorn();
const position=node=>node.getWorldPosition(new Vector3()).toArray();
actor.root.updateMatrixWorld(true);
const bones=[...actor.cervical.bones,actor.head,...actor.horse.legs.flatMap(l=>l.bones),actor.horse.tail];
const inverse=bones.map(b=>b.matrixWorld.clone().invert());
const rig={
  neck:actor.cervical.bones.map(position),head:position(actor.head),
  legs:actor.horse.legs.map(leg=>({side:leg.side,fore:leg.fore,sole:position(leg.sole),bones:leg.bones.map(position)})),
  grazing:[]
};
for(const reach of [.5,1]){
  actor.graze=reach;
  actor.update(0,0,'Graze',{terrainHeight:()=>0});
  actor.root.updateMatrixWorld(true);
  rig.grazing.push(bones.map((b,i)=>b.matrixWorld.clone().multiply(inverse[i]).toArray()));
}
console.log(JSON.stringify(rig));
