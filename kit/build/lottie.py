import json
K=6.627  # kappa*12
def col(h): h=h.lstrip('#'); return [int(h[i:i+2],16)/255 for i in (0,2,4)]+[1]
def st(v): return {"a":0,"k":v}
def kf(frames, hold=False):
    out=[]
    for i,(t,v) in enumerate(frames):
        k={"t":t,"s":v}
        if i<len(frames)-1:
            k.update({"i":{"x":[0.5],"y":[0.5]},"o":{"x":[0.5],"y":[0.5]}})
            if hold: k["h"]=1
        out.append(k)
    return {"a":1,"k":out}
def tr(p=[0,0],a=[0,0],s=[100,100],o=100,r=0):
    return {"ty":"tr","p":st(p),"a":st(a),"s":st(s) if not isinstance(s,dict) else s,"r":st(r),"o":st(o) if not isinstance(o,dict) else o,"sk":st(0),"sa":st(0)}
def path(v,i,o,closed): return {"ty":"sh","ks":st({"i":i,"o":o,"v":v,"c":closed})}
def fill(c): return {"ty":"fl","c":st(col(c)),"o":st(100),"r":1}
def stroke(c,w,op=100): return {"ty":"st","c":st(col(c)),"o":st(op),"w":st(w),"lc":2,"lj":2}
BV=[[26,16],[74,16],[86,28],[86,60],[74,72],[44,72],[28,88],[31,72],[26,72],[14,60],[14,28]]
BI=[[-K,0],[0,0],[0,-K],[0,0],[K,0],[0,0],[0,0],[0,0],[0,0],[0,K],[0,0]]
BO=[[0,0],[K,0],[0,0],[0,K],[0,0],[0,0],[0,0],[0,0],[-K,0],[0,0],[0,-K]]
PV=[[24,48],[32,48],[38,38],[44,48],[50,30],[56,48],[62,40],[68,48],[76,48]]
Z=[[0,0]]*9
def group(items,name,t=None): return {"ty":"gr","it":items+[t or tr()],"nm":name}
def layer(shapes,name,op,ind=1):
    return {"ddd":0,"ind":ind,"ty":4,"nm":name,"sr":1,"ks":{"o":st(100),"r":st(0),"p":st([0,0,0]),"a":st([0,0,0]),"s":st([100,100,100])},"ao":0,"shapes":shapes,"ip":0,"op":op,"st":0,"bm":0}
def anim(w,h,op,layers,name): return {"v":"5.7.4","fr":30,"ip":0,"op":op,"w":w,"h":h,"nm":name,"ddd":0,"assets":[],"layers":layers}

# 02 loader: 400x400, 48 frames
OP=48
trim={"ty":"tm","s":kf([(0,[0]),(12,[0]),(48,[100])]),"e":kf([(0,[0]),(36,[100]),(48,[100])]),"o":st(0),"m":1,"nm":"trim"}
root=group([
  group([path(BV,BI,BO,True),fill("#2B1B3D")],"bubble"),
  group([path(PV,Z,Z,False),stroke("#FFFFFF",6,22)],"track"),
  group([path(PV,Z,Z,False),trim,stroke("#FFFFFF",6)],"run"),
],"scale",tr(s=[400,400]))
json.dump(anim(400,400,OP,[layer([root],"loader",OP)],"Regemcast loader"),open('../animacoes/02-loader-disparo/02-loader-disparo.json','w'))

# 05 live: 240x240, 45 frames
OP=45
def ripple(name,shift):
    # size 52->96 over 45 frames; opacity 90->0
    if shift==0:
        s=kf([(0,[52,52]),(45,[96,96])]); o=kf([(0,[90]),(45,[0])])
    else:
        s={"a":1,"k":[{"t":0,"s":[74,74],"i":{"x":[0.5],"y":[0.5]},"o":{"x":[0.5],"y":[0.5]}},{"t":22,"s":[96,96],"h":1},{"t":23,"s":[52,52],"i":{"x":[0.5],"y":[0.5]},"o":{"x":[0.5],"y":[0.5]}},{"t":45,"s":[74,74]}]}
        o={"a":1,"k":[{"t":0,"s":[45],"i":{"x":[0.5],"y":[0.5]},"o":{"x":[0.5],"y":[0.5]}},{"t":22,"s":[0],"h":1},{"t":23,"s":[90],"i":{"x":[0.5],"y":[0.5]},"o":{"x":[0.5],"y":[0.5]}},{"t":45,"s":[45]}]}
    return group([{"ty":"el","p":st([50,50]),"s":s,"d":1},stroke("#A3E635",2)],name,tr(o=o))
IBV=[[28,22],[72,22],[82,32],[82,58],[72,68],[46,68],[32,82],[34,68],[28,68],[18,58],[18,32]]
K2=5.523
IBI=[[-K2,0],[0,0],[0,-K2],[0,0],[K2,0],[0,0],[0,0],[0,0],[0,0],[0,K2],[0,0]]
IBO=[[0,0],[K2,0],[0,0],[0,K2],[0,0],[0,0],[0,0],[0,0],[-K2,0],[0,0],[0,-K2]]
IPV=[[28,48],[34,48],[39,39],[44,48],[50,32],[56,48],[61,41],[66,48],[72,48]]
beat=group([path(IBV,IBI,IBO,True),fill("#2B1B3D")],"bubble")
pulse=group([path(IPV,Z,Z,False),stroke("#FFFFFF",6)],"pulse")
beatg=group([beat,pulse],"beat",tr(p=[50,52],a=[50,52],s=kf([(0,[60,60]),(3,[66,66]),(6,[60,60]),(45,[60,60])])))
root=group([ripple("ripple1",0),ripple("ripple2",1),beatg],"scale",tr(s=[240,240]))
json.dump(anim(240,240,OP,[layer([root],"live",OP)],"Regemcast ao vivo"),open('../animacoes/05-indicador-ao-vivo/05-indicador-ao-vivo.json','w'))
print('lottie ok')
