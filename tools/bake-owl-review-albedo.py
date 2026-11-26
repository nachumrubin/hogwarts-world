# Derive a small, lighting-normalised colour guide from the licensed reference.
import numpy as np, zlib,base64
from PIL import Image,ImageFilter
from pathlib import Path
d=Path(__file__).resolve().parents[1]/'creature-lab'
img=np.asarray(Image.open(d/'review/owl-a1/reference.jpg').convert('RGB'),float)
h,w=256,512
u,v=np.meshgrid((np.arange(w)+.5)/w,(np.arange(h)+.5)/h)
p=(u-.5)*np.pi*2;t=(1-v)*np.pi
X=.0595*np.sin(t)*np.sin(p);Y=.057*np.cos(t);Z=np.cos(p)*np.sin(t)
px=299-np.abs(X)*1910;py=164-Y*1880
def sample(x,y):return img[np.clip(y.astype(int),0,639),np.clip(x.astype(int),0,959)]
def mix(a,b,k):return a*(1-k[:,:,None])+b*k[:,:,None]
c=sample(px,py)
# Replace photographed eye and exposed bill with adjacent periocular plumage.
for cx,cy,rx,ry,dx,dy in [(254,160,18,17,-12,-22),(299,223,7,18,-10,0)]:
 r=np.hypot((px-cx)/rx,(py-cy)/ry)
 c=mix(c,sample(px+dx,py+dy),np.clip((1.18-r)*5,0,1))
rng=np.random.default_rng(408)
noise=rng.normal(0,5,(h,w))
cloud=(np.sin(p*15+np.cos(t*11))+np.sin(t*29+np.sin(p*11)))*.5
crown=np.stack([180+cloud*20+noise,151+cloud*10+noise,123-cloud*9+noise],2)
speck=rng.uniform(size=(h,w))>.966;crown[speck]-=42
border=np.interp(py,[44,58,78,95,123,152,180,205,230,247,261,272],[259,244,224,212,202,197,200,209,226,242,265,283])
keep=np.clip((px-border)/5+.12,0,1)*np.clip((Z-.22)*5,0,1)*np.clip((268-py)/8,0,1)
c=mix(crown,c*.84+np.array([27,27,28]),keep)
raw=zlib.compress(np.uint8(np.clip(c,0,255)).tobytes(),9)
(d/'species/owl-head-albedo.js').write_text("// Feather colour guide adapted from Steven Ward, Barn Owl, Lancashire (CC BY 2.0).\n// Cropped, mirrored and remapped; photographic eyes and bill removed.\n// https://commons.wikimedia.org/wiki/File:Barn_Owl,_Lancashire.jpg\nexport const headRGB='"+base64.b64encode(raw).decode()+"';\n")

photo=Image.open(d/'review/owl-a1/reference.jpg')
w=h=256
v,u=np.mgrid[0:h,0:w]/256
rng=np.random.default_rng(432)
atlas=np.zeros((h,w,3))
for j,(x0,y0,x1,y1) in enumerate([(583,294,780,371),(421,167,624,244),(490,150,625,199)]):
 ys=slice(64*j,64*(j+1))
 a=np.asarray(photo.crop((x0,y0,x1,y1)).resize((256,64)),float)
 atlas[ys]=a*.72+np.asarray([60,57,54])
atlas[192:]=np.array([236,231,219])+rng.normal(0,2,(64,256,1))
z=zlib.compress(np.clip(atlas,0,255).astype('uint8').tobytes(),9)
(d/'species/owl-wing-albedo.js').write_text("// Diffuse plumage swatches adapted from Steven Ward, Barn Owl, Lancashire, CC BY 2.0.\n// https://commons.wikimedia.org/wiki/File:Barn_Owl,_Lancashire.jpg\nexport const wingRGB='"+base64.b64encode(z).decode()+"';\n")
