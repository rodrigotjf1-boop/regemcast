import json, subprocess, os, shutil
M=json.load(open('masters.json'))
H=M['regemcast-horizontal-cor-escuro']; WM=H['shapes'][2]['d']; BY=H['shapes'][3]['d']; HW=H['viewBox'][2]
V=M['regemcast-vertical-cor-escuro']; VWM=V['shapes'][2]['d']; VBY=V['shapes'][3]['d']; VW=V['viewBox'][2]; VH=V['viewBox'][3]
ORANGE="#A3E635"; PLUM="#2B1B3D"; WHITE="#FFFFFF"
IB="M28 22H72A10 10 0 0 1 82 32V58A10 10 0 0 1 72 68H46L32 82L34 68H28A10 10 0 0 1 18 58V32A10 10 0 0 1 28 22Z"
IP="M28 48H34L39 39L44 48L50 32L56 48L61 41L66 48H72"
SB="M26 16H74A12 12 0 0 1 86 28V60A12 12 0 0 1 74 72H44L28 88L31 72H26A12 12 0 0 1 14 60V28A12 12 0 0 1 26 16Z"
SP="M24 48H32L38 38L44 48L50 30L56 48L62 40L68 48H76"
EASE='''
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const seg=(t,a,b)=>clamp((t-a)/(b-a),0,1);
const outBack=x=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(x-1,3)+c1*Math.pow(x-1,2)};
const outCubic=x=>1-Math.pow(1-x,3);
const inOut=x=>x<0.5?2*x*x:1-Math.pow(-2*x+2,2)/2;
const $=id=>document.getElementById(id);
'''
def page(w,h,body,script,bg='transparent'):
    return f'<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;background:{bg};width:{w}px;height:{h}px;overflow:hidden}}svg{{display:block}}</style></head><body>{body}<script>{EASE}{script}</script></body></html>'

scenes={}
# 1 SPLASH 1080x1920
body=f'''<svg width="1080" height="1920" viewBox="0 0 1080 1920">
<rect width="1080" height="1920" fill="{ORANGE}"/>
<g id="sym" transform="translate(540 820)"><g transform="translate(-50 -50) scale(1)"><path d="{SB}" fill="{PLUM}" transform="scale(4.2) translate(-38 -38)"/></g></g>
<g id="pulse" transform="translate(540 820) scale(4.2) translate(-50 -50)"><path d="{SP}" pathLength="1" fill="none" stroke="{WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 1" stroke-dashoffset="1"/></g>
<g id="wm" opacity="0"><g transform="translate(540 1190) scale(4.6) translate({-(HW-100)/2} -55.2) translate(-100 0)"><path d="{WM}" fill="{PLUM}" stroke="{PLUM}" stroke-width="1.04" stroke-linejoin="round"/><path d="{BY}" fill="{PLUM}"/></g></g>
</svg>'''
# simpler transform for symbol: we want symbol 100-box scaled 4.2 centered at (540,820)
body=body.replace(f'<g id="sym" transform="translate(540 820)"><g transform="translate(-50 -50) scale(1)"><path d="{SB}" fill="{PLUM}" transform="scale(4.2) translate(-38 -38)"/></g></g>',
 f'<g id="sym" transform="translate(540 820) scale(4.2) translate(-50 -50)"><path d="{SB}" fill="{PLUM}"/></g>')
script='''
window.setT=t=>{
  const s=outBack(seg(t,0.1,0.75)); $('sym').setAttribute('transform',`translate(540 820) scale(${4.2*s}) translate(-50 -50)`);
  const d=outCubic(seg(t,0.65,1.35)); $('pulse').firstElementChild.setAttribute('stroke-dashoffset',1-d);
  const w=outCubic(seg(t,1.25,1.85)); $('wm').setAttribute('opacity',w); $('wm').setAttribute('transform',`translate(0 ${(1-w)*40})`);
};'''
scenes['01-abertura-app']=dict(html=page(1080,1920,body,script,ORANGE),w=1080,h=1920,dur=2.6,bg=ORANGE,loop=False,gifw=540)

# 2 LOADER 400x400 transparent, loop 1.6s
body=f'''<svg width="400" height="400" viewBox="0 0 100 100">
<path d="{SB}" fill="{PLUM}"/>
<path d="{SP}" fill="none" stroke="{WHITE}" stroke-opacity="0.22" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
<path id="run" d="{SP}" pathLength="1" fill="none" stroke="{WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.35 1" stroke-dashoffset="0.35"/>
</svg>'''
script='''window.setT=t=>{const p=(t/1.6)%1; $('run').setAttribute('stroke-dashoffset',0.35-1.35*p);};'''
scenes['02-loader-disparo']=dict(html=page(400,400,body,script),w=400,h=400,dur=1.6,bg=None,loop=True,gifw=240)

