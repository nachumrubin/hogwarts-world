// All source observations come from the renderer and browser that execute the survey.
import { zipSync, strToU8 } from './vendor/fflate.js';

const specimens = ['squid', 'aragog'];
const angles = ['front', 'rear', 'left', 'right', 'above', 'three-quarter', 'close-up', 'habitat'];
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const rounded = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function stats(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!sorted.length) return {samples:0,mean:null,p50:null,p95:null};
  const percentile = p => sorted[Math.ceil(sorted.length*p)-1];
  return {
    samples: sorted.length,
    mean: rounded(sorted.reduce((a,b) => a+b,0)/sorted.length),
    p50: rounded(percentile(.5)),
    p95: rounded(percentile(.95))
  };
}

function environment(api) {
  return {
    recordedAt: new Date().toISOString(),
    browser: navigator.userAgent,
    renderer: api.metrics().renderer ?? null,
    framebuffer: { width:api.canvas.width, height:api.canvas.height },
    devicePixelRatio: window.devicePixelRatio,
    visibility: document.visibilityState,
    timing: 'Frame cadence is measured between requestAnimationFrame callbacks. CPU, animation and asynchronous GPU timings are read from the renderer. GPU timing is omitted when unavailable.',
    memory: 'Geometry bytes are the lab estimate for allocated geometry buffers. JS heap is a browser estimate when exposed. These metrics do not measure total GPU residency.',
    scope: 'Counts include creatures and their habitat. Each row uses one specimen kind. Multiple-copy rows instance two of that same kind.'
  };
}

async function sample(config, api) {
  await api.setCopies(config.copies);
  await api.setDistance(config.distance);
  const beforeLOD = performance.now();
  await api.setLOD(config.lod);
  const lodSetupMs = rounded(performance.now()-beforeLOD);
  const start = await nextFrame();
  const afterTransition = await nextFrame();
  const firstFrameMs = rounded(afterTransition-start);
  await nextFrame();
  await nextFrame();
  let previous = await nextFrame();
  const began = previous;
  const frames = [];
  do {
    const now = await nextFrame();
    const metrics = api.metrics();
    frames.push({
      frameMs: rounded(now-previous),
      cpuMs: rounded(metrics.cpuMs),
      animationMs: rounded(metrics.animationMs),
      gpuMs: rounded(metrics.gpuMs),
      triangles: metrics.triangles ?? null,
      drawCalls: metrics.drawCalls ?? null,
      geometryBytes: metrics.geometryBytes ?? null
    });
    previous = now;
  } while ((frames.length < 12 || previous-began < 900) && previous-began < 3500);
  const summaries = {};
  for (const key of Object.keys(frames[0])) summaries[key] = stats(frames.map(item => item[key]));
  return {
    ...config, lodSetupMs, firstFrameMs, measuredSeconds:rounded((previous-began)/1000),
    frames:frames.length, fps:rounded(frames.length*1000/(previous-began)),
    heapBytes:performance.memory?.usedJSHeapSize ?? null, summary:summaries, samples:frames
  };
}

async function specimenBenchmarks(api, specimen, report, progress) {
  const configs = [
    {distance:'near',lod:0,copies:1}, {distance:'medium',lod:1,copies:1},
    {distance:'far',lod:2,copies:1}, {distance:'medium',lod:1,copies:2}
  ];
  await api.setRunning(true);
  await api.setAngle('three-quarter');
  await api.setAction(specimen==='squid'?'Swim':'Walk');
  for (const config of configs) {
    progress('Benchmarking '+specimen+' · '+config.distance+' · '+config.copies+' specimen'+(config.copies===1?'':'s'));
    report.runs.push(await sample({...config,specimen},api));
  }
  await api.setCopies(1);
}

export async function exportBenchmarks(api, onProgress=()=>{}) {
  const report = {environment:environment(api), runs:[]};
  try {
    for (const specimen of specimens) {
      await api.switchCreature(specimen);
      await specimenBenchmarks(api,specimen,report,onProgress);
    }
    return report;
  } finally { await api.setCopies(1); }
}

