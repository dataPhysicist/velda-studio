import json
m=json.load(open('l2.json')); rep={r['id']:r for r in json.load(open('report.json'))}
ev=lambda w: int(round(w/2.0))*2
changes=[]; out=[]
for w in m['walls']:
    r=rep[w['id']]; old=w['openings']; new=[]
    gaps=[o for o in r['new'] if o['kind']=='gap']
    wins=[o for o in r['new'] if o['kind']=='window']
    if r['ext']:
        for i,o in enumerate(wins,1):
            new.append({'id':f"{w['id']}n{i}",'kind':'window','at':o['at'],'w':ev(o['w']),'h':48,'sill':36})
    else:
        new += [] # interior walls carry no windows
    for i,g in enumerate(gaps,1):
        match=[d for d in old if d['kind']!='window' and abs(d['at']-g['at']) < (d['w']+g['w'])/2]
        style=match[0].get('style','swing') if match else 'swing'
        if w['id']=='L2w34': style='french'
        new.append({'id':f"{w['id']}d{i}",'kind':'door','at':g['at'],'w':round(g['w']*2)/2,'h':80 if g['w']<70 else 80,'style':style})
    def sig(ops): return sorted((o['kind'],o.get('style'),round(o['at']),round(o['w'])) for o in ops)
    if sig(old)!=sig(new): changes.append((w['id'], sig(old), sig(new)))
    out.append({**w,'openings':sorted(new,key=lambda o:o['at'])})
# missing guest bath closet wall with its 2'-0" door (measured faces at 703 and 707)
out.append({'id':'L2w57','level':'L2','a':[705.0,385.5],'b':[705.0,456.7],'t':4,'openings':[{'id':'L2w57d1','kind':'door','at':26.0,'w':23,'h':80,'style':'swing'}]})
changes.append(('L2w57',[],'new wall, 23in door'))
json.dump(out,open('l2_new_walls.json','w'),separators=(',',':'))
for c in changes: print(c)
print(len(out), len(json.dumps(out,separators=(',',':'))))
