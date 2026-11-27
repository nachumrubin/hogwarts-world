// Build the downloadable lab or stage a cache-safe GitHub Pages site.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {cp,readFile,rm,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const dir=new URL('../creature-lab/',import.meta.url);
const pageStyle='<link rel="stylesheet" href="style.css">';
const pageScript='<script type="module" src="app.js"></script>';
const html=await readFile(new URL('index.html',dir),'utf8');
const css=await readFile(new URL('style.css',dir),'utf8');
const atlases=Object.fromEntries(await Promise.all(['face','chest','coat','tail','iris'].map(async name=>{
 const image=await readFile(new URL('review/hippogriff-e3/assets/'+name+'.png',dir));
 return [name,'data:image/png;base64,'+image.toString('base64')];
})));
const merperson=await readFile(new URL('species/static/merperson-meshy.glb',dir));
const centaur=await readFile(new URL('species/static/centaur-meshy.glb',dir));
const options={
  entryPoints:[fileURLToPath(new URL('app.js',dir))],
  bundle:true,target:'es2022',minify:true,write:false
};
const {outputFiles}=await build({
  ...options,format:'iife',define:{
    HIPP_BUNDLED_ATLASES:JSON.stringify(atlases),
    MERPERSON_EMBEDDED_GLB:JSON.stringify('data:model/gltf-binary;base64,'+merperson.toString('base64')),
    CENTAUR_EMBEDDED_GLB:JSON.stringify('data:model/gltf-binary;base64,'+centaur.toString('base64'))
  },
  logOverride:{'empty-import-meta':'silent'}
});
const script=outputFiles[0].text;
if(!html.includes(pageStyle)||!html.includes(pageScript)) {
  throw Error('Creature Lab entry stylesheet or script tag changed.');
}
const standalone=html
  .replace(pageStyle,()=>'<style>'+css+'</style>')
  .replace(pageScript,()=>'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');

if (process.argv.includes('--pages')) {
  const out=new URL('../dist/creature-lab-pages/',import.meta.url);
  const hash=content=>createHash('sha256').update(content).digest('hex').slice(0,16);
  const {outputFiles:[{text:pagesScript}]}=await build({...options,format:'esm',define:{
    HIPP_PAGES_ATLASES:'true',MERPERSON_PAGES:'true',CENTAUR_PAGES:'true'
  }});
  const jsName='app-'+hash(pagesScript)+'.js';
  const cssName='style-'+hash(css)+'.css';
  const page=html
    .replace(pageStyle,'<link rel="stylesheet" href="'+cssName+'">')
    .replace(pageScript,'<script type="module" src="'+jsName+'"></script>');
  await rm(out,{recursive:true,force:true});
  await cp(dir,out,{recursive:true});
  await Promise.all([
    writeFile(new URL('index.html',out),page),
    writeFile(new URL('standalone.html',out),standalone),
    writeFile(new URL(jsName,out),pagesScript),
    writeFile(new URL(cssName,out),css)
  ]);
} else {
  await writeFile(new URL('standalone.html',dir),standalone);
}
