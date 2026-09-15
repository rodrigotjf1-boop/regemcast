import json, os
from textpath import text_path, x_height

ORANGE="#A3E635"; PLUM="#2B1B3D"; WHITE="#FFFFFF"; BLACK="#000000"; YELLOW="#FFD166"; CREAM="#FFF3EA"

BUBBLE="M26 16H74A12 12 0 0 1 86 28V60A12 12 0 0 1 74 72H44L28 88L31 72H26A12 12 0 0 1 14 60V28A12 12 0 0 1 26 16Z"
PULSE="M24 48H32L38 38L44 48L50 30L56 48L62 40L68 48H76"

def symbol_shapes(bubble, pulse, ox=0, oy=0, s=1.0):
    # returns shapes in a 100x100 box scaled by s and offset
    t = f"translate({ox} {oy}) scale({s})"
    return [dict(d=BUBBLE, fill=bubble, transform=t),
            dict(d=PULSE, stroke=pulse, sw=6, transform=t)]

def wordmark_shapes(color, x, baseline, size=46, byline=True, byline_color=None, center_byline=False):
    d, w = text_path("regemcast", size, letter_spacing=-size*0.012, x=x, y=baseline)
    shapes=[dict(d=d, fill=color, stroke=color, sw=size*0.026, join="round")]
    if byline:
        bsize=size*0.215; bls=size*0.04
        _, bw = text_path("DMS TECNOLOGIA", bsize, letter_spacing=bls)
        bx = x+(w-bw)/2 if center_byline else x+size*0.02
        bd, bw = text_path("DMS TECNOLOGIA", bsize, letter_spacing=bls, x=bx, y=baseline+size*0.52)
        shapes.append(dict(d=bd, fill=byline_color or color))
        w = max(w, bw)
    return shapes, w

def master(kind, variant):
    """kind: simbolo|horizontal|vertical ; variant: cor-claro|cor-escuro|mono-preto|mono-branco"""
    if variant=="cor-claro":   bubble,pulse,word,by = ORANGE,WHITE,PLUM,PLUM
    elif variant=="cor-escuro":bubble,pulse,word,by = ORANGE,PLUM,WHITE,WHITE
    elif variant=="mono-preto":bubble,pulse,word,by = BLACK,WHITE,BLACK,BLACK
    elif variant=="mono-branco":bubble,pulse,word,by = WHITE,BLACK,WHITE,WHITE
    shapes=[]
    if kind=="simbolo":
        shapes += symbol_shapes(bubble,pulse); vb=(0,0,100,100)
    elif kind=="horizontal":
        shapes += symbol_shapes(bubble,pulse, ox=0, oy=0, s=1.0)
        size=40; base=44+x_height(size)/2
        ws,w = wordmark_shapes(word, x=100, baseline=base, size=size, byline_color=by)
        shapes += ws; vb=(0,0,100+w+6,100)
    elif kind=="vertical":
        size=28; pad=6
        ws,w = wordmark_shapes(word, x=0, baseline=0, size=size, byline_color=by, center_byline=True)
        total_w=max(100,w)+2*pad; sx=(total_w-100)/2; wx=(total_w-w)/2
        shapes += symbol_shapes(bubble,pulse, ox=sx, oy=0, s=1.0)
        base=100+size*0.8
        ws,w = wordmark_shapes(word, x=wx, baseline=base, size=size, byline_color=by, center_byline=True)
        shapes += ws; vb=(0,0,total_w,base+size*0.78)
    return dict(viewBox=vb, shapes=shapes)

def to_svg(m, bg=None):
    x,y,w,h=m["viewBox"]
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w:.2f} {h:.2f}" width="{w:.2f}" height="{h:.2f}">']
    if bg: out.append(f'<rect x="{x}" y="{y}" width="{w:.2f}" height="{h:.2f}" fill="{bg}"/>')
    for s in m["shapes"]:
        a=[f'd="{s["d"]}"']
        a.append(f'fill="{s.get("fill") or "none"}"')
        if s.get("stroke"):
            a.append(f'stroke="{s["stroke"]}" stroke-width="{s.get("sw",1):.3f}" stroke-linecap="{s.get("cap","round")}" stroke-linejoin="{s.get("join","round")}"')
        if s.get("transform"): a.append(f'transform="{s["transform"]}"')
        out.append("<path "+" ".join(a)+"/>")
    out.append("</svg>")
    return "\n".join(out)

VARIANTS=["cor-claro","cor-escuro","mono-preto","mono-branco"]
KINDS=["simbolo","horizontal","vertical"]
if __name__=="__main__":
    outdir="../logo/svg"; os.makedirs(outdir,exist_ok=True)
    idx={}
    for k in KINDS:
        for v in VARIANTS:
            m=master(k,v); name=f"regemcast-{k}-{v}"
            open(f"{outdir}/{name}.svg","w").write(to_svg(m))
            idx[name]=m
    json.dump(idx, open("masters.json","w"))
    print("ok", len(idx))
