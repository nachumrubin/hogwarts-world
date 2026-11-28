"""Compare two creature-lab directories using local Chromium and Python Playwright.

Example: python tools/bench-creature-revisions.py ../baseline/creature-lab creature-lab output.json
Both arguments must be the directories containing the respective inspection.js files.
"""
import argparse
import contextlib
import functools
import hashlib
import json
import pathlib
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


@contextlib.contextmanager
def serve(path):
    handler = functools.partial(Handler, directory=path)
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()


BENCH = """async ({species}) => {
  const T = await import('/vendor/three.module.js');
  const {studioLights, background} = await import('/inspection.js');
  const {catalog} = await import('/species/catalog.js');
  const specimen = new catalog[species].model();
  const renderer = new T.WebGLRenderer({antialias:true, alpha:true,
    preserveDrawingBuffer:true, powerPreference:'high-performance'});
  const scene = new T.Scene();
  scene.background = background;
  scene.add(studioLights(), specimen.root);
  renderer.setPixelRatio(1);
  renderer.setSize(640, 480, false);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  const half = species === 'hippogriff' ? 2.1 : 1.92;
  const camera = new T.OrthographicCamera(-half*4/3, half*4/3, half, -half, .01, 160);
  const focus = new T.Vector3();
  const offset = new T.Vector3(5,1.6,4);
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const driver = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const rows = [];
  const pixel = new Uint8Array(4);
  let t = 0;
  try {
    for(let lod = 0; lod < 3; lod++) {
      specimen.setLOD(lod);
      const samples = [];
      for(let i = 0; i < 40; i++) {
        const start = performance.now();
        specimen.update(1/60, t += 1/60, 'Walk');
        focus.copy(specimen.root.position);
        focus.y += 1.42;
        camera.position.copy(focus).add(offset);
        camera.lookAt(focus);
        renderer.render(scene, camera);
        gl.readPixels(320, 240, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const elapsed = performance.now() - start;
        if(i >= 10) samples.push(+elapsed.toFixed(3));
      }
      const sorted = [...samples].sort((a,b)=>a-b);
      rows.push({lod, draws:renderer.info.render.calls, triangles:renderer.info.render.triangles,
        medianMs:+((sorted[14]+sorted[15])/2).toFixed(3), p95Ms:sorted[28], samplesMs:samples});
    }
    if(gl.isContextLost() || gl.getError() !== gl.NO_ERROR) throw Error('WebGL measurement failed');
  } finally {
    specimen.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return {rows,driver};
}"""


def source_fingerprint(lab):
    digest = hashlib.sha256()
    for path in sorted((lab / "species").glob("*.js")):
        digest.update(path.name.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("before", "after", "output"):
        parser.add_argument(name, type=pathlib.Path)
    parser.add_argument("--chromium", default=shutil.which("chromium") or shutil.which("google-chrome"))
    args = parser.parse_args()
    protocol = {
        "framebuffer": [640, 480], "devicePixelRatio": 1,
        "scope": "One visible specimen with native materials, studio lights, no habitat",
        "action": "Walk with fixed 1/60 s steps. Continuous simulation across LODs 0, 1, 2.",
        "samples": "10 warm-up frames then 30 measured per LOD, one run per species and revision",
        "timer": "performance.now, update + tracking orthographic camera + draw + synchronous 1-pixel readPixels",
        "statistics": "Median is the mean of the two middle samples; p95 uses nearest rank.",
        "order": "Before then after for each species; each trial in a fresh page in one Chromium process.",
        "camera": "Aim 1.42 m above root, offset (5,1.6,4), half-height 1.92 m (hippogriff 2.1 m).",
        "rendererSettings": "WebGL2, antialias, ACES Filmic, exposure 1.06. Software renderer.",
    }
    report = {"protocol": protocol, "speciesSourceSha256": {}, "species": {}}
    with contextlib.ExitStack() as stack:
        origins = {}
        for name in ("before", "after"):
            lab = getattr(args, name).resolve(strict=True)
            if not (lab / "species/catalog.js").is_file():
                parser.error(f"Missing creature source at {lab}")
            origins[name] = stack.enter_context(serve(lab))
            report["speciesSourceSha256"][name] = source_fingerprint(lab)
        pw = stack.enter_context(sync_playwright())
        browser = pw.chromium.launch(executable_path=args.chromium, args=[
            "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox",
        ])
        stack.callback(browser.close)
        report["browser"] = browser.version
        for species in ("centaur", "unicorn", "hippogriff"):
            report["species"][species] = {}
            for revision, origin in origins.items():
                page = browser.new_page(viewport={"width": 640, "height": 480}, device_scale_factor=1)
                # The listing is a same-origin blank entry point without a running lab.
                page.goto(origin + "/species/")
                result = page.evaluate(BENCH, {"species": species})
                page.close()
                if "SwiftShader" not in result["driver"]:
                    raise RuntimeError(f"Unexpected renderer: {result['driver']}")
                report["renderer"] = result["driver"]
                report["species"][species][revision] = result["rows"]
                print(species, revision, [r["medianMs"] for r in result["rows"]], flush=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
