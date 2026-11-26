"""Export the interactive A7 timeline at fixed 60 Hz."""

import argparse
import base64
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'creature-lab/review/owl-a7'
CLIPS = {
    'sequence': (0, 1220, 'quarter', False, False),
    'flight-front': (593, 960, 'front', False, False),
    'flight-side': (593, 960, 'side', False, False),
    'flight-quarter': (593, 960, 'quarter', False, False),
    'takeoff': (497, 575, 'perch', False, False),
    'landing': (1028, 1148, 'perch', False, False),
    'wing-articulation': (593, 960, 'quarter', True, False),
    'takeoff-contact': (517, 556, 'feet', False, True),
    'landing-contact': (1068, 1130, 'feet', False, True),
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def encode(temp, output, speed):
    subprocess.run([
        'ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(speed), '-f', 'mjpeg',
        '-i', str(temp), '-r', '60', '-c:v', 'libx264', '-threads', '2', '-crf', '20',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(output),
    ], check=True)


def compare_field_footage(source):
    # Marc Plomp / Stichting Natuurbeelden, CC BY-SA 3.0 NL. Full attribution in the review.
    stamp = 'x=12:y=15:fontsize=19:fontcolor=white:box=1:boxcolor=black@0.78:boxborderw=7'
    reference = (
        "[0:v]scale=640:360:force_original_aspect_ratio=decrease,"
        "pad=640:360:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=60,"
        f"drawtext=text='Real barn owl · field footage':{stamp}[ref]"
    )
    animation = "[1:v]setsar=1[sim]"
    start,end,*_ = CLIPS['flight-quarter']
    subprocess.run([
        'ffmpeg', '-loglevel', 'error', '-y', '-ss', '362', '-i', str(source),
        '-i', str(OUT / 'flight-quarter.mp4'),
        '-filter_complex', ';'.join([reference, animation, '[ref][sim]hstack=shortest=1']),
        '-an', '-frames:v', str(end - start + 1), '-c:v', 'libx264', '-threads', '2',
        '-crf', '21', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart', str(OUT / 'reference-flight-comparison.mp4')
    ], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('clips', nargs='*', metavar='CLIP',
                        help='Optional subset of ' + ', '.join(CLIPS))
    parser.add_argument('--field-reference',type=Path,help='Create the comparison from the original Plomp WebM and an existing flight-quarter.mp4')
    args = parser.parse_args()
    if args.field_reference:
        compare_field_footage(args.field_reference)
        raise SystemExit(0)
    names = args.clips or CLIPS
    unknown = set(names) - CLIPS.keys()
    if unknown:
        parser.error('Unknown clips: ' + ', '.join(sorted(unknown)))

    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=ROOT)) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as pw, tempfile.TemporaryDirectory() as scratch:
            browser = pw.chromium.launch(executable_path='/usr/bin/chromium',
                args=['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'])
            page = browser.new_page(viewport={'width': 920, 'height': 740})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.goto(f'http://127.0.0.1:{server.server_port}/creature-lab/review/owl-a7/inspect.html')
            page.wait_for_function('window.owlReview !== undefined')
            for name in names:
                start, end, angle, wings, contact = CLIPS[name]
                temp = Path(scratch) / 'frames.mjpeg'
                with temp.open('wb') as out:
                    for i in range(start, end + 1):
                        data = page.evaluate('args=>owlReview.capture(...args)', [i, angle, wings, contact])
                        if errors:
                            raise RuntimeError('\n'.join(errors))
                        out.write(base64.b64decode(data))
                encode(temp, OUT / f'{name}.mp4', 60)
                encode(temp, OUT / f'{name}-slow.mp4', 15)
                print(name, flush=True)
        server.shutdown()
