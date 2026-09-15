import re, json
from fontTools.svgLib.path import parse_path
from fontTools.pens.recordingPen import RecordingPen

def hex2rgb(h):
    h=h.lstrip('#'); return tuple(int(h[i:i+2],16)/255 for i in (0,2,4))

def parse_transform(t):
    tx=ty=0; s=1
    if not t: return tx,ty,s
    m=re.search(r'translate\(([-\d.]+)[ ,]+([-\d.]+)\)',t)
    if m: tx,ty=float(m.group(1)),float(m.group(2))
    m=re.search(r'scale\(([-\d.]+)\)',t)
    if m: s=float(m.group(1))
    return tx,ty,s

def shape_to_ps(shape, H):
    tx,ty,s=parse_transform(shape.get('transform'))
    pen=RecordingPen(); parse_path(shape['d'], pen)
    def P(pt): x,y=pt; return f"{tx+x*s:.3f} {H-(ty+y*s):.3f}"
    out=[]; cur=None; start=None
    for op,args in pen.value:
        if op=='moveTo': cur=start=args[0]; out.append(P(cur)+" m")
        elif op=='lineTo': cur=args[0]; out.append(P(cur)+" l")
        elif op=='curveTo':
            c1,c2,p=args; out.append(f"{P(c1)} {P(c2)} {P(p)} c"); cur=p
        elif op=='qCurveTo':
            pts=list(args)
            # fontTools convention: implied on-curve points between consecutive off-curves
            if pts[-1] is None: pts[-1]=pts[0]
            prev=cur
            offs=pts[:-1]; end=pts[-1]
            for i,off in enumerate(offs):
                nxt = end if i==len(offs)-1 else ((off[0]+offs[i+1][0])/2,(off[1]+offs[i+1][1])/2)
                c1=(prev[0]+2/3*(off[0]-prev[0]), prev[1]+2/3*(off[1]-prev[1]))
                c2=(nxt[0]+2/3*(off[0]-nxt[0]), nxt[1]+2/3*(off[1]-nxt[1]))
                out.append(f"{P(c1)} {P(c2)} {P(nxt)} c"); prev=nxt
            cur=end
        elif op=='closePath': out.append("h")
        elif op=='endPath': pass
    body="\n".join(out)
    ps=[]
    if shape.get('fill'):
        r,g,b=hex2rgb(shape['fill']); ps.append(f"gsave {r:.3f} {g:.3f} {b:.3f} rg\n{body}\nfill grestore")
    if shape.get('stroke'):
        r,g,b=hex2rgb(shape['stroke']); w=shape.get('sw',1)*s
        cap={'round':1,'butt':0,'square':2}[shape.get('cap','round')]; join={'round':1,'miter':0,'bevel':2}[shape.get('join','round')]
        ps.append(f"gsave {r:.3f} {g:.3f} {b:.3f} rg {w:.3f} w {cap} J {join} j\n{body}\nstroke grestore")
    return "\n".join(ps)

def to_eps(m, title):
    x,y,W,H=m['viewBox']
    hdr=f"""%!PS-Adobe-3.0 EPSF-3.0
%%BoundingBox: 0 0 {int(W+0.999)} {int(H+0.999)}
%%HiResBoundingBox: 0 0 {W:.3f} {H:.3f}
%%Title: {title}
%%Creator: Regemcast brand kit
%%EndComments
/m {{moveto}} bind def /l {{lineto}} bind def /c {{curveto}} bind def /h {{closepath}} bind def
/rg {{setrgbcolor}} bind def /w {{setlinewidth}} bind def /J {{setlinecap}} bind def /j {{setlinejoin}} bind def
"""
    body="\n".join(shape_to_ps(s,H) for s in m['shapes'])
    return hdr+body+"\nshowpage\n%%EOF\n"

if __name__=="__main__":
    import os
    idx=json.load(open('masters.json')); os.makedirs('../logo/eps',exist_ok=True)
    for name,m in idx.items():
        open(f'../logo/eps/{name}.eps','w').write(to_eps(m,name))
    print('eps ok',len(idx))
