import json, numpy as np
from PIL import Image, ImageDraw
SP='/tmp/claude-0/-home-claude-velda-studio/c9d11554-e7d4-55b5-8e95-9d78689a2ce2/scratchpad/'
im=np.array(Image.open(SP+'img-005.jpg').convert('L'))
dark=im<170
H,W=dark.shape
m=json.load(open(SP+'l2.json'))
S=6.25; OX=-4+3.1*S; OY=-4+126*S   # model inches -> px
def px(x,y): return x*S+OX, y*S+OY
def isdark(x,y):
    xi,yi=int(round(x)),int(round(y))
    if 0<=xi<W and 0<=yi<H: return dark[yi,xi]
    return False
out=[]
for w in m['walls']:
    (ax,ay),(bx,by)=w['a'],w['b']; t=w['t']
    L=((bx-ax)**2+(by-ay)**2)**.5
    ux,uy=(bx-ax)/L,(by-ay)/L; nx,ny=-uy,ux
    codes=[]
    for k in range(int(L*2)+1):           # every half inch
        s=k/2
        cx,cy=ax+ux*s,ay+uy*s
        prof=[]
        for j in np.arange(-(t/2+1.2), t/2+1.2+1e-6, 0.16):   # ~1px steps across
            X,Y=px(cx+nx*j, cy+ny*j); prof.append(isdark(X,Y))
        prof=np.array(prof); n=len(prof)
        runs=int(np.sum(prof[1:]&~prof[:-1])+prof[0])
        core=prof[int(n*.3):int(n*.7)]
        face1=prof[:int(n*.3)].any(); face2=prof[int(n*.7):].any()
        full=prof[int(n*.15):int(n*.85)].mean()>0.8
        if full: c='J'
        elif face1 and face2 and core.any() and runs>=3: c='W'
        elif face1 and face2: c='S'
        elif not face1 and not face2 and not core.any(): c='G'
        else: c='P'
        codes.append(c)
    out.append({'id':w['id'],'codes':''.join(codes),'L':L})
json.dump(out,open(SP+'codes.json','w'))
for o in out: print(o['id'], round(o['L']), o['codes'][::4])
