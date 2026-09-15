// usage: node render.js jobs.json   ; each job: {svg|html, width, height?, out, bg?, pdf?}
const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
(async()=>{
  const jobs=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const ctx=await b.newContext({deviceScaleFactor:1});
  const p=await ctx.newPage();
  for(const j of jobs){
    let html;
    if(j.svg){
      const svg=fs.readFileSync(j.svg,'utf8');
      const m=svg.match(/viewBox="([\d.\- ]+)"/); const vb=m[1].split(' ').map(Number);
      const h=j.height||Math.round(j.width*vb[3]/vb[2]);
      html=`<!doctype html><html><head><style>html,body{margin:0;padding:0;background:${j.bg||'transparent'}}svg{display:block;width:${j.width}px;height:${h}px}</style></head><body>${svg}</body></html>`;
      await p.setViewportSize({width:j.width,height:h});
    } else {
      html=fs.readFileSync(j.html,'utf8');
      await p.setViewportSize({width:j.width,height:j.height});
    }
    await p.setContent(html,{waitUntil:'load'}); await p.evaluate(()=>document.fonts.ready);
    if(j.pdf){
      const vp=p.viewportSize();
      await p.pdf({path:j.pdf,width:vp.width+'px',height:vp.height+'px',printBackground:!!j.bg,pageRanges:'1',margin:{top:0,right:0,bottom:0,left:0}});
    }
    if(j.out){ await p.screenshot({path:j.out,omitBackground:!j.bg,fullPage:false}); }
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
