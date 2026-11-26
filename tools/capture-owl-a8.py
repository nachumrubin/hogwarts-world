"""Render A7/A8 plates, motion, and matched SwiftShader or hardware runs."""

import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from statistics import median
import subprocess
import tempfile
import threading

from PIL import Image, ImageDraw, ImageOps
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'creature-lab/review/owl-a8'
BASE = '2e36fdfde1a0ca0f2403c2649d2c1fa774b82232'
MODULES = ('owl', 'owl-head', 'owl-wing', 'owl-batch', 'owl-plumage',
           'owl-body-albedo', 'owl-head-albedo', 'owl-wing-albedo', 'owl-motion')
LIGHTS = ('studio', 'daylight', 'overcast', 'sunset', 'moonlit', 'candlelight')
VIEWS = ('front', 'side', 'rear', 'quarter', 'face', 'eye', 'breast', 'dorsal',
         'folded', 'spread', 'ventral', 'legs', 'talons')


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def summary(row):
    ordered = sorted(row['samples'])
    return {key: value for key, value in row.items() if key not in ['samples', 'updates']} | {
        'medianMs': median(ordered), 'p95Ms': ordered[int(len(ordered)*.95+.999)-1],
        'medianAnimationMs': median(row['updates'])
    }


def aggregate(rows):
    summaries = [summary(row) for row in rows]
    return summaries[0] | {
        key: median(row[key] for row in summaries) for key in ('medianMs', 'p95Ms', 'medianAnimationMs')
    } | {'medianRangeMs': [min(row['medianMs'] for row in summaries), max(row['medianMs'] for row in summaries)]}


def write_json(filename, data):
    (OUT/filename).write_text(json.dumps(data, indent=2)+'\n')


