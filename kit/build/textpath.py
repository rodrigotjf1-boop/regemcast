from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

FONT = "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf"
_font = TTFont(FONT)
_cmap = _font.getBestCmap()
_glyphs = _font.getGlyphSet()
_upem = _font['head'].unitsPerEm
_hmtx = _font['hmtx']

def _kern_pairs():
    pairs = {}
    try:
        gpos = _font['GPOS'].table
        for lookup in gpos.LookupList.Lookup:
            for st in lookup.SubTable:
                if getattr(st, 'LookupType', lookup.LookupType) != 2:
                    continue
                if st.Format == 1:
                    first = st.Coverage.glyphs
                    for i, ps in enumerate(st.PairSet):
                        for pvr in ps.PairValueRecord:
                            v = pvr.Value1.XAdvance if pvr.Value1 and hasattr(pvr.Value1,'XAdvance') else 0
                            if v: pairs[(first[i], pvr.SecondGlyph)] = v
                elif st.Format == 2:
                    cd1, cd2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
                    for g1 in st.Coverage.glyphs:
                        c1 = cd1.get(g1, 0)
                        for g2 in _cmap.values():
                            c2 = cd2.get(g2, 0)
                            rec = st.Class1Record[c1].Class2Record[c2]
                            v = rec.Value1.XAdvance if rec.Value1 and hasattr(rec.Value1,'XAdvance') else 0
                            if v: pairs[(g1, g2)] = v
    except Exception:
        pass
    return pairs
_kern = _kern_pairs()

def text_path(text, size, letter_spacing=0.0, x=0.0, y=0.0):
    """Return (path_d, width) for text with baseline at (x,y); size in user units."""
    scale = size / _upem
    d = []
    pen_x = 0.0
    prev = None
    for ch in text:
        g = _cmap.get(ord(ch))
        if g is None:
            pen_x += size * 0.3; prev=None; continue
        if prev and (prev, g) in _kern:
            pen_x += _kern[(prev, g)] * scale
        p = SVGPathPen(_glyphs)
        tp = TransformPen(p, (scale, 0, 0, -scale, x + pen_x, y))
        _glyphs[g].draw(tp)
        cmds = p.getCommands()
        if cmds: d.append(cmds)
        pen_x += _hmtx[g][0] * scale + letter_spacing
        prev = g
    width = pen_x - letter_spacing if text else 0
    return " ".join(d), width

def cap_height(size): 
    try: return _font['OS/2'].sCapHeight * size / _upem
    except: return size*0.7
def x_height(size):
    try: return _font['OS/2'].sxHeight * size / _upem
    except: return size*0.5
