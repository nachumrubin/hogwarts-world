"""Reproduce matched plates, identity checks and the LOD0 material experiment."""
import argparse
import base64
import io
import sys

import numpy as np
from PIL import Image
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import threading
from functools import partial
from http.server import ThreadingHTTPServer
from statistics import median

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'creature-lab/review/owl-a8.1'
BASE = 'f27f32f'
spec = importlib.util.spec_from_file_location('capture', ROOT/'tools/capture-owl-a8.py')
capture = importlib.util.module_from_spec(spec)
sys.dont_write_bytecode = True
spec.loader.exec_module(capture)


def without(source, start, end):
    first = source.index(start)
    return source[:first] + source[source.index(end, first):]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--visual-costs",action="store_true",help="Measure the image change from each A8 material ablation")
    args = parser.parse_args()
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        site = Path(tmp)
        (site/'creature-lab').symlink_to(ROOT/'creature-lab')
        base = site/'base'
        base.mkdir()
        with (site/'base.tar').open('wb') as archive:
            subprocess.run(['git','archive',BASE,'creature-lab/species','creature-lab/vendor'],
                           cwd=ROOT,stdout=archive,check=True)
        subprocess.run(['tar','-xf',str(site/'base.tar'),'-C',str(base)],check=True)
        scene = (ROOT/'tools/owl-a8-scene.js').read_text().replace(
            '/creature-lab/species/a7-owl.js','/base/creature-lab/species/owl.js'
        ).replace("i?'A8':'A7'", "i?'A8.1':'A8'")
        (site/'scene.js').write_text(scene)
        (site/'index.html').write_text('<link rel="icon" href="data:,"><script type="module" src="/scene.js"></script>')
        with ThreadingHTTPServer(('127.0.0.1',0),partial(capture.Quiet,directory=site)) as server, sync_playwright() as pw:
            threading.Thread(target=server.serve_forever,daemon=True).start()
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--enable-unsafe-swiftshader','--use-angle=swiftshader'])
            source = (base/'creature-lab/species/owl-finish.js').read_text()
            variants = {
                'A8':source,
                'A8 without fringe':without(source,".replace('#include <opaque_fragment>'",".replace('#include <lights_fragment_end>'"),
                'A8 without relief':without(source,'vec3 owlDx=', '#endif'),
                'A8 without transmission':source.replace('#if OWL_FINISH_DETAIL && !defined(OWL_SKIP_TRANSMISSION)','#if 0'),
            }
            pages = {}
            errors = []
            for label,material in variants.items():
                page = browser.new_page()
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
                page.route('**/base/creature-lab/species/owl-finish.js',lambda r,request,src=material:r.fulfill(content_type='text/javascript',body=src))
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.wait_for_function('window.owlA8 !== undefined')
                pages[label] = page
            # The baseline and patch share the same context and lights for each plate.
            page = pages['A8']
            renderer = page.evaluate('owlA8.renderer')
            assert 'swiftshader' in renderer.lower(),renderer
            if args.visual_costs:
                stats = {}
                for view in ('face','spread','ventral'):
                    previous = None
                    stats[view] = {}
                    for label,variant_page in pages.items():
                        data = variant_page.evaluate('v=>owlA8.plate(v)',view)
                        frame = np.asarray(Image.open(io.BytesIO(base64.b64decode(data))),dtype=float)[32:,:680]
                        if previous is None:
                            previous = frame
                            continue
                        bird = np.max(abs(previous-previous[0,0]),axis=2)>12
                        change = np.max(abs(previous-frame),axis=2)[bird]
                        stats[view][label] = {'percentOwlPixelsOver8of255':100*float(np.mean(change>8)),
                                              'meanMaxChannelChange':float(change.mean())}
                assert not errors,errors
                (OUT/'visible-costs.json').write_text(json.dumps(stats,indent=2))
                return
            identity = page.evaluate('owlA8.identity()')
            assert all(all(list(row.values())[1:]) for row in identity)
            (OUT/'identity.json').write_text(json.dumps(identity,indent=2))
            for view,light in [('ventral','studio'),('ventral','daylight'),('face','studio'),('spread','studio')]:
                image = page.evaluate('args=>owlA8.plate(...args)',[view,light])
                (OUT/f'{light}-{view}.jpg').write_bytes(base64.b64decode(image))
            historical = site/'a7'
            historical.mkdir()
            with (site/'a7.tar').open('wb') as archive:
                subprocess.run(['git','archive',capture.BASE,'creature-lab/species','creature-lab/vendor'],cwd=ROOT,stdout=archive,check=True)
            subprocess.run(['tar','-xf',str(site/'a7.tar'),'-C',str(historical)],check=True)
            old = browser.new_page()
            old.on('pageerror',lambda e:errors.append(str(e)))
            old.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
            old.route('**/scene.js',lambda r:r.fulfill(content_type='text/javascript',body=scene.replace('/base/','/a7/')))
            old.goto(f'http://127.0.0.1:{server.server_port}/')
            old.wait_for_function('window.owlA8 !== undefined')
            pages['A7'] = old
            pages['A8.1'] = page
            runs = []
            for order in (list(pages),list(reversed(pages)),list(pages)[2:]+list(pages)[:2]):
                for label in order:
                    pages[label].bring_to_front()
                    row = pages[label].evaluate("name=>owlA8.benchmark(0,name,'matched')",'A8' if label=='A8.1' else 'A7')
                    row['variant'] = label
                    runs.append(row)
                    print(label,round(median(row['samples']),1),flush=True)
            assert not errors,errors
            result = {'adapter':renderer,'method':'640x500, 14 warm-up and 42 measured flight frames per run, synchronized pixel readback',
                      'medianMs':{k:median(median(r['samples']) for r in runs if r['variant']==k) for k in pages},'runs':runs}
            (OUT/'software.json').write_text(json.dumps(result,indent=2))
            browser.close()
            server.shutdown()


if __name__ == '__main__':
    main()
