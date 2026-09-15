import json, subprocess, os
from PIL import Image, ImageDraw
ORANGE="#A3E635"; PLUM="#2B1B3D"; WHITE="#FFFFFF"; CREAM="#FFF3EA"; YELLOW="#FFD166"
def svgfile(n): return open(f'../logo/svg/{n}.svg').read().replace('width=','data-w=',1).replace('height=','data-h=',1)
H_ESC=svgfile('regemcast-horizontal-cor-escuro'); H_CLA=svgfile('regemcast-horizontal-cor-claro'); V_ESC=svgfile('regemcast-vertical-cor-escuro')
SYM=open('../logo/svg/regemcast-simbolo-cor-claro.svg').read()
ICON=open('../icones/svg/icone-app-arredondado.svg').read()
SB="M26 16H74A12 12 0 0 1 86 28V60A12 12 0 0 1 74 72H44L28 88L31 72H26A12 12 0 0 1 14 60V28A12 12 0 0 1 26 16Z"
def bigpulse(color, w, h, y=None, sw=18, op=1):
    y = y if y is not None else h*0.62
    a=h*0.10
    d=f"M-20 {y} H{w*0.28} L{w*0.34} {y-a*0.9} L{w*0.40} {y} L{w*0.46} {y-a*1.8} L{w*0.52} {y} L{w*0.58} {y-a*0.7} L{w*0.64} {y} H{w+20}"
    return f'<svg style="position:absolute;inset:0" width="{w}" height="{h}" viewBox="0 0 {w} {h}"><path d="{d}" fill="none" stroke="{color}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" opacity="{op}"/></svg>'
CSS='''*{box-sizing:border-box}html,body{margin:0}body{font-family:'Poppins',sans-serif;-webkit-font-smoothing:antialiased}
.pg{position:relative;overflow:hidden}
.lg svg{display:block}
h1,h2,p{margin:0}
.eyebrow{font-weight:600;letter-spacing:.18em;text-transform:uppercase}
.pill{display:inline-block;border-radius:999px;font-weight:700}
.wa{font-weight:500;opacity:.85}
'''
def page(w,h,inner,bg):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}body{{width:{w}px;height:{h}px;background:{bg}}}.pg{{width:{w}px;height:{h}px}}</style></head><body><div class="pg">{inner}</div></body></html>'
pieces=[]
def add(folder,name,w,h,inner,bg):
    pieces.append((folder,name,w,h,page(w,h,inner,bg)))

WA="Integração via API Oficial do WhatsApp Business"
# ---- avatar 1080
ICON_BIG=ICON.replace('<svg ','<svg width="1080" height="1080" ',1)
add('redes-sociais','avatar-1080',1080,1080,f'<div style="width:1080px;height:1080px">{ICON_BIG}</div>',ORANGE)
# ---- capas
def cover(w,h,name,folder='redes-sociais',logo_scale=1.0):
    lw=int(w*0.26*logo_scale)
    inner=f'''{bigpulse(ORANGE,w,h,y=h*0.84,sw=int(h*0.045),op=.35)}
    <div style="position:absolute;left:{int(w*0.06)}px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:{int(w*0.03)}px">
      <div class="lg" style="width:{lw}px">{H_ESC}</div>
      <div style="border-left:3px solid {ORANGE};padding-left:{int(w*0.025)}px;color:{CREAM}">
        <h2 style="font-size:{int(h*0.13)}px;font-weight:700;line-height:1.1">Campanhas com pulso.</h2>
        <p class="wa" style="font-size:{int(h*0.06)}px;margin-top:{int(h*0.03)}px">{WA}</p>
      </div></div>'''
    add(folder,name,w,h,inner,PLUM)
cover(1584,396,'capa-linkedin-1584x396'); cover(1640,624,'capa-facebook-1640x624'); cover(1024,500,'banner-play-store-1024x500',logo_scale=0.9)
# ---- feed posts 1080
def post_launch():
    return f'''{bigpulse(ORANGE,1080,1080,y=830,sw=26,op=.3)}
    <div style="position:absolute;left:90px;top:100px;width:900px;color:{CREAM}">
      <p class="eyebrow" style="font-size:26px;color:{ORANGE}">Novo · DMS Tecnologia</p>
      <h1 style="font-size:112px;font-weight:700;line-height:1.02;margin-top:26px">Chegou o<br>Regemcast.</h1>
      <p style="font-size:38px;margin-top:34px;line-height:1.35;max-width:820px">Disparos em massa, campanhas agendadas e painel de controle — tudo no canal onde seus clientes já estão.</p>
    </div>
    <div style="position:absolute;left:90px;bottom:90px;display:flex;align-items:flex-end;justify-content:space-between;width:900px">
      <div class="lg" style="width:380px">{H_ESC}</div>
      <p class="wa" style="font-size:22px;color:{CREAM};text-align:right;max-width:400px">{WA}</p></div>'''
