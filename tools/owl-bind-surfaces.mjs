import {Owl} from '../creature-lab/species/owl.js';
import {Vector3} from '../creature-lab/vendor/three.module.js';
const owl=new Owl();
owl.root.updateMatrixWorld(true);
const surfaces=[owl.breast,...owl.wings.flatMap(wing=>wing.joints.flatMap(j=>j.children.filter(c=>c.isMesh)))];
const vertex=new Vector3();
console.log(JSON.stringify(surfaces.map(mesh=>{
  const count=mesh.geometry.attributes.position.count;
  return Array.from({length:count},(_,i)=>mesh.getVertexPosition(i,vertex).applyMatrix4(mesh.matrixWorld).toArray());
})));
