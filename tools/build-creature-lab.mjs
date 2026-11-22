// Rebuild the downloadable lab with the same sources as the HTTP entry point.
import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
const dir=new URL('../creature-lab/',import.meta.url);
const html=await readFile(new URL('index.html',dir),'utf8');
const css=await readFile(new URL('style.css',dir),'utf8');
const {outputFiles}=await build({
  entryPoints:[new URL('app.js',dir).pathname],
  bundle:true,format:'iife',target:'es2022',minify:true,write:false
});
const script=outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
await writeFile(new URL('standalone.html',dir),html
  .replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+css+'</style>')
  .replace('<script type="module" src="app.js"></script>',()=>'<script>'+script+'</script>'));