def post_offer():
    return f'''<div style="position:absolute;inset:0;background:{ORANGE}"></div>
    {bigpulse(PLUM,1080,1080,y=880,sw=26,op=.18)}
    <div style="position:absolute;left:90px;top:110px;width:900px;color:{PLUM}">
      <p class="eyebrow" style="font-size:26px">Lançamento na Play Store</p>
      <h1 style="font-size:190px;font-weight:700;line-height:.95;margin-top:30px">1 mês<br>grátis</h1>
      <p style="font-size:40px;margin-top:40px;line-height:1.3;max-width:760px;font-weight:500">Depois, assinatura mensal sem fidelidade. Cancele quando quiser.</p>
    </div>
    <div style="position:absolute;left:90px;bottom:90px;display:flex;align-items:center;gap:26px">
      <div class="lg" style="width:120px">{ICON}</div>
      <div style="color:{PLUM}"><p style="font-size:34px;font-weight:700">Regemcast</p><p class="wa" style="font-size:22px">{WA}</p></div></div>'''
def post_feature():
    items=[("Disparos em massa","listas segmentadas, modelos aprovados"),("Campanhas agendadas","data, hora e cadência sob controle"),("Painel de controle","métricas de entrega e resposta em tempo real")]
    li="".join(f'<div style="display:flex;gap:26px;align-items:flex-start"><div style="width:18px;height:18px;border-radius:50%;background:{ORANGE};margin-top:18px;flex:none"></div><div><p style="font-size:40px;font-weight:700;line-height:1.15">{a}</p><p style="font-size:26px;opacity:.8;margin-top:4px">{b}</p></div></div>' for a,b in items)
    return f'''{bigpulse(ORANGE,1080,1080,y=210,sw=22,op=.28)}
    <div style="position:absolute;left:90px;top:300px;width:900px;color:{CREAM}">
      <p class="eyebrow" style="font-size:26px;color:{ORANGE}">Canal oficial, sem gambiarra</p>
      <h1 style="font-size:72px;font-weight:700;line-height:1.08;margin-top:20px">Tudo pela API Oficial do WhatsApp Business.</h1>
      <div style="display:flex;flex-direction:column;gap:22px;margin-top:44px">{li}</div>
    </div>
    <div style="position:absolute;left:90px;bottom:60px;width:900px;display:flex;justify-content:space-between;align-items:flex-end">
      <div class="lg" style="width:300px">{H_ESC}</div><p style="font-size:24px;color:{CREAM};opacity:.8">regemcast.com.br</p></div>'''
add('redes-sociais','post-feed-01-lancamento-1080x1080',1080,1080,post_launch(),PLUM)
add('redes-sociais','post-feed-02-oferta-1080x1080',1080,1080,post_offer(),ORANGE)
add('redes-sociais','post-feed-03-api-oficial-1080x1080',1080,1080,post_feature(),PLUM)
# ---- stories 1080x1920
def story_launch():
    return f'''{bigpulse(ORANGE,1080,1920,y=1180,sw=28,op=.3)}
    <div style="position:absolute;left:90px;top:220px;width:900px;color:{CREAM}">
      <div class="lg" style="width:330px;margin-bottom:70px">{H_ESC}</div>
      <p class="eyebrow" style="font-size:28px;color:{ORANGE}">Novo · DMS Tecnologia</p>
      <h1 style="font-size:150px;font-weight:700;line-height:1;margin-top:26px">Chegou o<br>Regemcast.</h1>
      <p style="font-size:44px;margin-top:44px;line-height:1.35">Campanhas com pulso no canal onde seus clientes já estão.</p>
    </div>
    <div style="position:absolute;left:90px;bottom:200px;width:900px;color:{CREAM}">
      <span class="pill" style="background:{ORANGE};color:{PLUM};font-size:36px;padding:22px 44px">Baixe na Play Store</span>
      <p class="wa" style="font-size:26px;margin-top:40px">{WA}</p></div>'''
def story_offer():
    return f'''<div style="position:absolute;inset:0;background:{ORANGE}"></div>{bigpulse(PLUM,1080,1920,y=1380,sw=28,op=.16)}
    <div style="position:absolute;left:90px;top:260px;width:900px;color:{PLUM}">
      <p class="eyebrow" style="font-size:30px">Lançamento na Play Store</p>
      <h1 style="font-size:300px;font-weight:700;line-height:.9;margin-top:40px">1 mês<br>grátis</h1>
      <p style="font-size:48px;margin-top:60px;line-height:1.3;font-weight:500">Depois, assinatura mensal sem fidelidade.</p>
    </div>
    <div style="position:absolute;left:90px;bottom:200px;display:flex;align-items:center;gap:30px;color:{PLUM}">
      <div class="lg" style="width:150px">{ICON}</div><div><p style="font-size:44px;font-weight:700">Regemcast</p><p class="wa" style="font-size:26px">{WA}</p></div></div>'''
