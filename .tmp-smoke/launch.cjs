const {_electron}=require(process.env.REPO+'/node_modules/playwright');
const fs=require('fs'),path=require('path'),http=require('http');
const [,,app,seed,udd,label,routesFlag]=process.argv;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const health=()=>new Promise(r=>{const q=http.get('http://127.0.0.1:3737/healthz',x=>{x.resume();r(x.statusCode===200)});q.on('error',()=>r(false));q.setTimeout(200,()=>{q.destroy();r(false)})});
(async()=>{
 fs.mkdirSync(udd,{recursive:true});
 const t0=Date.now();const out={label};
 let healthAt=null;(async()=>{while(healthAt===null){if(await health())healthAt=Date.now()-t0;await sleep(15)}})();
 const e=await _electron.launch({executablePath:app,args:['--user-data-dir='+udd],timeout:120000});
 const errors=[];let visibleAt=null,stop=false;
 (async()=>{while(!stop&&visibleAt===null){try{if(await e.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible())))visibleAt=Date.now()-t0}catch{}await sleep(15)}})();
 e.process().on('exit',(c,s)=>console.error('electron exit',c,s,Date.now()-t0));e.process().stderr.on('data',d=>process.env.V&&console.error(String(d)));e.process().stdout.on('data',d=>process.env.V&&console.error(String(d)));const p=await e.firstWindow();p.on('close',()=>console.error('page close',Date.now()-t0));p.on('crash',()=>console.error('page crash'));p.on('framenavigated',f=>console.error('nav',f.url(),Date.now()-t0));out.windowCreated=Date.now()-t0;
 p.on('console',m=>{if(m.type()==='error')errors.push(m.text())});p.on('pageerror',x=>errors.push(String(x)));
 await p.waitForLoadState('load');await p.waitForLoadState('networkidle');
 while(visibleAt===null)await sleep(15);stop=true;
 const m=await p.evaluate(()=>new Promise(res=>{
   const nav=performance.getEntriesByType('navigation')[0];const r=performance.getEntriesByType('resource');
   const fcp=performance.getEntriesByName('first-contentful-paint')[0]?.startTime;const d=r.find(x=>x.name.endsWith('/api/data'));
   let lcp=0;new PerformanceObserver(l=>{for(const x of l.getEntries())lcp=x.startTime}).observe({type:'largest-contentful-paint',buffered:true});
   setTimeout(async()=>res({origin:performance.timeOrigin,fcp,lcp,dataEnd:d?.responseEnd,dom:nav.domContentLoadedEventEnd,res:r.length,kb:Math.round(r.reduce((a,x)=>a+x.transferSize,0)/1024),cached:r.filter(x=>x.transferSize===0).length,
     sw:(await navigator.serviceWorker.getRegistrations()).length,controller:!!navigator.serviceWorker.controller,caches:(await Promise.all((await caches.keys()).map(async k=>(await (await caches.open(k)).keys()).length))).reduce((a,b)=>a+b,0)}),300);
 }));
 const off=m.origin-t0;Object.assign(out,{health:healthAt,visible:visibleAt,navStart:Math.round(off),fcp:Math.round(off+m.fcp),lcp:Math.round(off+m.lcp),dataEnd:Math.round(off+m.dataEnd),res:m.res,kb:m.kb,cached0:m.cached,sw:m.sw,swControl:m.controller,cacheEntries:m.caches,errors:errors.length});
 if(routesFlag==='routes'){
   const T={};await sleep(1500);
   for(const r of ['/budget','/assets','/salary','/forecast','/pension','/year-review','/settings','/']){
     const a=p.locator(`a[href="${r}"]:visible`).first();if(!await a.count())continue;
     const s=await p.evaluate(()=>performance.now());await a.click();
     T[r]=Math.round(await p.evaluate(s=>new Promise(res=>{requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(()=>res(performance.now()-s),0)))}),s));await sleep(300);
   }
   out.tabs=T;
 }
 console.log(JSON.stringify(out));await e.close();
})().catch(x=>{console.error(x);process.exit(1)});
