"""Bake deterministic A8 colour and relief into shared RGBA atlases.

Hem, shaft and barb fields follow the existing owl UVs. The wing colours use
the A7 photographic guide as a pigment input. Alpha stores linear height.
"""
from pathlib import Path
import base64
import re
import subprocess
import zlib

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASE = '2e36fdf'
RNG = np.random.default_rng(720931)
TAU = 2 * np.pi


def ramp(x, a, b):
    u = np.clip((x - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


def mix(a, b, weight):
    return np.asarray(a) * (1 - weight[..., None]) + np.asarray(b) * weight[..., None]


def grid(w, h):
    return np.meshgrid((np.arange(w) + .5) / w, (np.arange(h) + .5) / h)


def guide(which, w, h):
    path = f'creature-lab/species/owl-{which}-albedo.js'
    source = subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT, text=True)
    value = re.search(r"='([^']+)'", source).group(1)
    data = zlib.decompress(base64.b64decode(value))
    return np.frombuffer(data, np.uint8).reshape(h, w, 3).astype(float)


def pack(rgb, height):
    rgba = np.dstack((np.clip(rgb, 0, 255), 255 * np.clip(height, 0, 1))).round().astype(np.uint8)
    return base64.b64encode(zlib.compress(rgba.tobytes(), 9)).decode()


def head():
    w, h = 1024, 512
    u, v = grid(w, h)
    phi, theta = (u - .5) * TAU, (1 - v) * np.pi
    x = .0595 * np.sin(theta) * np.sin(phi)
    y = .057 * np.cos(theta)
    z = np.sin(theta) * np.cos(phi)
    dx = np.abs(x) - .0235
    dy = y - .0025
    a = np.arctan2(dy * .84, dx)
    r = np.hypot(dx, dy * .84)
    asym = np.where(x < 0, .84, -.77)
    sweep = a + .043*np.sin(7*a + 192*r + asym) + .025*np.sin(19*a - 84*r + 2*asym)
    sectors = (47*sweep / TAU + 18*r) % 1
    tine = (1 - np.abs(2*sectors-1)) ** 5
    filament = (.55*np.sin(137*sweep + 181*r) + .45*np.sin(211*sweep + 260*r + asym))
    velvet = np.sin(309*sweep + 730*r + 2.2*np.sin(37*sweep + asym))
    fine = .45*filament + .24*velvet + .14*np.sin(1930*r + 82*sweep)
    throat = ramp(-y, .016, .053)
    notch = .009*np.exp(-(x/.013)**2) * ramp(y, .005, .034)
    edge = np.hypot(x/(.049+.008*np.clip(y/.048,-1,1)), (y+notch)/.049)
    edge += .018*np.sin(54*sweep + 121*r + asym) + .012*np.sin(129*sweep - 221*r)
    disc = (1-ramp(edge, .88, 1.09))*ramp(z, .10, .59)
    # Keep the cinnamon at sporadic feather tips and let the cheek fade into the throat.
    ruff = np.exp(-((edge-.986)/.065)**2)*ramp(z,.26,.78)*(1-.79*throat)
    ruff *= .56+.33*np.sin(41*sweep+210*r+asym)**2+.12*velvet
    low = .65*np.sin(9*a+110*r+asym)+.35*np.sin(21*a-120*r)
    filaments = 11*fine + 4.8*tine + 2.4*np.sin(72*sweep+193*r+asym)*np.sin(89*r+1.4*a)
    filaments += ramp(r, .006, .019)*(9*filament + 12*(tine-.16))
    face = np.array([231.,220.,201.]) + (4.4*low+filaments)[...,None]
    socket = np.exp(-(r/.010)**2) * (1 + .40*np.sin(a+.55*asym))
    face -= socket[...,None]*[24,24,22]
    collar = np.exp(-((r-.0096)/.0039)**2)*ramp(-np.sin(a+.12*asym),.18,.85)
    face = mix(face,[189,158,124],collar*(.27+.11*filament))
    beak_fringe = np.exp(-(x/(.004+.046*abs(y)))**2)*np.exp(-((y+.016)/.019)**2)
    face = mix(face,[190,166,140],beak_fringe*(.24+.11*filament))
    face = mix(face, [163,129,105], .74*ruff)
    crown = guide('head', w, h)
    nape_ridge = np.sin(61*phi+10*np.sin(8*theta)) * np.sin(45*theta+3*np.sin(7*phi+5*theta))
    med = .60*np.sin(11*phi+7*theta) + .28*np.sin(29*phi-19*theta)
    crown_pattern = np.array([163,140,124]) + (10.2*med+4.8*nape_ridge)[...,None]
    crown = mix(crown, crown_pattern, .40+.13*np.sin(13*phi+7*theta)**2)
    crown = mix(crown, [220,206,185], .71*throat*ramp(z,-.48,.88))
    color = mix(crown, face, disc)
    color += (RNG.normal(0,.95,(h,w))+.55*velvet)[...,None]
    nape = .19*np.sin(129*phi+31*np.sin(theta*5))+ .14*np.sin(151*theta-43*np.cos(phi))
    height = .48+disc*(.18*fine+.13*tine+.045*low)+(1-disc)*nape
    return pack(color, height)


def body():
    w, h = 512, 384
    color = np.full((h,w,3), [228.,218.,200.])
    height = np.full((h,w), .5)
    for row in range(-2,25):
        # Interrupted stagger and changing feather counts avoid meridional bands.
        count = int(23 + 23*np.sin(np.pi*np.clip(row/23,0,1)))
        for i in range(count):
            cx = (i + .32*(row % 3) + RNG.uniform(-.31,.31))*w/count
            cy = (row + RNG.uniform(-.43,.43))*h/23 + 5*np.sin(cx*TAU/w*3+row*.64)
            az = cx*TAU/w
            dorsal = np.clip((.27 - np.sin(az))/.92,0,1)
            length = RNG.uniform(24,42)*(1+.33*dorsal)
            width = w/count*RNG.uniform(.77,1.19)
            x = np.arange(int(cx-width*2.2),int(cx+width*2.2)+1)
            y = np.arange(max(0,int(cy-length-3)),min(h,int(cy+3)))
            if not len(y):
                continue
            X,Y = np.meshgrid(x,y)
            u = (cy-Y)/length
            phase = RNG.uniform(0,TAU)
            axis = cx + width*(.4*np.cos(az)+.24*np.sin(phase))*u*u
            blade = (X-axis)/width
            edge = np.maximum(0,np.sin(np.pi*np.clip(u,0,1)))**.50*(1-.14*u)
            fil = np.sin(4.9*(X-axis)+u*16+phase)
            margin = (edge-np.abs(blade))*width + .43*fil
            a = ramp(margin,-1.15,1.85)*ramp(u,-.05,.19)*(1-ramp(u,.88,1.05))
            shaft = np.exp(-(blade/(.045+.055*(1-np.clip(u,0,1))))**2)
            barb = np.sin(56*u+22*np.abs(blade)+.82*np.sin(5*blade+phase))
            vane = .16*barb+.10*fil+.14*shaft+.15*(1-blade**2)*np.sin(np.pi*np.clip(u,0,1))
            down = np.array([242,234,218])+RNG.normal(0,2.3)
            back = np.array([186,147,107])+RNG.normal(0,13)
            mottling = np.exp(-((blade-.15*np.sin(u*4+phase))/.39)**2)*ramp(u,.19,.72)
            dorsum = back + mottling[...,None]*[-36,-21,-5]
            pigment = down*(1-dorsal)+dorsal*dorsum + (2.3*barb+1.25*fil+4.5*shaft)[...,None]
            if RNG.random() < .15+.66*dorsal:
                spot = np.exp(-((blade-RNG.uniform(-.16,.16))/RNG.uniform(.08,.18))**2-((u-RNG.uniform(.55,.87))/.052)**2)
                pigment -= spot[...,None]*RNG.uniform(18,60)
            sel = np.ix_(y,x%w)
            crease = np.exp(-((margin+.45)/1.46)**2)*ramp(u,.26,.73)
            color[sel] = mix(color[sel]-4.3*crease[...,None],pigment,a)
            height[sel] = height[sel]*(1-a)+(.48+vane)*a
    u,v=grid(w,h)
    color += (2.0*np.sin(u*TAU*3+v*6)+1.5*np.sin(v*TAU*7-u*TAU*5))[...,None]
    return pack(color,height)


def wing():
    size=128
    u,v=grid(size,size)
    k=2*u-1
    colors=guide('wing',512,512)
    relief=np.empty((512,512))
    for row in range(4):
        for col in range(4):
            phase=RNG.uniform(0,TAU)
            shaft=k-.055*np.sin(np.pi*v+phase)
            width=.023+.036*(1-v)
            rachis=np.exp(-(shaft/width)**2)*ramp(v,.04,.19)*(1-ramp(v,.84,.99))
            side=np.abs(shaft)
            barb=np.sin(TAU*(36*v+8.3*side+1.8*side**2)+phase+.4*np.sin(23*v+7*k))
            tips=ramp(v,.77,1)*(.5+.5*np.sin(k*36+v*27+phase))
            patch=(slice(row*size,(row+1)*size),slice(col*size,(col+1)*size))
            rgb=colors[patch]
            if row==0:
                # Muted storm-grey bands, uneven along each individual web.
                broad=.85*np.sin(TAU*(2.8*v+.21*side)+phase)+.34*np.sin(44*v-12*k)
                rgb[:]=mix(rgb,[151,130,111],.27+ramp(broad,.07,.67)*.18)
            elif row<3:
                grey=ramp(v+.11*np.sin(8*k+phase),.36,.83)
                rgb[:]=mix(rgb,[128,124,124],grey*(.19+.09*np.sin(5*v+phase)))
            rgb += (4*rachis+2.9*barb+4.4*tips+2*np.sin(9*v+12*k+phase))[...,None]
            relief[patch]=.45+.22*rachis+.13*barb+.055*tips+.07*(1-side**2)
    return pack(colors,relief)


def small_surfaces():
    # Leg down, scutes, claw horn and beak keratin. Grey RGB is modulation;
    # the skinned mesh supplies each surface's base pigment.
    u,v=grid(128,128)
    fibers=.5*np.sin(299*u+12*np.sin(TAU*v)+13*v)+.3*np.sin(481*u+41*v)
    plume=np.exp(-((u-.5-.07*np.sin(7*v))/.05)**2)
    barb=np.sin(TAU*(24*v+6*np.abs(u-.5))+.35*np.sin(u*28))
    leg=.50+.24*fibers+.13*plume+.065*barb
    scute_rows=v*6+.12*np.sin(TAU*u*3)
    groove=np.exp(-(np.sin(np.pi*scute_rows)/.31)**2)
    pores=np.sin(TAU*(23*u+2.5*v))*np.sin(TAU*(19*v-.35*u))
    toe=.63-.28*groove+.07*pores
    grain=.15*np.sin(TAU*18*u+.65*np.sin(12*v))+.08*np.sin(TAU*31*u+3*v)
    horn=.50+grain-.18*ramp(v,.6,.97)
    bill=.54+.09*np.sin(57*u+12*v)+.055*np.sin(133*u+4*v)-.11*ramp(v,.56,.98)
    height=np.block([[leg,toe],[horn,bill]])
    tone=np.block([[226.+15*fibers+10*plume,230.-24*groove+7*pores],
        [223.+47*grain-38*ramp(v,.53,.99),228.+14*np.sin(26*u+10*v)-31*ramp(v,.44,1)]])
    return pack(np.repeat(tone[...,None],3,axis=2),height)


if __name__=='__main__':
    result = {'headFinish':head(), 'bodyFinish':body(), 'wingFinish':wing(), 'detailFinish':small_surfaces()}
    header = ('// Deterministic colour and linear feather height, baked by tools/bake-owl-finish.py.\n'
              '// The A7 wing guide incorporates Steven Ward’s Barn Owl, Lancashire (CC BY 2.0).\n'
              '// https://commons.wikimedia.org/wiki/File:Barn_Owl,_Lancashire.jpg\n')
    (ROOT/'creature-lab/species/owl-finish-atlas.js').write_text(header + ''.join(
        f"export const {name}='{data}';\n" for name,data in result.items()))
