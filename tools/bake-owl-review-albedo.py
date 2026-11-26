# Derive a small, lighting-normalised colour guide from the licensed reference.
import numpy as np, zlib,base64
from PIL import Image
from pathlib import Path
d=Path(__file__).resolve().parents[1]/'creature-lab'
img=np.asarray(Image.open(d/'review/owl-a1/reference.jpg').convert('RGB'),float)
h,w=512,1024
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
# Use locally sampled nape feather colour, wrapped around the crown.
def mirrored(a):
 return 1-np.abs(2*(a%1)-1)
# Sample the small crown tract with affine, mirrored repeats. A smooth
# low-frequency envelope carries the buff at the nape into the grey crown.
cx=273+73*mirrored(3*u+.10*v)
cy=52+27*mirrored(2.2*v-.13*u)
crown=.48*crown+.52*sample(cx,cy)
tract=165*p+4*np.sin(2*t+3*p)
crown+=(1.6*np.sin(tract)+1.2*np.sin(tract*.55+36*t))[:,:,None]
border=np.interp(py,[44,58,78,95,123,152,180,205,230,247,261,272],[259,244,224,212,202,197,200,209,226,242,265,283])
# Each disc lobe grows outward from its orbit. Break the colour boundary
# at individual feather ends while retaining the orbital aperture.
dx=np.abs(X)-.0235
dy=Y-.002
angle=np.arctan2(dy,dx)
radius=np.hypot(dx,dy)
fiber=np.sin(166*angle+8*np.sin(11*angle)+105*radius)
bundle=166*angle+8*np.sin(11*angle)+105*radius
streak=6.8*fiber+3.8*np.sin(347*angle+220*radius+4*np.sin(17*angle))
streak+=2.2*np.sin(523*angle+radius*560+5*np.sin(23*angle))
streak+=3.2*np.sin(2.4*bundle+1260*radius)
disc=np.hypot(X/(.052+.004*np.clip(Y/.044,-1,1)),(Y+.005*np.exp(-(X/.013)**2))/.046)
# Soft warm ends in the outermost row of the ruff.
streak-=3*np.exp(-((disc-.98-.012*fiber)/.058)**2)
keep=np.clip((px-border+2.5*fiber)/10+.36,0,1)*np.clip((Z-.20)*4.5,0,1)*np.clip((269-py)/10,0,1)
# Lift the photographed shadow on the lower ruff. The runtime lights
# supply the mandibular shadow as the head turns.
lower=np.clip((-Y+.008)/.050,0,1)
fringe=np.clip((disc-.63)/.39,0,1)
lift=np.clip((1-Z)*.60+.70*lower,0,.85)*fringe
ivory=np.array([231,218,196])+streak[:,:,None]*.62
face=mix(c*.81+np.array([33,32,32])+streak[:,:,None],ivory,lift)
ruffBlend=np.clip((Z+.15)*1.5,0,1)*lower*fringe*.65
throat=np.clip((-Y+.010)/.047,0,1)*np.clip((Z+.57)*1.7,0,1)
nape=mix(crown,np.array([208,192,167])+noise[:,:,None],.74*throat)
c=mix(mix(nape,ivory,ruffBlend),face,keep)
raw=zlib.compress(np.uint8(np.clip(c,0,255)).tobytes(),9)
(d/'species/owl-head-albedo.js').write_text("// Feather colour guide adapted from Steven Ward, Barn Owl, Lancashire (CC BY 2.0).\n// Cropped, mirrored and remapped; photographic eyes and bill removed.\n// https://commons.wikimedia.org/wiki/File:Barn_Owl,_Lancashire.jpg\nexport const headRGB='"+base64.b64encode(raw).decode()+"';\n")
