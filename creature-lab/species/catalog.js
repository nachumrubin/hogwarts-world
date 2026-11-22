import {Owl} from './owl.js';
import {Unicorn} from './unicorn.js';
import {Centaur} from './centaur.js';
export const catalog={
  centaur:{model:Centaur,name:'Centaur',latin:'Centaur',id:'003',lab:'Forest Glade',taxon:'Centaur',size:'3.0 m',zone:'Woodland',mood:'Watchful',actions:{Idle:'Idle breathing',Walk:'Four-beat walk',Turn:'Walking turn'}},
  unicorn:{model:Unicorn,name:'Unicorn',latin:'Unicorn',id:'004',lab:'Woodland Clearing',taxon:'Equine',size:'2.9 m',zone:'Woodland',mood:'Alert',actions:{Idle:'Quiet stance',Graze:'Grazing',Walk:'Four-beat walk',Alert:'Alert posture'}},
  owl:{model:Owl,name:'Barn Owl',latin:'Tyto alba',id:'005',lab:'Forest Roost',taxon:'Aves',size:'0.6 m',zone:'Forest edge',mood:'Observant',actions:{Perch:'Perching',Look:'Scan the roost',Fly:'Flight cycle',Fold:'Fold wings'}}
};
