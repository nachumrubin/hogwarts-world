import {Merperson} from './merperson.js';
import {Hippogriff,actions as hippogriffActions} from './hippogriff-motion.js';
import {Owl} from './owl.js';
import {Unicorn} from './unicorn.js';
import {Centaur} from './centaur.js';
export const catalog={
  centaur:{model:Centaur,name:'Centaur',latin:'Centaur',id:'003',lab:'Forest Glade',taxon:'Centaur',size:'2.24 m',zone:'Woodland',mood:'Watchful',actions:{Idle:'Idle breathing',Walk:'Four-beat walk',Trot:'Diagonal trot',Gallop:'Right-lead gallop',Turn:'Stepping turn',Stop:'Come to a standstill'}},
  unicorn:{model:Unicorn,name:'Unicorn',latin:'Unicorn',id:'004',lab:'Woodland Clearing',taxon:'Equine',size:'2.9 m',zone:'Woodland',mood:'Alert',actions:{Idle:'Quiet stance',Graze:'Grazing',Walk:'Four-beat walk',Alert:'Alert posture'}},
  owl:{model:Owl,name:'Barn Owl',latin:'Tyto alba',id:'005',lab:'Forest Roost',taxon:'Aves',size:'0.6 m',zone:'Forest edge',mood:'Observant',actions:{Perch:'Perching',Look:'Scan the roost',Fly:'Flight cycle',Fold:'Fold wings'}},
  hippogriff:{model:Hippogriff,name:'Hippogriff',latin:'Hippogriff',id:'006',lab:'Highland Paddock',taxon:'Avian–equine',size:'2.8 m',zone:'Uplands',mood:'Proud',actions:hippogriffActions},
  merperson:{model:Merperson,name:'Merperson',latin:'Great Lake merfolk',id:'007',lab:'Lake Shelf',taxon:'Merfolk',size:'2.8 m',zone:'Freshwater',mood:'Guarded',actions:{Idle:'Hover in place',Cruise:'Slow cruise',Swim:'Fast swim',Turn:'Bank left',TurnRight:'Bank right',Glide:'Glide',Brake:'Brake and stop'}}
};
