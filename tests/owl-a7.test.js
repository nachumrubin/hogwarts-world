import assert from 'node:assert/strict';
import test from 'node:test';
import {Vector3} from '../creature-lab/vendor/three.module.js';
import {Owl} from '../creature-lab/species/owl.js';
import {OwlTimeline, owlLastFrame, inspectOwlContact} from '../creature-lab/species/owl-inspection.js';
import {owlFrame, owlBlink} from '../creature-lab/species/owl-motion.js';
import {readFileSync} from 'node:fs';

const baseline=JSON.parse(readFileSync(new URL('../creature-lab/review/owl-a6/proportions.json',import.meta.url)))[1];
const snapshot=owl=>{
  owl.root.updateMatrixWorld(true);
  const result=[];
  owl.root.traverse(object=>{
    result.push(...object.matrixWorld.elements,...(object.morphTargetInfluences??[]));
  });
  return result;
};

test('A7 playback is deterministic across timestep sizes and timeline rewinds',()=>{
  const a=new Owl(),b=new Owl(),track=new OwlTimeline(a);
  try{
    assert.deepEqual(snapshot(a),snapshot(b));
    let time=0;
    const context={stimulus:new Vector3(.28,.34,-.50)};
    for(const [action,seconds] of [['Look',2],['Takeoff',2],['Fly',1],['Glide',1],['Bank',1],['Land',4],['Perch',1]]){
      const start=time;
      for(let i=0;i<seconds*120;i++){
        a.update(1/120,start+(i+1)/120,action,context);
        if(i%4===3)b.update(1/30,start+(i+1)/120,action,context);
      }
      time+=seconds;
      assert.deepEqual(snapshot(a),snapshot(b),action);
    }
    a.resetMotion();
    track.seek(1090);
    const expected=snapshot(a);
    track.seek(120);
    track.seek(1090);
    assert.deepEqual(snapshot(a),expected);
  }finally{a.dispose();b.dispose()}
});

test('A7 holds and returns both foot anchors and respects A6 clearance throughout the sequence',()=>{
  const owl=new Owl(),timeline=new OwlTimeline(owl);
  try{
    for(const lod of [0,1,2]){
      owl.setLOD(lod);
      timeline.seek(0);
      const rest=inspectOwlContact(owl);
      const limits=lod===0?baseline.minimumPerchClearanceMm:
        Object.fromEntries(Object.entries(rest.clearanceMm).map(([region,ns])=>[region,Math.min(...ns)]));
      if(lod===0)for(const [region,ns] of Object.entries(rest.clearanceMm))
        assert.ok(Math.abs(Math.min(...ns)-limits[region])<1e-9,region);
      const states=new Set();
      let previous=owl.root.position.clone();
      for(let frame=1;frame<=owlLastFrame;frame++){
        timeline.seek(frame);
        const p=owl.motion.pose;
        states.add(p.state);
        if(p.state==='Bank'&&p.age>.65)assert.ok(p.bank<-.17,'inside wing dips into the turn');
        assert.ok(owl.root.position.distanceTo(previous)<.16,'root trajectory continuity');
        previous.copy(owl.root.position);
        const contact=inspectOwlContact(owl);
        if(p.state==='Perch'||p.state==='Look')assert.deepEqual(contact.pads,rest.pads);
        for(const [region,distances] of Object.entries(contact.clearanceMm))
          assert.ok(Math.min(...distances)>=limits[region]-.05,`LOD ${lod}, ${region}, frame ${frame}`);
      }
      assert.deepEqual([...states],['Perch','Look','Takeoff','Fly','Glide','Bank','Land']);
      assert.deepEqual(inspectOwlContact(owl),rest);
    }
  }finally{owl.dispose()}
});

test('A7 finishes contact before honoring a new flight request during landing',()=>{
  const owl=new Owl();
  try{
    const rest=inspectOwlContact(owl).pads;
    let t=0;
    const update=action=>owl.update(owlFrame,t+=owlFrame,action);
    for(let i=0;i<145;i++)update('Fly');
    update('Land');
    assert.equal(owl.motion.state,'Land');
    let landed=false,launched=false;
    for(let i=0;i<240;i++){
      update('Bank');
      const p=owl.motion.pose;
      if(p.state==='Land'&&p.touchdownAge>.12){
        assert.deepEqual(inspectOwlContact(owl).pads,rest);
        landed=true;
      }
      if(p.state==='Takeoff'){
        assert.ok(landed);
        launched=true;
        break;
      }
    }
    assert.ok(launched);
  }finally{owl.dispose()}
});

test('A7 glide sheds its wingbeat and blinks have asymmetric timing and long holds',()=>{
  const bird=new Owl();
  try{
    let t=0;
    for(const [action,frames] of [['Fly',120],['Glide',120]])
      for(let i=0;i<frames;i++)bird.update(owlFrame,t+=owlFrame,action);
    assert.equal(bird.motion.state,'Glide');
    assert.ok(bird.motion.power<1e-5);
    assert.ok(bird.wings[0].joints[2].children.some(mesh=>mesh.morphTargetInfluences?.[1]>.04));
    let still=0,lagged=0,closed=0;
    for(let i=0;i<600;i++){
      const left=owlBlink(i*owlFrame,0),right=owlBlink(i*owlFrame,1);
      if(left===right&&left===0)still++;
      if(Math.abs(left-right)>.1)lagged++;
      if(left>.99)closed++;
    }
    assert.ok(still>500 && lagged>0 && closed>0);
  }finally{bird.dispose()}
});

test('A7 can land from different points on the circuit and from interrupted takeoff',()=>{
  const owl=new Owl();
  try{
    owl.setLOD(2);
    const rest=inspectOwlContact(owl);
    for(const [entry,frames] of [['Takeoff',30],['Fly',90],['Fly',295],['Glide',190],['Bank',250],['Bank',315]]){
      owl.resetMotion();
      for(let i=0;i<frames;i++)owl.update(owlFrame,0,entry);
      const previous=owl.root.position.clone();
      for(let i=0;i<240;i++){
        owl.update(owlFrame,0,'Land');
        assert.ok(owl.root.position.distanceTo(previous)<.17,`trajectory from ${entry} at frame ${frames}`);
        previous.copy(owl.root.position);
        const contact=inspectOwlContact(owl);
        for(const [region,distances] of Object.entries(contact.clearanceMm))
          assert.ok(Math.min(...distances)>=Math.min(...rest.clearanceMm[region])-.05,region);
        if(owl.motion.state==='Perch')break;
      }
      assert.equal(owl.motion.state,'Perch');
      assert.deepEqual(inspectOwlContact(owl),rest);
    }
  }finally{owl.dispose()}
});
