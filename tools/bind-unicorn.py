"""Bake the Meshy scan onto the original unicorn bind landmarks (NumPy/SciPy)."""
import base64
import json
from pathlib import Path
import struct
import subprocess
import zlib

import numpy as np
from scipy import sparse
from scipy.sparse.csgraph import connected_components
from scipy.sparse.linalg import factorized

root = Path(__file__).resolve().parents[1]
species = root / 'creature-lab/species'
b = (species/'static/white_unicorn_meshy_ai.glb').read_bytes()
length = struct.unpack_from('<I', b, 12)[0]
doc = json.loads(b[20:20+length])
rig = json.loads(subprocess.check_output(['node', 'tools/bind-unicorn.mjs'], cwd=root))

def accessor(index, dtype):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    offset = 28+length+v.get('byteOffset', 0)+a.get('byteOffset', 0)
    return np.frombuffer(b, dtype=dtype, count=a['count']*(3 if a['type']=='VEC3' else 1), offset=offset)

primitive = doc['meshes'][0]['primitives'][0]
raw = accessor(primitive['attributes']['POSITION'], '<f4').reshape(-1,3)
unique, lookup = np.unique(raw.round(5), axis=0, return_inverse=True)
tri = lookup[accessor(primitive['indices'], '<u2')].reshape(-1,3)
edges = np.unique(np.sort(np.c_[tri.ravel(), np.roll(tri,1,axis=1).ravel()],axis=1),axis=0)
edges = edges[edges[:,0]!=edges[:,1]]
a, c = edges.T
n = len(unique)
def graph(a,c,w):
    return sparse.coo_matrix((np.r_[w,w],(np.r_[a,c],np.r_[c,a])),shape=(n,n)).tocsr()

def rot(yaw):
    s,t=np.sin(yaw),np.cos(yaw)
    return np.array([[t,0,s],[0,1,0],[-s,0,t]])

# Coordinates in the animal's body frame. Use one uniform scale throughout.
p=(unique @ rot(1.67).T + [.24,.85617,0])*1.58
x,y,z=p.T
targets=p.copy()
stiff=np.full(n,.001)
head=((y>2.06)&(z>.53))|((x>.51)&(y>1.55)&(z>.65))
targets[head]=(p[head]-[.31,2.09,1.01])@rot(-1.50).T+rig['head']
stiff[head]=500

# Below the belly each hoof and the tail are distinct connected surfaces.
low=(unique[:,1]<-.32)
keep=low[a]&low[c]
_,labels=connected_components(graph(a[keep],c[keep],np.ones(keep.sum())),directed=False)
islands=[np.flatnonzero(labels==i) for i in np.flatnonzero(np.bincount(labels)>400)]
assert len(islands)==5
tail=min(islands,key=lambda ids:z[ids].mean())
legs=sorted((ids for ids in islands if ids is not tail),key=lambda ids:z[ids].mean())
legs=sorted(legs[:2],key=lambda ids:x[ids].mean())+sorted(legs[2:],key=lambda ids:x[ids].mean())
legs=[legs[0],legs[2],legs[1],legs[3]]
for ids,leg in zip(legs,rig['legs']):
    floor=y[ids].min()
    toe=p[ids[y[ids]<floor+.06]].mean(axis=0)
    toe[1]=floor
    delta=np.asarray(leg['sole'])-toe
    # A scan in a staggered stance must bring its entire limb back under
    # the hip. Do not translate the whole cannon and pin its top at a slice.
    height=np.clip((y[ids]-floor-.13)/1.45,0,1)
    targets[ids]+=(1-height[:,None])*delta
    stiff[ids]=np.where(height==0,12,.04)
stiff[tail]=1
torso=(abs(z)<.45)&(y>1.29)&(y<1.72)
stiff[torso]=1

# As-rigid-as-possible registration. Fixed skull vertices share one rigid
# transform; only the connecting neck and limb sockets have to change shape.
d=p[a]-p[c]
w=1/np.maximum(.012,np.linalg.norm(d,axis=1))
adj=graph(a,c,w)
degree=np.asarray(adj.sum(axis=1)).ravel()
lap=sparse.diags(degree)-adj
penalty=stiff*degree
solve=factorized((lap+sparse.diags(penalty)).tocsc())
q=p.copy()
for iteration in range(18):
    cov=np.zeros((n,3,3))
    outer=w[:,None,None]*(q[a]-q[c])[:,:,None]*d[:,None,:]
    np.add.at(cov,a,outer);np.add.at(cov,c,outer)
    u,_,vt=np.linalg.svd(cov)
    u[:,:,-1]*=np.linalg.det(u@vt)[:,None]
    rotation=u@vt
    gradient=w[:,None]*np.einsum('nij,nj->ni',(rotation[a]+rotation[c])*.5,d)
    rhs=penalty[:,None]*targets
    np.add.at(rhs,a,gradient);np.add.at(rhs,c,-gradient)
    q=solve(rhs)
