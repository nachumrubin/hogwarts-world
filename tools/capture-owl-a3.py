"""Render matched owl plates and benchmark the requested revision pair."""
import argparse
import base64
import json
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from statistics import median
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = '747847b3640250ce291faa5903adf55bbb0d75e9'
OUT = ROOT / 'creature-lab/review/owl-a3'
parser = argparse.ArgumentParser()
parser.add_argument('pass_name', choices=['preview', 'stills', 'motion', 'measure', 'tracts', 'repeat', 'lighting-cost', 'all'])
parser.add_argument('--revision',type=int,choices=[3,4,5,6,7],default=3)
parser.add_argument('--views',nargs='+',help='Restrict the still pass to named views')
parser.add_argument('--hardware',action='store_true',help='Use the system GPU and require a hardware adapter (A7 benchmarks)')
args = parser.parse_args()
if args.hardware and (args.revision != 7 or args.pass_name not in ['measure','repeat']):
    parser.error('--hardware requires measure or repeat --revision 7')
if args.revision == 7 and args.pass_name in ['motion','all']:
    parser.error('For A7 clips use tools/capture-owl-a7.py')
current = args.revision
lighting_test = args.pass_name == "lighting-cost"
if lighting_test and current != 6:
    parser.error("lighting-cost uses --revision 6")
a4="f7217e34cb9f6e3fa3d0c2d18b533229eaa0aaa3"
a5="c1c93b17efb63717b309a55fd1b3b47ce47f94a9"
a6="b725b1a3b230a3bf2afc4335452f898f53f02b20"
if current == 7:
    BASE = a6
    OUT = OUT.with_name("owl-a7")
elif current == 6:
    BASE = a5
    OUT = OUT.with_name("owl-a6")
elif current == 5:
    BASE = a4
    OUT = OUT.with_name("owl-a5")
elif current == 4:
    BASE = 'd90871514cc4e57eb02c79a1722e277080fade4f'
    OUT = OUT.with_name('owl-a4')