# 3 LOGO REVEAL 1920x1080 plum bg, 3.2s
sc=4.0; lw=HW*sc; lx=(1920-lw)/2; ly=(1080-100*sc)/2
body=f'''<svg width="1920" height="1080" viewBox="0 0 1920 1080">
<rect width="1920" height="1080" fill="{PLUM}"/>
<path id="line" d="M-100 540H460L560 420L660 540L760 300L860 540L960 400L1060 540H2020" pathLength="1" fill="none" stroke="{ORANGE}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.25 1" stroke-dashoffset="0.25"/>
<g id="lock" transform="translate({lx} {ly}) scale({sc})">
  <g id="sym" transform="translate(50 50) scale(0) translate(-50 -50)"><path d="{SB}" fill="{ORANGE}"/></g>
  <path id="pulse" d="{SP}" pathLength="1" fill="none" stroke="{PLUM}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 1" stroke-dashoffset="1"/>
  <defs><clipPath id="cp"><rect id="cr" x="96" y="0" width="0" height="100"/></clipPath></defs>
  <g clip-path="url(#cp)"><path d="{WM}" fill="{WHITE}" stroke="{WHITE}" stroke-width="1.04" stroke-linejoin="round"/></g>
  <path id="by" d="{BY}" fill="{WHITE}" opacity="0"/>
</g></svg>'''
script=f'''window.setT=t=>{{
  const a=inOut(seg(t,0,1.0)); $('line').setAttribute('stroke-dashoffset',0.25-1.25*a);
  const s=outBack(seg(t,0.75,1.35)); $('sym').setAttribute('transform',`translate(50 50) scale(${{s}}) translate(-50 -50)`);
  const d=outCubic(seg(t,1.2,1.8)); $('pulse').setAttribute('stroke-dashoffset',1-d);
  const w=outCubic(seg(t,1.6,2.35)); $('cr').setAttribute('width',w*({HW}-96));
  const b=seg(t,2.2,2.6); $('by').setAttribute('opacity',b);
}};'''
scenes['03-logo-reveal-video']=dict(html=page(1920,1080,body,script,PLUM),w=1920,h=1080,dur=3.4,bg=PLUM,loop=False,gifw=640)

# 4 STICKER 512x512 transparent loop 1.2s
body=f'''<svg width="512" height="512" viewBox="0 0 100 100">
<g id="hop"><g id="sq" transform="translate(50 88) scale(1 1) translate(-50 -88)"><path d="{SB}" fill="{ORANGE}"/><g id="pp" transform="translate(50 44) scale(1) translate(-50 -44)"><path d="{SP}" fill="none" stroke="{WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g></g></g>
</svg>'''
script='''window.setT=t=>{const p=(t/1.2)%1; const s=(Math.cos(2*Math.PI*p)+1)/2; const y=-14*Math.sin(Math.PI*p);
 $('hop').setAttribute('transform',`translate(0 ${y})`);
 $('sq').setAttribute('transform',`translate(50 88) scale(${1+0.12*s} ${1-0.12*s}) translate(-50 -88)`);
 $('pp').setAttribute('transform',`translate(50 44) scale(${1+0.10*(1-s)}) translate(-50 -44)`);};'''
scenes['04-sticker-redes']=dict(html=page(512,512,body,script),w=512,h=512,dur=1.2,bg=None,loop=True,gifw=320)

# 5 LIVE 240x240 transparent loop 1.5s
body=f'''<svg width="240" height="240" viewBox="0 0 100 100">
<circle id="r1" cx="50" cy="50" r="30" fill="none" stroke="{ORANGE}" stroke-width="2" opacity="0"/>
<circle id="r2" cx="50" cy="50" r="30" fill="none" stroke="{ORANGE}" stroke-width="2" opacity="0"/>
<g id="beat" transform="translate(50 52) scale(0.6) translate(-50 -52)"><path d="{IB}" fill="{PLUM}"/><path d="{IP}" fill="none" stroke="{WHITE}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>'''
script='''window.setT=t=>{const p=(t/1.5)%1;
 const rip=(el,q)=>{el.setAttribute('r',26+q*22); el.setAttribute('opacity',(1-q)*0.9)};
 rip($('r1'),p); rip($('r2'),(p+0.5)%1);
 const b=p<0.18?Math.sin(Math.PI*p/0.18):0; $('beat').setAttribute('transform',`translate(50 52) scale(${0.6+0.06*b}) translate(-50 -52)`);};'''
scenes['05-indicador-ao-vivo']=dict(html=page(240,240,body,script),w=240,h=240,dur=1.5,bg=None,loop=True,gifw=240)

ENV={'NODE_PATH':'/home/claude/.npm-global/lib/node_modules','PATH':'/usr/bin:/bin:/usr/local/bin'}
FPS=30
for name,s in scenes.items():
    out=f'../animacoes/{name}'; os.makedirs(out,exist_ok=True)
    open(f'{out}/{name}.html','w').write(s['html'])
    fr=f'/tmp/frames/{name}'; shutil.rmtree(fr,ignore_errors=True)
    subprocess.run(['node','frames.js',f'{out}/{name}.html',str(s['w']),str(s['h']),str(s['dur']),str(FPS),fr],check=True,env=ENV)
    inp=['-framerate',str(FPS),'-i',f'{fr}/%04d.png']
    bg=s['bg'] or PLUM
    # MP4 (opaque)
    subprocess.run(['ffmpeg','-y','-loglevel','error']+inp+['-filter_complex',f"color=c={bg.replace('#','0x')}:s={s['w']}x{s['h']}:r={FPS}[bg];[bg][0:v]overlay=shortest=1:format=auto,format=yuv420p",'-c:v','libx264','-crf','18','-preset','slow','-movflags','+faststart',f'{out}/{name}.mp4'],check=True)
    # WebM (alpha when transparent)
    pix='yuva420p' if s['bg'] is None else 'yuv420p'
    subprocess.run(['ffmpeg','-y','-loglevel','error']+inp+['-c:v','libvpx-vp9','-pix_fmt',pix,'-b:v','0','-crf','28',f'{out}/{name}.webm'],check=True)
    # GIF
    gw=s['gifw']; loop='0' if s['loop'] else '-1'
    if s['bg'] is None:
        flt=f"scale={gw}:-1:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128:dither=bayer:bayer_scale=5"
    else:
        flt=f"scale={gw}:-1:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=bayer:bayer_scale=5"
    subprocess.run(['ffmpeg','-y','-loglevel','error']+inp+['-filter_complex',flt,'-loop',loop,f'{out}/{name}.gif'],check=True)
    print(name,'ok')
