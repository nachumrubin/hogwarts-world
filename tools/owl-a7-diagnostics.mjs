import {readFileSync,writeFileSync} from 'node:fs';
import {Owl} from '../creature-lab/species/owl.js';
import {OwlTimeline,owlLastFrame,inspectOwlContact} from '../creature-lab/species/owl-inspection.js';

const review=new URL('../creature-lab/review/',import.meta.url);
const reference=JSON.parse(readFileSync(new URL('owl-a6/proportions.json',review)))[1];
const rounding=n=>Number.isFinite(n)?Number(n.toFixed(6)):null;
const owl=new Owl(),timeline=new OwlTimeline(owl),levels=[];
try {
  for(const lod of [0,1,2]){
    owl.setLOD(lod);
    timeline.seek(0);
    const rest=inspectOwlContact(owl);
    const minima={},details=[],transitions=[];
    let previous,plantedDriftMm=0;
    for(let frame=0;frame<=owlLastFrame;frame++){
      timeline.seek(frame);
      const p=owl.motion.pose;
      const check=inspectOwlContact(owl);
      if(p.state!==previous)transitions.push({state:p.state,frame});
      previous=p.state;
      if(p.state==='Perch'||p.state==='Look'||(p.land&&p.touchdownAge>.10)){
        for(const [side,pad] of check.pads.entries())
          plantedDriftMm=Math.max(plantedDriftMm,1000*Math.hypot(...pad.map((n,i)=>n-rest.pads[side][i])));
      }
      for(const [surface,distances] of Object.entries(check.clearanceMm)){
        const target=minima[surface]??=[null,null];
        for(const [side,value] of distances.entries()){
          if(Number.isFinite(value)&&(!target[side]||value<target[side].clearanceMm))
            target[side]={clearanceMm:value,frame};
        }
      }
      if(p.launch||p.land){
        details.push({
          frame,phase:p.state,padsMetres:check.pads.map(position=>position.map(rounding)),
          clearanceMm:Object.fromEntries(Object.entries(check.clearanceMm).map(([region,ns])=>[region,ns.map(rounding)]))
        });
      }
    }
    levels.push({lod,rest,plantedDriftMm,minima,transitions,details});
  }
}finally{owl.dispose();}
writeFileSync(new URL('owl-a7/contact-diagnostics.json',review),JSON.stringify({
  baselineCommit:'b725b1a3b230a3bf2afc4335452f898f53f02b20',
  sampleHz:60,positiveIsOutside:true,
  orderedFeet:['negative x','positive x'],
  perch:{lengthMetres:.44,radiiMetres:[.017,.019],centerMetres:[0,-.006,.011]},
  baselineMinimumMm:reference.minimumPerchClearanceMm,
  measurement:'Minimum signed radial clearance of sampled skinned mesh vertices for the tapered perch. Null denotes beyond the measured barrel. Endcaps and between-frame collisions are outside this sampled diagnostic.',
  levels
})+'\n');
