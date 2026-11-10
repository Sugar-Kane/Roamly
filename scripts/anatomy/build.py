# Builds public/anatomy/head.bin + head.json from BodyParts3D (CC BY-SA 2.1 JP).
import numpy as np, trimesh, fast_simplification as fs, json, struct, re
S='repo/assets/BodyParts3D_data/stl/'
names={}
for line in open('repo/assets/BodyParts3D_data/parts_list_e.txt',encoding='utf-8'):
    p=line.rstrip('\n').split('\t')
    if len(p)>=2: names[p[0].strip('"')]=p[1]
al=json.load(open('align.json')); s=al['s']; Rm=np.array(al['R']); t=np.array(al['t'])
def to_canon(P):
    P=np.asarray(P,float); C=np.c_[P[:,0],P[:,2],-P[:,1]]/10.0
    return (s*(Rm@C.T)).T+t
def simplify(m, target):
    v,f=m.vertices,m.faces
    if len(f)>target:
        v,f=fs.simplify(v.astype(np.float32),f.astype(np.int32),target_reduction=1-target/len(f))
    mm=trimesh.Trimesh(v,f,process=True); mm.remove_unreferenced_vertices()
    return mm
def merge(ids, target):
    ms=[trimesh.load(S+i+'.stl') for i in ids]
    m=trimesh.util.concatenate(ms) if len(ms)>1 else ms[0]
    return simplify(m,target)
# --- part catalog: (key, layer, label, [ids], triangle budget) ---
skull=['FMA52734','FMA52735','FMA52736','FMA52738','FMA52739','FMA52740','FMA52788','FMA52789','FMA52892','FMA52893','FMA53645','FMA53646','FMA53647','FMA53648','FMA53649','FMA53650','FMA53655','FMA53656','FMA54737','FMA54738','FMA9710']
upper_teeth='FMA55680 FMA55681 FMA55682 FMA55683 FMA55688 FMA55689 FMA55690 FMA55691 FMA55697 FMA55698 FMA55699 FMA55700 FMA55798 FMA55799'.split()
lower_teeth='FMA55686 FMA55687 FMA55692 FMA55693 FMA55694 FMA55695 FMA55703 FMA55704 FMA55705 FMA55706 FMA57140 FMA57141 FMA57142 FMA57143'.split()
P=[]
bone_labels={'FMA52734':'Frontal bone','FMA52735':'Occipital bone','FMA52736':'Sphenoid bone','FMA52738':'Temporal bone','FMA52739':'Temporal bone','FMA52740':'Ethmoid bone','FMA52788':'Parietal bone','FMA52789':'Parietal bone','FMA52892':'Zygomatic bone','FMA52893':'Zygomatic bone','FMA53645':'Lacrimal bone','FMA53646':'Lacrimal bone','FMA53647':'Nasal bone','FMA53648':'Nasal bone','FMA53649':'Maxilla','FMA53650':'Maxilla','FMA53655':'Palatine bone','FMA53656':'Palatine bone','FMA54737':'Inferior nasal concha','FMA54738':'Inferior nasal concha','FMA9710':'Vomer'}
budget={'FMA52734':5000,'FMA52735':3500,'FMA52736':3000,'FMA52738':2600,'FMA52739':2600,'FMA52788':2600,'FMA52789':2600,'FMA53649':2800,'FMA53650':2800,'FMA52892':1200,'FMA52893':1200}
for i in skull: P.append((i,'skull',bone_labels[i],[i],budget.get(i,600)))
P.append(('upper_teeth','skull','Upper teeth',upper_teeth,2400))
P.append(('mandible','jaw','Mandible',['FMA52748'],4500))
P.append(('lower_teeth','jaw','Lower teeth',lower_teeth,2400))
P.append(('eyes','eyes','Eyeball',['FMA12513'],1600))
lobes={'Frontal lobe':'FMA72653 FMA72654 FMA72655 FMA72656 FMA72661 FMA72662 BP51','Parietal lobe':'FMA72665 FMA72666 FMA72667 FMA72668 FMA72669 FMA72670 BP49 BP50','Temporal lobe':'FMA72685 FMA72686 FMA72687 FMA72688 FMA72689 FMA72690 FMA72800 FMA72801 FMA72804 FMA72805','Occipital lobe':'FMA72975 FMA72976','Insula':'FMA72977 FMA72978','Cerebellum':'FMA67944','Brainstem':'FMA67943 FMA62004 FMA61993nsn'}
lb={'Frontal lobe':9000,'Parietal lobe':7000,'Temporal lobe':7000,'Occipital lobe':3000,'Insula':800,'Cerebellum':5000,'Brainstem':1500}
for k,v in lobes.items(): P.append((k.lower().replace(' ','_'),'brain',k,v.split(),lb[k]))
muscles=[('Temporalis','FMA49007 FMA49008',2400),('Masseter','FMA49001 FMA49002 FMA49004 FMA49005',2000),('Orbicularis oculi','FMA46782 FMA46783 FMA46785 FMA46786',1600),('Orbicularis oris','FMA46841',1000),('Zygomaticus major','FMA46812 FMA46813',500),('Zygomaticus minor','FMA46814 FMA46815',400),('Levator labii superioris','FMA46806 FMA46807 FMA46803 FMA46804',700),('Depressor anguli oris','FMA46829 FMA46830',400),('Depressor labii inferioris','FMA46817 FMA46818',400),('Mentalis','FMA46826 FMA46827',400),('Buccinator','FMA46835 FMA46836',900),('Risorius','FMA46839 FMA46840',300),('Nasalis','FMA55606 FMA55607',300),('Procerus','FMA55610 FMA55611',200),('Temporoparietalis','FMA46763 FMA46764',800),('Sternocleidomastoid','FMA13408 FMA13409',1600)]
for n,ids,b in muscles: P.append((n.lower().replace(' ','_'),'muscles',n,ids.split(),b))

