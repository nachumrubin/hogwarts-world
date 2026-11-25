import math,random
from pathlib import Path
from PIL import Image,ImageDraw,ImageFilter,ImageOps
import numpy as np
import argparse
parser=argparse.ArgumentParser(description='Bake the four hippogriff surface studies')
parser.add_argument('mare',type=Path,help='Original 4000 by 2900 Jument boulonnaise.jpg; see SOURCES.md')
args=parser.parse_args()
D=Path(__file__).parent/'assets'
rng=random.Random(7041)
for kind in ('face','chest','tail'):
 atlas=Image.new('RGBA',(1024,1024))
 for cell in range(8):
  w,h=256,512
  im=Image.new('RGBA',(w,h));draw=ImageDraw.Draw(im)
  def pen(points,shade,width=1):
   shade=int(max(0,min(250,shade)))
   draw.line(points,fill=(shade,shade,min(255,shade+3),255),width=width)
  if kind=='tail':
   for strand in range(255):
    x=rng.gauss(128,35);s=rng.uniform(-1,1);end=rng.uniform(.56,.995)**.48
    phase=rng.random()*6;shade=rng.gauss(160,21)
    pts=[]
    for j in range(72):
     t=end*j/71;xx=128+(x-128)*(.48+.68*math.sin(t*2))+25*t*math.sin(4*t+phase)+s*24*t*t
     pts.append((xx,4+t*502))
    pen(pts,shade,rng.choice([1,1,2,2,3]));pen(pts[-18:],shade+8,1)
  else:
   def mid(t): return 127+10*math.sin(3*t+cell)*t
   for side in [-1,1]:
    gap=0
    for j in range(890):
     t=j/889
     if rng.random()<.010:gap=rng.uniform(.07,.22)
     gap*=.77
     env=(math.sin(math.pi*t**.83)**(.48 if kind=='chest' else .68))
     width=(94+side*(cell%3)*4)*env*(1-gap)*rng.uniform(.965,1.035)
     start=.025+.94*t
     outer=start+.195*math.sin(math.pi*t)**.85
     pts=[]
     for k in range(21):
      u=k/20;y=start+(outer-start)*u**.81
      pts.append((mid(y)+side*width*u,8+492*y+4*math.sin(u*5+cell)*u))
     tone=(178 if kind=='chest' else 198)+9*math.sin(t*8+cell)+rng.gauss(0,10)-15*(1-t)
     pen(pts,tone,2 if j%5 else 3)
   for j in range(155):
    t=rng.random()*.32;side=rng.choice([-1,1]);yy=10+490*t;x=mid(t)
    pen([(x,yy),(x+side*22,yy+14),(x+side*rng.uniform(38,94),yy+rng.uniform(30,83))],rng.gauss(180,15),1)
   for j in range(120):
    t=j/120;pen([(mid(t),8+485*t),(mid(t+.01),8+485*(t+.01))],211-18*t,max(1,int(4*(1-t))))
  atlas.paste(im,(cell%4*w,cell//4*h))
 atlas.save(D/(kind+'.png'))
# Remove lighting of the source flank with a broad low-pass. A mirrored tile
# gives continuous values at repeat boundaries without duplicating its dapples.
im=Image.open(args.mare).convert('L').crop((2080,1088,2592,1600))
a=np.array(im,float); low=np.array(im.filter(ImageFilter.GaussianBlur(18)),float)
high=np.clip(128+4.5*(a-low),0,255)
rough=np.clip(171+np.abs(a-low)*3,0,255)
direction=np.clip(128+5*(np.roll(a,1,axis=0)-np.roll(a,-1,axis=0)),0,255)
rgb=Image.fromarray(np.stack([high,rough,direction],2).astype('uint8')).resize((256,256),Image.Resampling.LANCZOS)
tile=Image.new('RGB',(512,512));tile.paste(rgb);tile.paste(ImageOps.mirror(rgb),(256,0));tile.paste(ImageOps.flip(tile.crop((0,0,512,256))),(0,256));tile.save(D/'coat.png')
# Pigment laid radially, sampled through the corneal surface.
n=512;y,x=np.mgrid[-1:1:complex(n),-1:1:complex(n)];r=np.hypot(x,y);ang=np.arctan2(y,x);layer=np.zeros_like(x)
for _ in range(26):
 k=rng.randint(18,230);layer+=np.cos(k*ang+r*rng.uniform(-13,13)+rng.random()*6+np.sin(ang*9+r*5))*rng.random()/8
collar=np.exp(-((r-.55-.032*np.sin(ang*13))/.073)**2)
v=(.68+.14*layer+.16*collar)*(1-.65*np.clip((r-.79)/.20,0,1))
iris=np.array([226*v,146*v+8*layer,53*v]).transpose(1,2,0);iris[r<.425]=[8,7,7]
Image.fromarray(np.clip(iris,0,255).astype('uint8')).save(D/'iris.png')
