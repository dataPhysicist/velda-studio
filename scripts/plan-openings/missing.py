import json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
im=np.array(Image.open('img-005.jpg').convert('L')); dark=im<170; H,W=dark.shape
walls=json.load(open('l2_new_walls.json')); S=6.25; OX=-4+3.1*S; OY=-4+126*S
def runs_mask(d, axis):
    # white runs bounded by dark on both sides, length 2.5"-8.5" across `axis`
    out=np.zeros_like(d)
    a=d if axis==0 else d.T; o=out if axis==0 else out.T
    for j in range(a.shape[1]):
        col=a[:,j]; idx=np.nonzero(col)[0]
        if len(idx)<2: continue
        gaps=np.diff(idx)
        for k in np.nonzero((gaps>=16)&(gaps<=54))[0]:
            o[idx[k]+1:idx[k+1], j]=True
    return out
hcore=runs_mask(dark,0)   # vertical runs -> horizontal wall cores
vcore=runs_mask(dark,1)
# keep cores that extend >= 12" along the wall
hcore=ndimage.binary_opening(hcore, structure=np.ones((1,75)))
vcore=ndimage.binary_opening(vcore, structure=np.ones((75,1)))
core=hcore|vcore
# remove areas covered by model walls (+2")
cov=Image.new('L',(W,H),0); d=ImageDraw.Draw(cov)
for w in walls:
    (ax,ay),(bx,by)=w['a'],w['b']; t=w['t']/2+2.5
    x0,x1=sorted([ax,bx]); y0,y1=sorted([ay,by])
    d.rectangle([(x0-t)*S+OX,(y0-t)*S+OY,(x1+t)*S+OX,(y1+t)*S+OY],fill=255)
miss=core & ~(np.array(cov)>0)
lab,n=ndimage.label(miss)
res=[]
for i,sl in enumerate(ndimage.find_objects(lab),1):
    ys,xs=sl; h=(ys.stop-ys.start)/S; w=(xs.stop-xs.start)/S
    if max(h,w)<12: continue
    x0=(xs.start-OX)/S; x1=(xs.stop-OX)/S; y0=(ys.start-OY)/S; y1=(ys.stop-OY)/S
    res.append([round(x0,1),round(y0,1),round(x1,1),round(y1,1)])
for r in sorted(res,key=lambda r:(r[1],r[0])): print(r, 'len', round(max(r[2]-r[0],r[3]-r[1]),1), 'thk', round(min(r[2]-r[0],r[3]-r[1]),1))
json.dump(res,open('missing.json','w'))
