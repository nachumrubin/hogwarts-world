"""Label the frames of tools/evidence/video.js (camera move, time, trees per LOD, cross-fade) and encode an MP4.
  python3 dev/tree-lab/tools/lod_video.py <frames dir> <out.mp4>"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
meta = json.load(open(os.path.join(d, 'frames.json')))
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 14)
except Exception: F = ImageFont.load_default()
tmp = tempfile.mkdtemp()
for f in meta['frames']:
    im = Image.open(os.path.join(d, f"f{f['k']:04d}.jpg")).convert('RGB'); dr = ImageDraw.Draw(im)
    l = f['lod']
    txt = f"{f['label']}   t {f['t']:5.2f} s   trees LOD0/1/2/impostor {l[0]}/{l[1]}/{l[2]}/{l[3]}" + ("   cross-fading" if f['fading'] else '')
    w = dr.textlength(txt, font=F); dr.rectangle([0, im.height - 24, w + 16, im.height], fill=(15, 16, 18)); dr.text((8, im.height - 20), txt, fill=(235, 235, 235), font=F)
    im.save(os.path.join(tmp, f"f{f['k']:04d}.png"))
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(meta['fps']), '-i', os.path.join(tmp, 'f%04d.png'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], check=True)
print(out, len(meta['frames']), 'frames')