def story_feature():
    items=[("Disparos em massa"),("Campanhas agendadas"),("Painel de controle"),("Relatórios de entrega")]
    li="".join(f'<div style="display:flex;gap:28px;align-items:center"><div style="width:22px;height:22px;border-radius:50%;background:{ORANGE};flex:none"></div><p style="font-size:56px;font-weight:700">{a}</p></div>' for a in items)
    return f'''{bigpulse(ORANGE,1080,1920,y=330,sw=24,op=.28)}
    <div style="position:absolute;left:90px;top:560px;width:900px;color:{CREAM}">
      <p class="eyebrow" style="font-size:28px;color:{ORANGE}">Canal oficial, sem gambiarra</p>
      <h1 style="font-size:84px;font-weight:700;line-height:1.08;margin-top:20px">Tudo pela API Oficial do WhatsApp Business.</h1>
      <div style="display:flex;flex-direction:column;gap:38px;margin-top:80px">{li}</div>
    </div>
    <div style="position:absolute;left:90px;bottom:200px;width:900px"><div class="lg" style="width:420px">{H_ESC}</div><p style="font-size:28px;color:{CREAM};opacity:.8;margin-top:30px">regemcast.com.br</p></div>'''
add('redes-sociais','story-01-lancamento-1080x1920',1080,1920,story_launch(),PLUM)
add('redes-sociais','story-02-oferta-1080x1920',1080,1920,story_offer(),ORANGE)
add('redes-sociais','story-03-api-oficial-1080x1920',1080,1920,story_feature(),PLUM)
# ---- site: hero 1920x1080, OG 1200x630
hero=f'''{bigpulse(ORANGE,1920,1080,y=930,sw=30,op=.28)}
<div style="position:absolute;left:140px;top:150px;width:1000px;color:{CREAM}">
  <div class="lg" style="width:360px;margin-bottom:90px">{H_ESC}</div>
  <h1 style="font-size:104px;font-weight:700;line-height:1.02">Campanhas com pulso.</h1>
  <p style="font-size:36px;margin-top:36px;line-height:1.4;max-width:900px">Disparos, campanhas e automações pela API Oficial do WhatsApp Business. App Android com painel de controle.</p>
  <div style="display:flex;gap:24px;margin-top:60px;align-items:center">
    <span class="pill" style="background:{ORANGE};color:{PLUM};font-size:30px;padding:22px 44px">Começar 1 mês grátis</span>
    <span style="font-size:26px;opacity:.75">Depois, assinatura mensal</span></div>
</div>
<div style="position:absolute;right:160px;top:50%;transform:translateY(-50%);width:420px">{ICON}</div>'''
add('site','hero-1920x1080',1920,1080,hero,PLUM)
og=f'''{bigpulse(ORANGE,1200,630,y=540,sw=22,op=.3)}
<div style="position:absolute;left:80px;top:90px;width:760px;color:{CREAM}">
  <div class="lg" style="width:330px;margin-bottom:56px">{H_ESC}</div>
  <h1 style="font-size:66px;font-weight:700;line-height:1.05">Campanhas com pulso.</h1>
  <p class="wa" style="font-size:26px;margin-top:22px">{WA}</p></div>
<div style="position:absolute;right:90px;top:50%;transform:translateY(-50%);width:260px">{ICON}</div>'''
add('site','og-image-1200x630',1200,630,og,PLUM)
# render
jobs=[]
for folder,name,w,h,html in pieces:
    os.makedirs(f'../{folder}/png',exist_ok=True); os.makedirs(f'../{folder}/jpeg',exist_ok=True)
    hp=f'/tmp/{name}.html'; open(hp,'w').write(html)
    jobs.append({"html":hp,"width":w,"height":h,"out":f"../{folder}/png/{name}.png","bg":"x"})
json.dump(jobs,open('/tmp/jobs_social.json','w'))
subprocess.run(['node','render.js','/tmp/jobs_social.json'],check=True,env={'NODE_PATH':'/home/claude/.npm-global/lib/node_modules','PATH':'/usr/bin:/bin:/usr/local/bin'})
for folder,name,w,h,html in pieces:
    Image.open(f"../{folder}/png/{name}.png").convert('RGB').save(f"../{folder}/jpeg/{name}.jpg",quality=90,subsampling=0)
# circular avatar
im=Image.open('../redes-sociais/png/avatar-1080.png').convert('RGBA'); m=Image.new('L',im.size,0); ImageDraw.Draw(m).ellipse((0,0,1079,1079),fill=255); im.putalpha(m); im.save('../redes-sociais/png/avatar-1080-circular.png')
print('social ok',len(pieces))
