"""Render matched evidence: python tools/capture-equine-review.py LAB_PATH before|after.
Requires Playwright, Chromium (or --chromium PATH), and ffmpeg.
"""
import argparse
import base64
from contextlib import ExitStack
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from shutil import which
import subprocess
from threading import Thread
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "creature-lab/review/equine-correction"


class CaptureHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path in ("/", "/capture.mjs"):
            script = self.path.endswith(".mjs")
            data = (HERE / "equine-review-scene.mjs").read_bytes() if script else b"<!doctype html><title>Equine motion capture</title>"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript" if script else "text/html")
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()


def encode(name):
    return subprocess.Popen(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", "24", "-c:v", "mjpeg", "-i", "pipe:0",
        "-an", "-c:v", "libx264", "-threads", "2", "-crf", "17", "-preset", "fast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(OUT / name)], stdin=subprocess.PIPE)


def movie(page, names, cmd, frames):
    with ExitStack() as stack:
        writers = [stack.enter_context(encode(name)) for name in names]
        for frame in range(frames):
            images = page.evaluate(f"frame => {cmd}", frame)
            for writer, image in zip(writers, images, strict=True):
                writer.stdin.write(base64.b64decode(image))
        for writer in writers:
            writer.stdin.close()
            if writer.wait():
                raise RuntimeError("Encoding failed")


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("lab", type=Path)
    cli.add_argument("revision", choices=("before", "after"))
    cli.add_argument("--mode", choices=("all","walk","graze","neck"), default="all")
    cli.add_argument("--species", choices=("centaur", "unicorn"))
    cli.add_argument("--chromium", default=which("chromium"))
    opts = cli.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(CaptureHandler, directory=opts.lab.resolve())) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        with sync_playwright() as pw:
            chrome = pw.chromium.launch(executable_path=opts.chromium, args=["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
            page = chrome.new_page()
            page.goto(f"http://127.0.0.1:{server.server_port}/")
            page.evaluate("async () => { window.fixture = await import('/capture.mjs') }")
            for species in ([opts.species] if opts.species else ["centaur", "unicorn"]):
                suffix = f"-{opts.revision}.mp4"
                if opts.mode in ("all","walk"):
                    page.evaluate("kind=>fixture.reset(kind)", species)
                    movie(page, [species+"-"+name+suffix for name in ["walk-side", "walk-three-quarter", "joints"]],
                          "fixture.walk(frame)", 96)
                if species == "unicorn" and opts.mode in ("all","graze"):
                    page.evaluate("kind=>fixture.reset(kind)", species)
                    movie(page, ["unicorn-graze"+suffix], "[fixture.graze(frame)]", 180)
                if species == "unicorn" and opts.mode in ("all","neck"):
                    for i, label in enumerate(["neutral","half","full"]):
                        data = page.evaluate("level=>fixture.neck(level)", i)
                        (OUT / f"unicorn-neck-{label}-{opts.revision}.png").write_bytes(base64.b64decode(data))
                print(species, opts.revision, "complete", flush=True)
            chrome.close()
        server.shutdown()


if __name__ == "__main__":
    main()