q[head]=targets[head]

# Transport authored shading normals through the fitted surface. This keeps
# UV splits along fine strands from becoming hard edges when the mane bends.
def surface_rotation(before,after):
    cov=np.zeros((n,3,3))
    outer=w[:,None,None]*(after[a]-after[c])[:,:,None]*(before[a]-before[c])[:,None,:]
    np.add.at(cov,a,outer);np.add.at(cov,c,outer)
    u,_,vt=np.linalg.svd(cov)
    u[:,:,-1]*=np.linalg.det(u@vt)[:,None]
    return u@vt

src_normals=accessor(primitive['attributes']['NORMAL'],'<f4').reshape(-1,3)@rot(1.67).T
normal_frame=surface_rotation(p,q)
normal_frame[head]=rot(-1.50)
normals=np.einsum('nij,nj->ni',normal_frame[lookup],src_normals)

# Heat diffusion on the welded surface carries labels around the mane and
# leg seams without transferring a hoof influence through empty space.
neck=np.asarray(rig['neck'])
h=len(neck)
weights=np.zeros((n,h+22))
confidence=np.full(n,.002)
weights[:,0]=1
confidence[torso]=4
def chain(ids,points,offset):
    if not len(ids): return
    v=np.diff(points,axis=0)
    f=np.clip(np.einsum('nsi,si->ns',q[ids,None]-points[:-1],v)/(v*v).sum(1),0,1)
    err=q[ids,None]-points[:-1]-v*f[:,:,None]
    k=(err*err).sum(2).argmin(1)
    t=f[np.arange(len(ids)),k]
    weights[ids]=0
    weights[ids,offset+k]=1-t
    weights[ids,offset+k+1]=t
for i,(ids,leg) in enumerate(zip(legs,rig['legs'])):
    chain(ids,np.array(leg['bones']),h+1+5*i)
    confidence[ids]=4
    top=np.asarray(leg['bones'][0])
    socket=np.flatnonzero((abs(q[:,0]-top[0])<.17)&(abs(q[:,2]-top[2])<.22)&(q[:,1]>.84)&(q[:,1]<top[1]))
    chain(socket,np.array(leg['bones']),h+1+5*i)
    confidence[socket]=.5
neck_region=np.flatnonzero((q[:,1]>1.45)&(q[:,2]>.39))
chain(neck_region,neck[1:],1)
confidence[neck_region]=.4
weights[tail]=0;weights[tail,-1]=1;confidence[tail]=4
weights[head]=0;weights[head,h]=1;confidence[head]=500
influence=confidence*degree
weights=factorized((lap+sparse.diags(influence)).tocsc())(weights*influence[:,None])
weights[head]=0;weights[head,h]=1
ids=np.argsort(weights,axis=1)[:,-4:][:,::-1]
values=np.take_along_axis(weights,ids,axis=1).clip(0)
values/=values.sum(1,keepdims=True)
def encode(data):
    return base64.b64encode(zlib.compress(data.tobytes(),9)).decode()

# Share the fitted attributes across UV duplicates and retain the original
# triangle stream and texture coordinates from the GLB.
out=['// Generated by tools/bind-unicorn.py from the source GLB and legacy rig.']
for name,data in [('vertex',lookup.astype('<u2')),('position',np.rint(q*8192).astype('<i2')),
                  ('normal',np.rint(normals*127).astype('i1')),
                  ('joint',ids.astype('u1')),('weight',np.rint(values*65535).astype('<u2'))]:
    out.append(f"export const {name}='{encode(data)}';")
# Preserve local surface detail through large neck bends. Screen the solve
# against the authored animation and pin every skull vertex to the head joint.
pin=np.full(n,.0006)
pin[head|(y<.22)]=1000
screen=degree*pin
solve_pose=factorized((lap+sparse.diags(screen)).tocsc())
for name,frame in zip(['halfGraze','fullGraze'],rig['grazing']):
    matrices=np.array(frame).reshape(-1,4,4).transpose(0,2,1)
    blended=np.einsum('nk,nkij->nij',values,matrices[ids])
    linear=blended[:,:3,:3]
    posed=np.einsum('nij,nj->ni',linear,q)+blended[:,:3,3]
    grad=w[:,None]*np.einsum('nij,nj->ni',(linear[a]+linear[c])*.5,q[a]-q[c])
    rhs=screen[:,None]*posed
    np.add.at(rhs,a,grad);np.add.at(rhs,c,-grad)
    correction=np.linalg.solve(linear,(solve_pose(rhs)-posed)[...,None])[:,:,0]
    correction[head]=0
    out.append(f"export const {name}='{encode(np.rint(correction*8192).astype('<i2'))}';")
(species/'unicorn-binding.js').write_text('\n'.join(out)+'\n',encoding='ascii')
