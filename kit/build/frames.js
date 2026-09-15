// node frames.js scene.html W H DUR FPS outdir
const { chromium } = require('playwright'); const fs=require('fs');
(async()=>{
  const [,, html, W, H, DUR, FPS, out] = process.argv;
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
  const p=await b.newPage({viewport:{width:+W,height:+H},deviceScaleFactor:1});
  await p.setContent(fs.readFileSync(html,'utf8'),{waitUntil:'load'}); await p.evaluate(()=>document.fonts.ready);
  fs.mkdirSync(out,{recursive:true});
  const n=Math.round(+DUR*+FPS);
  for(let i=0;i<n;i++){ await p.evaluate(t=>window.setT(t), i/+FPS); await p.screenshot({path:`${out}/${String(i).padStart(4,'0')}.png`,omitBackground:true}); }
  await b.close(); console.log('frames',n);
})().catch(e=>{console.error(e);process.exit(1)});
