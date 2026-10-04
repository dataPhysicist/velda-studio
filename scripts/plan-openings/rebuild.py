import json, re, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
SP=''
im=np.array(Image.open('img-005.jpg').convert('L')); dark=im<170; H,W=dark.shape
m=json.load(open('l2.json')); codes={o['id']:o['codes'] for o in json.load(open('codes.json'))}
S=6.25; OX=-4+3.1*S; OY=-4+126*S
px=lambda x,y:(x*S+OX,y*S+OY)
# outside = white region connected to the image border (walls are closed outlines)
lab,_=ndimage.label(~ndimage.binary_dilation(dark,iterations=2))
outside=np.isin(lab, np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))
def out_at(x,y):
    X,Y=map(int,px(x,y)); return 0<=X<W and 0<=Y<H and outside[Y,X]
def runs(s,ch):
    return [(m_.start()/2, m_.end()/2) for m_ in re.finditer(ch, s)]
report=[]; new_walls=[]
for w in m['walls']:
    c=codes[w['id']]; (ax,ay),(bx,by)=w['a'],w['b']; L=((bx-ax)**2+(by-ay)**2)**.5
    ux,uy=(bx-ax)/L,(by-ay)/L; nx,ny=-uy,ux
    # exterior if either side is outside at several points along the wall
    ext=sum(out_at(ax+ux*s+nx*k*(w['t']/2+5), ay+uy*s+ny*k*(w['t']/2+5)) for s in np.linspace(L*.2,L*.8,5) for k in (1,-1))>=3
    ops=[]
    if ext:
        for s0,s1 in runs(c, r'J?W[WJ]*W(?:J)?'):
            if s1-s0>=12: ops.append({'kind':'window','at':round((s0+s1)/2,1),'w':round(s1-s0,1)})
    for s0,s1 in runs(c, r'[PJ]{0,6}G{8,}(?:[PJ]{0,4}G+)*[PJ]{0,6}'):
        a0,a1=s0,s1
        if a0<1 or a1>L-1: continue           # wall ends, not an opening
        ops.append({'kind':'gap','at':round((a0+a1)/2,1),'w':round(a1-a0,1)})
    report.append({'id':w['id'],'ext':bool(ext),'old':[(o['kind'],o.get('style'),round(o['at'],1),o['w']) for o in w['openings']],'new':ops})
for r in report:
    if r['old'] or r['new']: print(r['id'], 'EXT' if r['ext'] else 'int', 'old', r['old'], '\n      new', r['new'])
json.dump(report,open('report.json','w'))
# draw proposal
img=Image.open('img-005.jpg').convert('RGB'); d=ImageDraw.Draw(img,'RGBA')
for w,r in zip(m['walls'],report):
    (ax,ay),(bx,by)=w['a'],w['b']; L=((bx-ax)**2+(by-ay)**2)**.5; ux,uy=(bx-ax)/L,(by-ay)/L; nx,ny=-uy,ux
    for o in r['new']:
        col=(30,90,230,140) if o['kind']=='window' else (30,180,60,140)
        s0,s1=o['at']-o['w']/2,o['at']+o['w']/2; h=w['t']/2+3
        pts=[px(ax+ux*s0+nx*h,ay+uy*s0+ny*h),px(ax+ux*s1+nx*h,ay+uy*s1+ny*h),px(ax+ux*s1-nx*h,ay+uy*s1-ny*h),px(ax+ux*s0-nx*h,ay+uy*s0-ny*h)]
        d.polygon(pts,fill=col)
    for o in w['openings']:
        s0,s1=o['at']-o['w']/2,o['at']+o['w']/2; h=w['t']/2+9
        a=px(ax+ux*s0+nx*h,ay+uy*s0+ny*h); b=px(ax+ux*s1+nx*h,ay+uy*s1+ny*h)
        d.line([a,b],fill=(220,30,30,255),width=10)
img.crop((400,900,4950,4850)).resize((1138,988)).save('proposal.png')
