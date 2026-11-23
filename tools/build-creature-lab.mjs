// Build the downloadable lab or stage a cache-safe GitHub Pages site.
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {cp,readFile,rm,writeFile} from 'node:fs/promises';

const dir=new URL('../creature-lab/',import.meta.url);
const pageStyle='<link rel="stylesheet" href="style.css">';
const pageScript='<script type="module" src="app.js"></script>';
const html=await readFile(new URL('index.html',dir),'utf8');
const css=await readFile(new URL('style.css',dir),'utf8');
const {outputFiles}=await build({
  entryPoints:[new URL('app.js',dir).pathname],
  bundle:true,format:'iife',target:'es2022',minify:true,write:false
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
  const jsName='app-'+hash(script)+'.js';
  const cssName='style-'+hash(css)+'.css';
  const page=html
    .replace(pageStyle,'<link rel="stylesheet" href="'+cssName+'">')
    .replace(pageScript,'<script type="module" src="'+jsName+'"></script>');
  await rm(out,{recursive:true,force:true});
  await cp(dir,out,{recursive:true});
  await Promise.all([
    writeFile(new URL('index.html',out),page),
    writeFile(new URL('standalone.html',out),standalone),
    writeFile(new URL(jsName,out),script),
    writeFile(new URL(cssName,out),css)
  ]);
} else {
  await writeFile(new URL('standalone.html',dir),standalone);
}