OUT.mkdir(exist_ok=True)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    flags=['--no-sandbox']
    flags+=['--disable-software-rasterizer','--ignore-gpu-blocklist'] if args.hardware else ['--enable-unsafe-swiftshader','--use-angle=swiftshader']
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium',args=flags)
    page = browser.new_page()
    page.route('**/owl-compare', lambda r: r.fulfill(content_type='text/html',
        body='<script type="module" src="/tools/owl-a3-scene.js"></script>'))
    scene = (ROOT/'tools/owl-a3-scene.js').read_text().replace('const baseline=2;',f'const baseline={current-1};')
    page.route('**/owl-a3-scene.js', lambda r: r.fulfill(content_type='text/javascript',body=scene))
    modules = ['owl','owl-head','owl-wing','owl-plumage','owl-batch','owl-head-albedo','owl-wing-albedo']
    if current >= 4:
        modules.append('owl-body-albedo')
    if current < 7 or lighting_test:
        # Retain reproducibility of the historical A.2/A.3 plates.
        target = 'd908715' if current == 3 else a4 if current == 4 else a5 if current == 5 or lighting_test else a6
        for name in set(modules+['owl-body-albedo']):
            original=subprocess.check_output(['git','show',f'{target}:creature-lab/species/{name}.js'],cwd=ROOT,text=True)
            if lighting_test and name=='owl-wing':
                start=original.index("      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>'")
                end=original.index('    };',start)
                original=original[:start]+original[end:]
            page.route(f'**/species/{name}.js',lambda route, request, s=original: route.fulfill(content_type='text/javascript',body=s))
    for name in modules:
        source = subprocess.check_output(['git','show',f'{BASE}:creature-lab/species/{name}.js'],cwd=ROOT,text=True)
        for dependency in modules:
            source = source.replace(f"'./{dependency}.js'", f"'./a2-{dependency}.js'")
        page.route(f'**/a2-{name}.js',lambda route, request, s=source: route.fulfill(content_type='text/javascript',body=s))
    page.on('console',lambda m: print(m.text,flush=True) if m.type=='error' else None)
    page.on('pageerror',lambda error: print(error,flush=True))
    page.goto(f'http://127.0.0.1:{server.server_port}/owl-compare')
    page.wait_for_function('window.plate !== undefined')
    if args.pass_name in ['stills','preview','all']:
        names = 'front side rear quarter face breast folded above below silhouette flying'.split()
        if current == 4: names = 'front side rear quarter face folded breast talons above below'.split()
        if current == 5: names = 'front side rear quarter face folded talons above below headFront headSide'.split()
        if current >= 6: names = 'front side rear quarter face legs talons above below headFront headSide'.split()
        if args.views:
            if set(args.views)-set(names): parser.error('Unknown view for this revision')
            names=args.views
        for view in names:
            for mode in (['silhouette'] if view.startswith('head') else ['material'] if args.pass_name=='preview' or view in ['silhouette','flying'] else ['material','clay']):
                frame = page.evaluate('plate',[view,mode])
                (OUT/f'{view}-{mode}.jpg').write_bytes(base64.b64decode(frame))
        print('Stills complete',flush=True)
    if args.pass_name in ['stills','tracts','all'] and not args.views:
        (OUT/'tracts.jpg').write_bytes(base64.b64decode(page.evaluate('tractPlate()')))
    if args.pass_name in ['measure','all']:
        run=page.evaluate('measure()')
        if args.hardware and any(name in run['renderer'].lower() for name in ['swiftshader','llvmpipe','software','lavapipe','unidentified']):
            raise RuntimeError('Chromium reported a software renderer: '+run['renderer'])
        (OUT/('hardware-measurements.json' if args.hardware else 'measurements.json')).write_text(json.dumps(run,indent=2)+'\n')
        print('Benchmarks complete',flush=True)
    if args.pass_name == 'repeat' or lighting_test:
        results=[]
        dest=OUT if current == 7 else ROOT/'creature-lab/review/owl-a6'
        dest.mkdir(exist_ok=True)
        for reverse in [False,True,True,False]:
            run=page.evaluate('measure',reverse)
            if args.hardware and any(name in run['renderer'].lower() for name in ['swiftshader','llvmpipe','software','lavapipe','unidentified']):
                raise RuntimeError('Chromium reported a software renderer: '+run['renderer'])
            if lighting_test:
                for row in run['rows']:
                    row['revision']='A5 stock' if row['revision']=='A.5' else 'A5 transmission off'
            results.append(run)
            (dest/('a5-lighting-cost.json' if lighting_test else f'timings-a{current-1}-a{current}{"-hardware" if args.hardware else ""}.json')).write_text(json.dumps(results))
        if current == 7:
            rows=[]
            for lod in range(3):
                for revision in ['A.6','A.7']:
                    observations=[next(r for r in run['rows'] if r['lod']==lod and r['revision']==revision) for run in results]
                    summary={k:v for k,v in observations[0].items() if k not in ['samples','updateSamples']}
                    for key in ['medianMs','p95Ms','medianAnimationMs']:
                        summary[key]=median(row[key] for row in observations)
                    summary['range95']=[min(r['p95Ms'] for r in observations),max(r['p95Ms'] for r in observations)]
                    rows.append(summary)
            report={**results[0],'rows':rows,'aggregation':'Median of four per-run statistics, alternating A/B, B/A, B/A, A/B.'}
            (OUT/('hardware-measurements.json' if args.hardware else 'measurements.json')).write_text(json.dumps(report,indent=2)+'\n')
    if args.pass_name in ['motion','all']:
        for action in ['Look','Takeoff','Fly','Glide','Bank','Land']:
            command=['ffmpeg','-loglevel','error','-y','-framerate','20','-f','image2pipe','-vcodec','mjpeg','-i','-',
                '-c:v','libx264','-threads','2','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/f'{action.lower()}.mp4')]
            with subprocess.Popen(command,stdin=subprocess.PIPE) as process:
                for i in range(80):
                    process.stdin.write(base64.b64decode(page.evaluate('frame',[action,i])))
                process.stdin.close()
                if process.wait(): raise RuntimeError(action)
            print(action,flush=True)
server.shutdown()