function csv(report) {
  const fields = ['specimen','distance','lod','copies','frames','measuredSeconds','fps','lodSetupMs','firstFrameMs','frameMsMean','frameMsP95','cpuMsMean','animationMsMean','gpuMsMean','trianglesMean','drawCallsMean','geometryBytesMean','heapBytes'];
  const rows = report.runs.map(r => [r.specimen,r.distance,r.lod,r.copies,r.frames,r.measuredSeconds,r.fps,r.lodSetupMs,r.firstFrameMs,r.summary.frameMs.mean,r.summary.frameMs.p95,r.summary.cpuMs.mean,r.summary.animationMs.mean,r.summary.gpuMs.mean,r.summary.triangles.mean,r.summary.drawCalls.mean,r.summary.geometryBytes.mean,r.heapBytes]);
  return [fields,...rows].map(row=>row.map(value=>value??'').join(',')).join('\r\n')+'\r\n';
}

function png(canvas) {
  return new Promise((resolve,reject) => canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Canvas capture returned an empty frame.')),'image/png'));
}

async function record(canvas) {
  if (!canvas.captureStream || !globalThis.MediaRecorder) throw new Error('Canvas recording is unavailable in this browser.');
  const mimeType = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('This browser has no WebM encoder.');
  const stream = canvas.captureStream(24);
  try {
    const recorder = new MediaRecorder(stream,{mimeType,videoBitsPerSecond:3600000});
    const parts = [];
    recorder.addEventListener('dataavailable',event=>{if(event.data.size) parts.push(event.data);});
    const done = new Promise((resolve,reject)=>{
      recorder.addEventListener('stop',()=>resolve(new Blob(parts,{type:mimeType})),{once:true});
      recorder.addEventListener('error',event=>reject(event.error??new Error('WebM encoding failed.')),{once:true});
    });
    recorder.start();
    await pause(2800);
    if (recorder.state!=='inactive') recorder.stop();
    const blob = await done;
    if (!blob.size) throw new Error('WebM recorder produced an empty clip.');
    return blob;
  } finally { for (const track of stream.getTracks()) track.stop(); }
}

export async function runSurvey(api,onProgress=()=>{}) {
  const files = {};
  const report = {environment:environment(api),runs:[],media:[],warnings:[]};
  try {
    for (const specimen of specimens) {
      await api.switchCreature(specimen);
      await api.setCopies(1);
      await api.setLOD(0);
      await api.setRunning(false);
      for (const angle of angles) {
        onProgress('Photographing '+specimen+' · '+angle);
        await api.setAngle(angle);
        await nextFrame();
        await nextFrame();
        const path = specimen+'/stills/'+angle+'.png';
        files[path] = new Uint8Array(await (await png(api.canvas)).arrayBuffer());
        report.media.push(path);
      }
      const motions = specimen==='squid' ? [['Swim','three-quarter'],['Feed','left']] : [['Walk','left'],['Threat','three-quarter']];
      await api.setRunning(true);
      for (const [action,angle] of motions) {
        const path = specimen+'/clips/'+action.toLowerCase()+'-'+angle+'.webm';
        onProgress('Recording '+specimen+' · '+action);
        await api.setAction(action);
        await api.setAngle(angle);
        await nextFrame();
        try {
          files[path] = new Uint8Array(await (await record(api.canvas)).arrayBuffer());
          report.media.push(path);
        } catch (error) {report.warnings.push(path+' — '+error.message);}
      }
      await specimenBenchmarks(api,specimen,report,onProgress);
    }
    onProgress('Packaging evidence');
    files['benchmark.json'] = strToU8(JSON.stringify(report,null,2));
    files['benchmark.csv'] = strToU8(csv(report));
    const bytes = zipSync(files,{level:0});
    const filename = 'creature-lab-survey-'+report.environment.recordedAt.replace(/[:.]/g,'-')+'.zip';
    return {blob:new Blob([bytes],{type:'application/zip'}),filename,report};
  } finally {await api.setCopies(1);}
}
