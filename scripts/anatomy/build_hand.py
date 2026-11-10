# Right-hand bones from BodyParts3D, each stored in a frame that maps onto MediaPipe hand landmarks.
import numpy as np, trimesh, fast_simplification as fs, json
S='repo/assets/BodyParts3D_data/stl/'
def load(i): return trimesh.load(S+i+'.stl')
def simp(m,target):
    v,f=m.vertices,m.faces
    if len(f)>target: v,f=fs.simplify(v.astype(np.float32),f.astype(np.int32),target_reduction=1-target/len(f))
    mm=trimesh.Trimesh(v,f,process=True); mm.remove_unreferenced_vertices(); return mm
def ends(V):
    c=V.mean(0); u=np.linalg.svd(V-c)[2][0]
    if u[2]>0: u=-u           # arm hangs down: distal = lower z
    d=(V-c)@u
    return c+u*d.min(), c+u*d.max(), u   # proximal, distal, axis
carpals=['FMA24435','FMA24437','FMA24439','FMA24441','FMA24443','FMA24446','FMA24448']
meta={'thumb_mc':'FMA24464','mc':{'index':'FMA24466','middle':'FMA24468','ring':'FMA24470','little':'FMA24472'}}
mcV={k:load(v).vertices for k,v in meta['mc'].items()}
mcEnds={k:ends(v) for k,v in mcV.items()}
carV=np.vstack([load(i).vertices for i in carpals])
# palm frame: origin W (proximal edge of the carpus), Y -> middle MCP, X -> index side
MCP2,MCP3,MCP5=mcEnds['index'][1],mcEnds['middle'][1],mcEnds['little'][1]
Y=MCP3-carV.mean(0); Y/=np.linalg.norm(Y)
W=carV.mean(0)+Y*((carV-carV.mean(0))@Y).min()
X=MCP2-MCP5; X-=Y*(X@Y); X/=np.linalg.norm(X); Z=np.cross(X,Y)
palmLen=np.linalg.norm(MCP3-W); palmWidth=np.linalg.norm(MCP2-MCP5)
def palm_local(V): D=V-W; return np.c_[D@X/palmWidth, D@Y/palmLen, D@Z/palmWidth]
parts=[]; blobs=[]; off=0
def emit(key,label,V,F,frame):
    global off
    V=V.astype(np.float32); lo,hi=V.min(0),V.max(0)
    q=np.round((V-lo)/np.maximum(hi-lo,1e-6)*65535).astype(np.uint16); vb=q.tobytes(); pad=(-len(vb))%4
    ib=F.astype(np.uint16).tobytes(); pad2=(-len(ib))%4
    parts.append({'key':key,'label':label,'frame':frame,'min':lo.round(6).tolist(),'max':hi.round(6).tolist(),'vOffset':off,'vCount':len(V),'iOffset':off+len(vb)+pad,'iCount':int(F.size)})
    blobs.extend([vb,b'\0'*pad,ib,b'\0'*pad2]); off+=len(vb)+pad+len(ib)+pad2
m=simp(trimesh.util.concatenate([load(i) for i in carpals]+[load(v) for v in meta['mc'].values()]),2400)
emit('palm','Carpals & metacarpals',palm_local(m.vertices),m.faces,{'type':'palm','landmarks':[0,5,9,17]})
# per-bone segments: (fma, label, landmark a, landmark b)
segs=[('FMA24464','First metacarpal',1,2),('FMA24450','Proximal phalanx (thumb)',2,3),('FMA24459','Distal phalanx (thumb)',3,4),
 ('FMA24451','Proximal phalanx',5,6),('FMA24455','Middle phalanx',6,7),('FMA24460','Distal phalanx',7,8),
 ('FMA24452','Proximal phalanx',9,10),('FMA24456','Middle phalanx',10,11),('FMA24461','Distal phalanx',11,12),
 ('FMA24453','Proximal phalanx',13,14),('FMA24457','Middle phalanx',14,15),('FMA24462','Distal phalanx',15,16),
 ('FMA24454','Proximal phalanx',17,18),('FMA24458','Middle phalanx',18,19),('FMA24463','Distal phalanx',19,20)]
for fma,label,a,b in segs:
    mm=simp(load(fma),300); p,d,u=ends(mm.vertices); L=np.linalg.norm(d-p)
    by=u; bz=Z-by*(Z@by); bz/=np.linalg.norm(bz); bx=np.cross(by,bz)
    D=mm.vertices-p; V=np.c_[D@bx,D@by,D@bz]/L
    emit(f'{fma}','%s'%label,V,mm.faces,{'type':'segment','a':a,'b':b})
open('out/hand.bin','wb').write(b''.join(blobs))
json.dump({'source':'BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 JP (right hand, simplified; segments normalized to bone length, palm normalized to palm length/width)','parts':parts},open('out/hand.json','w'),separators=(',',':'))
print('hand bytes',off,'parts',len(parts))
