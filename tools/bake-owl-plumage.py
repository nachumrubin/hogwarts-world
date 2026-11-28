"""Bake tract-aligned contour plumage and individual wing vane UV tiles."""
from pathlib import Path
import base64
import zlib
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / 'creature-lab'
PHOTO = Image.open(ROOT/'review/owl-a2/reference.jpg').convert('RGB')
rng = np.random.default_rng(2303)

def export(name, symbol, pixels):
    rgb = np.ascontiguousarray(np.clip(pixels, 0, 255).astype('uint8'))
    encoded = base64.b64encode(zlib.compress(rgb.tobytes(), 9)).decode()
    (ROOT/f'species/owl-{name}-albedo.js').write_text(
        '// Baked by tools/bake-owl-plumage.py using Steven Ward’s Barn Owl, Lancashire (CC BY 2.0).\n'
        '// https://commons.wikimedia.org/wiki/File:Barn_Owl,_Lancashire.jpg\n'
        f"export const {symbol}='{encoded}';\n")

def contour_field():
    # Paint distal rows first. Shafts, spots, tip highlights and their
    # contact shadows share the local coordinates of each individual vane.
    w,h=512,384
    field=np.full((h,w,3),[222.,212.,192.])

    for row in range(-2,24):
        v=row/21
        count=int(17+24*np.sin(np.pi*np.clip(v,.03,.97)))
        for i in range(count):
            cx=(i+.45*(row%2)+rng.uniform(-.19,.19))*w/count
            cy=(row+rng.uniform(-.19,.19))*h/21
            azimuth=2*np.pi*cx/w
            dorsal=np.clip((.38-np.sin(azimuth))/.9,0,1)
            length=rng.uniform(32,48)*(1+.28*dorsal)
            width=w/count*rng.uniform(.78,1.09)
            sweep=width*(.58*np.cos(azimuth)+rng.uniform(-.24,.24))
            x=np.arange(int(cx-2.5*width),int(cx+2.5*width)+1)
            y=np.arange(max(0,int(cy-length-3)),min(h,int(cy+3)))
            if not len(y):continue
            X,Y=np.meshgrid(x,y)
            u=(cy-Y)/length
            phi=rng.uniform(0,6.28)
            axis=cx+sweep*u*u+.07*width*np.sin(3*u+phi)
            blade=(X-axis)/width
            edge=np.maximum(0,np.sin(np.pi*np.clip(u,0,1)))**.48*(1-.1*u)
            fibers=np.sin(4.1*(X-axis)+u*12+phi)
            dist=(edge-np.abs(blade))*width+.48*fibers
            alpha=np.clip(.35+dist/2.1,0,1)*np.clip(u*7,0,1)*np.clip((1.04-u)*14,0,1)
            belly=np.array([242,232,213])+rng.normal(0,3)
            back=np.array([193,152,107])+rng.uniform(-16,16)
            grey=np.exp(-((blade-.16*np.sin(4*u+phi))/.45)**2)
            dorsal_color=back+grey[:,:,None]*np.array([-29,0,32])
            barb=3*np.sin(47*u+13*np.abs(blade)+phi)+2.5*fibers
            camber=4*(1-blade**2)-5*blade-8*u**3
            tip=np.exp(-((dist-1.1)/1.6)**2)*np.clip(u,0,1)
            shade=barb+camber+4*tip
            color=belly*(1-dorsal)+dorsal*dorsal_color+shade[:,:,None]
            if rng.random()<.15+.74*dorsal:
                dot=np.exp(-((blade-rng.uniform(-.12,.12))/.13)**2-((u-rng.uniform(.60,.83))/.045)**2)
                color-=dot[:,:,None]*rng.uniform(48,100)
            sel=np.ix_(y,x%w)
            shadow=np.exp(-((dist+1.0)/1.8)**2)*np.clip(2*u-.25,0,1)
            field[sel]=(field[sel]-shadow[:,:,None]*9)*(1-alpha[:,:,None])+color*alpha[:,:,None]
    export('body','bodyRGB',field)

def wing_atlas():
    # Four pigmented variants per tract. Sample the reference's dorsal
    # mottling softly, leaving the shaft, bars and pale tips aligned to UV.
    tile=128
    atlas=np.empty((4*tile,4*tile,3))
    y,x=np.mgrid[:tile,:tile]
    u=(y+.5)/tile
    k=2*(x+.5)/tile-1
    for row in range(4):
        for col in range(4):
            phase=rng.uniform(0,6.28)
            shaft=k-.055*np.sin(np.pi*u+phase)
            flank=np.abs(shaft)
            if row==0:
                base=np.full((tile,tile,3),[207.,178.,135.])
                bars=(u+col*.041)*3.75+.11*flank+.035*np.sin(k*7+phase)
                band=np.exp(-(np.sin(np.pi*bars)/.38)**2)
                base-=band[:,:,None]*[65,53,37]
                base+=u[:,:,None]*[14,16,20]
            elif row==3:
                base=np.full((tile,tile,3),[246.,240.,225.])
                # Broken subterminal bars and a short shaft streak on ivory webs.
                wave=(u*3.3+.18*flank+.07*col+.025*np.sin(8*k+phase))
                bars=np.exp(-(np.sin(np.pi*wave)/.38)**2)*np.clip(1.3-flank,0,1)
                streak=np.exp(-((k-.10)/.19)**2-((u-.65-.04*col)/.12)**2)
                base-=(bars*(.36+.55*u)+streak*.75)[:,:,None]*[71,74,73]
            else:
                patch=np.asarray(PHOTO.crop((447+col*19,181+row*12,536+col*19,234+row*12)).resize((tile,tile)),float)
                base=.45*patch+.55*np.array([219,168,98])
                tip=np.clip((u-.27-.13*np.cos(3*k+phase))/.52,0,1)
                grey=np.clip((.13+.79*tip-.30*flank+.13*np.sin(7*u+phase))*(1.16 if row==2 else 1),0,1)
                base=base*(1-grey[:,:,None])+grey[:,:,None]*(.34*patch+.66*np.array([133,130,137]))
                for _ in range(26):
                    dx=rng.uniform(-.72,.72);dy=rng.uniform(.35,.94)
                    spot=np.exp(-((k-dx)/.043)**2-((u-dy)/.018)**2)
                    light=np.exp(-((k-dx)/.038)**2-((u-dy-.014)/.012)**2)
                    base+=(-82*spot+70*light)[:,:,None]
            groove=np.sin(2*np.pi*(40*u+7.2*flank+1.7*flank**2)+phase)
            barb=groove*(3.6+flank*2)+2*np.sin(512*u+flank*71)
            rachis=np.exp(-(shaft/(.016+.021*(1-u)))**2)
            shade=barb+rachis*20-4*flank+np.clip(u-.80,0,1)*34
            atlas[row*tile:(row+1)*tile,col*tile:(col+1)*tile]=base+shade[:,:,None]
    export('wing','wingRGB',atlas)

if __name__=='__main__':
    contour_field()
    wing_atlas()
