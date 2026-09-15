import json, subprocess, os
from PIL import Image
ORANGE="#A3E635"; PLUM="#2B1B3D"; WHITE="#FFFFFF"
IB="M28 22H72A10 10 0 0 1 82 32V58A10 10 0 0 1 72 68H46L32 82L34 68H28A10 10 0 0 1 18 58V32A10 10 0 0 1 28 22Z"
IP="M28 48H34L39 39L44 48L50 32L56 48L61 41L66 48H72"
def svg(w,h,body): return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">{body}</svg>'
def pulse(stroke,sw=6,tr=""): return f'<path d="{IP}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" {tr}/>'
def bubble(fill,tr=""): return f'<path d="{IB}" fill="{fill}" {tr}/>'

os.makedirs('../icones/svg',exist_ok=True); os.makedirs('../icones/android',exist_ok=True); os.makedirs('../icones/web',exist_ok=True); os.makedirs('../icones/play-store',exist_ok=True)
# 1. app icon (full bleed)
app=svg(100,100,f'<rect width="100" height="100" fill="{ORANGE}"/>'+bubble(PLUM)+pulse(WHITE))
open('../icones/svg/icone-app-quadrado.svg','w').write(app)
# small favicon variant (thicker pulse)
small=svg(100,100,f'<rect width="100" height="100" rx="18" fill="{ORANGE}"/>'+bubble(PLUM)+pulse(WHITE,8))
open('../icones/svg/favicon.svg','w').write(svg(100,100,f'<rect width="100" height="100" rx="18" fill="{ORANGE}"/>'+bubble(PLUM)+pulse(WHITE,7)))
# rounded (legacy launcher / generic)
rounded=svg(100,100,f'<rect width="100" height="100" rx="22" fill="{ORANGE}"/>'+bubble(PLUM)+pulse(WHITE))
open('../icones/svg/icone-app-arredondado.svg','w').write(rounded)
# adaptive foreground: 108 canvas, art in center ~62
fg=svg(108,108,f'<g transform="translate(23 23) scale(0.62)">'+bubble(PLUM)+pulse(WHITE)+'</g>')
bg=svg(108,108,f'<rect width="108" height="108" fill="{ORANGE}"/>')
open('../icones/svg/adaptive-foreground.svg','w').write(fg); open('../icones/svg/adaptive-background.svg','w').write(bg)
# notification: white silhouette, pulse knocked out
notif=svg(100,100,f'<defs><mask id="m"><rect width="100" height="100" fill="#fff"/>{pulse("#000",7)}</mask></defs><g transform="translate(0 -4)"><path d="{IB}" fill="#FFFFFF" mask="url(#m)"/></g>')
open('../icones/svg/notificacao-mono.svg','w').write(notif)

jobs=[]
def J(s,w,out,bg=None,h=None):
    j={"svg":s,"width":w,"out":out}
    if bg: j["bg"]=bg
    if h: j["height"]=h
    jobs.append(j)
J('../icones/svg/icone-app-quadrado.svg',512,'../icones/play-store/icone-play-store-512.png',ORANGE)
J('../icones/svg/icone-app-quadrado.svg',1024,'../icones/play-store/icone-1024.png',ORANGE)
dens={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
for d,f in dens.items():
    os.makedirs(f'../icones/android/mipmap-{d}',exist_ok=True); os.makedirs(f'../icones/android/drawable-{d}',exist_ok=True)
    J('../icones/svg/adaptive-foreground.svg',int(108*f),f'../icones/android/mipmap-{d}/ic_launcher_foreground.png')
    J('../icones/svg/adaptive-background.svg',int(108*f),f'../icones/android/mipmap-{d}/ic_launcher_background.png',ORANGE)
    J('../icones/svg/icone-app-arredondado.svg',int(48*f),f'../icones/android/mipmap-{d}/ic_launcher.png')
    J('../icones/svg/notificacao-mono.svg',int(24*f),f'../icones/android/drawable-{d}/ic_stat_regemcast.png')
for s in (16,32,48,64,96,180,192,256,512):
    J('../icones/svg/favicon.svg',s,f'../icones/web/favicon-{s}.png')
json.dump(jobs,open('/tmp/jobs_icons.json','w'))
subprocess.run(['node','render.js','/tmp/jobs_icons.json'],check=True,env={'NODE_PATH':'/home/claude/.npm-global/lib/node_modules','PATH':'/usr/bin:/bin:/usr/local/bin'})
# ico + apple touch
ims=[Image.open(f'../icones/web/favicon-{s}.png') for s in (16,32,48)]
ims[0].save('../icones/web/favicon.ico',sizes=[(16,16),(32,32),(48,48)],append_images=ims[1:])
Image.open('../icones/web/favicon-180.png').convert('RGB').save('../icones/web/apple-touch-icon-180.png')
# Android vector drawables
os.makedirs('../icones/android/drawable',exist_ok=True); os.makedirs('../icones/android/mipmap-anydpi-v26',exist_ok=True); os.makedirs('../icones/android/values',exist_ok=True)
open('../icones/android/drawable/ic_launcher_foreground.xml','w').write(f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
  <group android:translateX="23" android:translateY="23" android:scaleX="0.62" android:scaleY="0.62">
    <path android:fillColor="{PLUM}" android:pathData="{IB}"/>
    <path android:strokeColor="{WHITE}" android:strokeWidth="6" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="{IP}"/>
  </group>
</vector>
''')
open('../icones/android/drawable/ic_stat_regemcast.xml','w').write(f'''<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="100" android:viewportHeight="100">
  <group android:translateY="-4">
    <path android:fillColor="#FFFFFFFF" android:pathData="{IB}"/>
    <path android:strokeColor="#FF000000" android:strokeWidth="7" android:strokeLineCap="round" android:strokeLineJoin="round" android:pathData="{IP}"/>
  </group>
</vector>
<!-- Observação: use os PNGs em drawable-*dpi para o ícone de status (o pulso já vem recortado/transparente). -->
''')
open('../icones/android/values/ic_launcher_background.xml','w').write(f'''<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">{ORANGE}</color></resources>
''')
open('../icones/android/mipmap-anydpi-v26/ic_launcher.xml','w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
    <monochrome android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
''')
open('../icones/android/mipmap-anydpi-v26/ic_launcher_round.xml','w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@drawable/ic_launcher_foreground"/>
</adaptive-icon>
''')
print('icons ok', len(jobs))