def photo_board(pair, source, label, output, crop=None):
    width, height = 385, 350
    board = Image.new('RGB', (3*width, height+40), '#263330')
    draw = ImageDraw.Draw(board)
    image = Image.open(source).convert('RGB')
    if crop:
        image = image.crop(crop)
    pair = pair.convert('RGB')
    split = pair.width//2
    panels = [image, pair.crop((0,32,split,pair.height)),pair.crop((split,32,pair.width,pair.height))]
    marks = [label,'A7 procedural owl','A8 procedural owl']
    for n,(frame,name) in enumerate(zip(panels,marks)):
        frame = ImageOps.contain(frame,(width-6,height-6),Image.Resampling.LANCZOS)
        board.paste(frame,(n*width+(width-frame.width)//2,40+(height-frame.height)//2))
        draw.text((13+n*width,13),name,fill='#f5ecd8')
    board.save(OUT/output,quality=95)


def references():
    review=OUT.parent/'owl-a1'
    photo_board(Image.open(OUT/'studio-face.jpg'),review/'reference.jpg',
        'Wild barn owl / Steven Ward','reference-face.jpg',(177,63,408,292))
    photo_board(Image.open(OUT/'daylight-quarter.jpg'),review/'reference.jpg',
        'Wild barn owl / Steven Ward','reference-perched.jpg')
    with tempfile.TemporaryDirectory() as temp:
        raw=Path(temp)/'flight.png'
        subprocess.run(['ffmpeg','-y','-loglevel','error','-ss','0.43','-i',str(OUT/'flight.mp4'),
            '-frames:v','1',str(raw)],check=True)
        photo_board(Image.open(raw),review/'reference-flight.jpg',
            'Barn owl in flight / Tony Hisgett','reference-flight.jpg',(151,102,795,587))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('work', choices=['preview', 'stills', 'motion', 'measure', 'ablation', 'identity', 'references'])
    parser.add_argument('--hardware', action='store_true')
    args = parser.parse_args()
    if args.hardware and args.work not in ['measure','ablation']:
        parser.error('--hardware is used with measure or ablation')
    OUT.mkdir(exist_ok=True)
    if args.work == 'references':
        references()
        return
    flags = ['--no-sandbox']
    flags += ['--ignore-gpu-blocklist', '--disable-software-rasterizer'] if args.hardware else [
        '--enable-unsafe-swiftshader', '--use-angle=swiftshader']
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=ROOT)) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium', args=flags)
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.route('**/owl-a8-compare', lambda r: r.fulfill(content_type='text/html',
                body='<link rel="icon" href="data:,"><script type="module" src="/tools/owl-a8-scene.js"></script>'))
            for name in MODULES:
                text = subprocess.check_output(['git','show',f'{BASE}:creature-lab/species/{name}.js'],cwd=ROOT,text=True)
                for dependency in MODULES:
                    text = text.replace(f"'./{dependency}.js'",f"'./a7-{dependency}.js'")
                page.route(f'**/a7-{name}.js',
                    lambda route,request,source=text: route.fulfill(content_type='text/javascript',body=source))
            page.goto(f'http://127.0.0.1:{server.server_port}/owl-a8-compare')
            try:
                page.wait_for_function('window.owlA8 !== undefined', timeout=20000)
            except Exception as error:
                raise RuntimeError('\n'.join(errors) or str(error)) from error

            def invoke(code, data=None):
                answer = page.evaluate(code, data)
                if errors:
                    raise RuntimeError('\n'.join(errors))
                return answer

            if args.work == 'identity':
                data = invoke('()=>owlA8.identity()')
                assert all(all(list(row.values())[1:]) for row in data), data
                write_json('a7-regression.json', {'baselineCommit':BASE,'levels':data})
                print('Exact A7/A8 position, index and morph buffers, matrices and contact checks passed at each LOD',flush=True)
            if args.work in ['stills','preview']:
                plates=[(view,'studio') for view in VIEWS]
                plates += [(view,light) for light in LIGHTS[1:] for view in ('quarter','face','ventral')]
                if args.work=='preview':
                    plates=[('face','studio'),('quarter','studio'),('dorsal','studio'),('eye','studio'),('talons','studio'),('ventral','sunset'),('quarter','candlelight')]
                for view,light in plates:
                    jpg=invoke('args=>owlA8.plate(...args)',[view,light])
                    (OUT/f'{light}-{view}.jpg').write_bytes(base64.b64decode(jpg))
                    print(f'{light}-{view}',flush=True)
            if args.work == 'motion':
                for name,start,end,view,light in [
                    ('flight',593,960,'flight','daylight'),('takeoff',497,575,'perch','overcast'),
                    ('landing',1028,1148,'perch','sunset')
                ]:
                    output=OUT/f'{name}.mp4'
                    with tempfile.TemporaryDirectory() as temp:
                        frames=Path(temp)/'frames.mjpeg'
                        with frames.open('wb') as f:
                            for i in range(start,end+1,2):
                                jpg=invoke('args=>owlA8.motion(...args)',[i,view,light])
                                f.write(base64.b64decode(jpg))
                        subprocess.run(['ffmpeg','-y','-loglevel','error','-f','mjpeg','-framerate','30',
                            '-i',str(frames),'-c:v','libx264','-threads','2','-crf','19','-pix_fmt','yuv420p',
                            '-movflags','+faststart',str(output)],check=True)
                    print(name,flush=True)
            if args.work in ['measure','ablation']:
                renderer=invoke('()=>owlA8.renderer')
                software=any(t in renderer.lower() for t in ('swiftshader','software','llvmpipe','lavapipe','unidentified'))
                if args.hardware and software:
                    raise RuntimeError('A hardware adapter is required, Chromium reported '+renderer)
                kind='hardware' if args.hardware else 'swiftshader'
                ablation=args.work=='ablation'
                prefix=kind+('-matched-ablation' if ablation else '')
                variants=('A7','A7 no transmission','A8 full wing finish','A8','A8 fold morph only')
                primary=[(lod,rev,'matched') for lod in range(3) for rev in ('A7','A8')]
                extra=[(2,rev,'matched' if ablation else 'distant') for rev in variants]
                if ablation:
                    primary=[]
                collected=[]
                for i in range(3 if ablation else 4):
                    order=primary+(extra if i<3 else [])
                    if i%2:order=list(reversed(order))
                    for case in order:
                        result=invoke('args=>owlA8.benchmark(...args)',list(case))
                        collected.append(result)
                        print(i+1,*case,round(summary(result)['medianMs'],2),flush=True)
                    write_json(f'{prefix}-samples.json',{'renderer':renderer,'baselineCommit':BASE,'runs':collected})
                observations=[
                    aggregate([r for r in collected if (r['lod'],r['variant'],r['coverage'])==case])
                    for case in primary+extra
                ]
                write_json(f'{prefix}-measurements.json',{'renderer':renderer,'baselineCommit':BASE,
                    'adapterClass':kind,'resolution':[640,500],'warmupFrames':14,'framesPerRun':42,
                    'method':'Update, draw and synchronous RGBA readback. Median of per-run medians and p95s. The distant camera projects the same pose at 39% of the matched image scale.',
                    'rows':observations})
        server.shutdown()


if __name__=='__main__':
    main()
