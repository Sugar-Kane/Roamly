import numpy as np, trimesh, json
S='repo/assets/BodyParts3D_data/stl/'
def load(i): return trimesh.load(S+i+'.stl')
def to_canon(P):  # BP3D mm (X left+, Y posterior+, Z up) -> canonical cm (x left+, y up, z forward)
    P=np.asarray(P,float); return np.c_[P[:,0], P[:,2], -P[:,1]]/10.0
eye=load('FMA12513'); ev=to_canon(eye.vertices)
L=ev[ev[:,0]>0].mean(0); R=ev[ev[:,0]<0].mean(0)
mand=to_canon(load('FMA52748').vertices)
front=mand[np.abs(mand[:,0])<0.4]; menton=front[np.argmin(front[:,1])]
nas=np.vstack([to_canon(load(i).vertices) for i in ['FMA53647','FMA53648']]); nasion=nas[np.argmax(nas[:,1])]
fr=to_canon(load('FMA52734').vertices); mid=fr[np.abs(fr[:,0])<0.4]
glabella=mid[np.argmax(mid[:,2])]
src={'Leye':L,'Reye':R,'nasion':nasion,'menton':menton,'glabella':glabella}
# canonical targets (soft-tissue landmarks pushed inward by typical tissue depth)
V=np.array([list(map(float,l.split()[1:4])) for l in open('canonical_face_model.obj') if l.startswith('v ')])
Re=V[[33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246]].mean(0)
Le=V[[263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466]].mean(0)
dst={'Leye':Le+[0,0,-1.15],'Reye':Re+[0,0,-1.15],'nasion':V[168]+[0,0,-0.65],'menton':V[152]+[0,0.65,-0.35],'glabella':V[9]+[0,0,-0.55]}
keys=list(src); A=np.array([src[k] for k in keys]); B=np.array([dst[k] for k in keys])
# similarity fit (Umeyama) with rotation allowed
ma,mb=A.mean(0),B.mean(0); A0,B0=A-ma,B-mb
U,Sg,Vt=np.linalg.svd(B0.T@A0); D=np.eye(3); D[2,2]=np.sign(np.linalg.det(U@Vt)); Rm=U@D@Vt
s=(Sg*np.diag(D)).sum()/(A0**2).sum(); t=mb-s*Rm@ma
fit=(s*(Rm@A.T)).T+t
ang=np.degrees(np.arctan2(Rm[2,1],Rm[1,1]))
print('scale',round(s,4),'pitch deg',round(ang,2),'t',t.round(2))
for k,f,b in zip(keys,fit,B): print(f'{k:9} residual cm {np.linalg.norm(f-b):.2f}', f.round(2), b.round(2))
json.dump({'s':s,'R':Rm.tolist(),'t':t.tolist()},open('align.json','w'))