def anchors(V):
    # One label point per side for paired parts (a single centroid would sit inside the head).
    L,R=V[V[:,0]>0.6],V[V[:,0]<-0.6]
    if len(L)>0.25*len(V) and len(R)>0.25*len(V):
        out=[]
        for S in (L,R):
            c=S.mean(0); far=S[np.argsort(-np.abs(S[:,0]-0))][:max(5,len(S)//20)].mean(0)
            out.append(((c+far)/2).round(3).tolist())   # between centroid and outer surface
        return out
    c=V.mean(0); front=V[np.argsort(-V[:,2])][:max(5,len(V)//20)].mean(0)
    return [((c+front)/2).round(3).tolist()]
meta={'source':'BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 JP (simplified, merged and re-aligned to the MediaPipe canonical face)','units':'cm, MediaPipe canonical face model space','parts':[]}
blobs=[]; off=0
for key,layer,label,ids,b in P:
    m=merge(ids,b); V=to_canon(m.vertices).astype(np.float32); F=m.faces.astype(np.uint32)
    assert len(V)<65536, key
    lo,hi=V.min(0),V.max(0); q=np.round((V-lo)/np.maximum(hi-lo,1e-6)*65535).astype(np.uint16)
    vb=q.tobytes(); ib=F.astype(np.uint16).tobytes()
    pad=(-len(vb))%4
    meta['parts'].append({'key':key,'layer':layer,'label':label,'fma':ids,'min':lo.round(5).tolist(),'max':hi.round(5).tolist(),
        'vOffset':off,'vCount':len(V),'iOffset':off+len(vb)+pad,'iCount':int(F.size),'anchors':anchors(V)})
    blobs+= [vb,b'\0'*pad,ib,b'\0'*((-len(ib))%4)]; off+=len(vb)+pad+len(ib)+((-len(ib))%4)
    print(f'{key:28} {layer:8} v={len(V):6} tris={len(F):6}')
mand=[p for p in meta['parts'] if p['key']=='mandible'][0]
# TMJ pivot: mean of the two condyle tops (highest mandible points, left & right)
m=merge(['FMA52748'],4500); V=to_canon(m.vertices)
cond=[V[V[:,0]>0][np.argmax(V[V[:,0]>0][:,1])], V[V[:,0]<0][np.argmax(V[V[:,0]<0][:,1])]]
meta['jawPivot']=np.mean(cond,0).round(3).tolist()
import os; os.makedirs('out',exist_ok=True)
open('out/head.bin','wb').write(b''.join(blobs)); json.dump(meta,open('out/head.json','w'),separators=(',',':'))
print('bin bytes',off,'parts',len(P),'jawPivot',meta['jawPivot'])
