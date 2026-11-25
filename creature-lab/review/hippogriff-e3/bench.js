import {Lab} from '../../lab.js';
import {captureStudy} from './capture.js';
let lab,url;
const button=document.querySelector('button'),message=document.querySelector('[role=status]'),link=document.querySelector('a');
button.onclick=async()=>{
 button.disabled=true;link.hidden=true;
 try{
  message.textContent='Measuring the control and hybrid surfaces…';
  lab??=new Lab(document.querySelector('canvas'),()=>{});
  lab.switchCreature('hippogriff');lab.advance(1/60);
  const result=await captureStudy(lab,document.querySelector('select').value,async()=>{});
  const json=JSON.stringify(result,null,2);
  document.querySelector('pre').textContent=json;
  if(url)URL.revokeObjectURL(url);
  url=URL.createObjectURL(new Blob([json],{type:'application/json'}));link.href=url;link.hidden=false;
  message.textContent='Measurements complete.';
 }catch(error){message.textContent=error.message;}
 finally{button.disabled=false;}
};
