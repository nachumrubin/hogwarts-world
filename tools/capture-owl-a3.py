"""Capture the current owl and its approved A.2 foundation in a shared scene."""
import argparse
import base64
import json
import subprocess
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = '747847b3640250ce291faa5903adf55bbb0d75e9'
OUT = ROOT / 'creature-lab/review/owl-a3'
parser = argparse.ArgumentParser()
parser.add_argument('pass_name', choices=['preview', 'stills', 'motion', 'measure', 'tracts', 'all'])
args = parser.parse_args()

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path='/usr/bin/chromium',
        args=['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader'])
    page = browser.new_page()
    page.route('**/owl-compare', lambda r: r.fulfill(content_type='text/html',
        body='<script type="module" src="/tools/owl-a3-scene.js"></script>'))
    modules = ['owl','owl-head','owl-wing','owl-plumage','owl-batch','owl-head-albedo','owl-wing-albedo']
    for name in modules:
        source = subprocess.check_output(['git','show',f'{BASE}:creature-lab/species/{name}.js'],cwd=ROOT,text=True)
        for dependency in modules:
            source = source.replace(f"'./{dependency}.js'", f"'./a2-{dependency}.js'")
        page.route(f'**/a2-{name}.js',lambda route, request, s=source: route.fulfill(content_type='text/javascript',body=s))
    page.on('pageerror',lambda error: print(error,flush=True))
    page.goto(f'http://127.0.0.1:{server.server_port}/owl-compare')
    page.wait_for_function('window.plate !== undefined')
    if args.pass_name in ['stills','preview','all']:
        names = 'front side rear quarter face breast folded above below silhouette flying'.split()
        for view in names:
            for mode in (['material'] if args.pass_name=='preview' or view in ['silhouette','flying'] else ['material','clay']):
                frame = page.evaluate('plate',[view,mode])
                (OUT/f'{view}-{mode}.jpg').write_bytes(base64.b64decode(frame))
        print('Stills complete',flush=True)
    if args.pass_name in ['stills','tracts','all']:
        (OUT/'tracts.jpg').write_bytes(base64.b64decode(page.evaluate('tractPlate()')))
    if args.pass_name in ['measure','all']:
        (OUT/'measurements.json').write_text(json.dumps(page.evaluate('measure()'),indent=2))
        print('Benchmarks complete',flush=True)
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
