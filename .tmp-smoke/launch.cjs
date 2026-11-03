// Launches the app like a user would, attaching a debugger only after the page should be up.
const {chromium}=require(process.env.REPO+'/node_modules/playwright');
const {spawn,execSync}=require('child_process'),http=require('http');
const [,,bin,udd,label,watcher,settleS]=process.argv;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const health=()=>new Promise(r=>{const q=http.get('http://127.0.0.1:3737/healthz',x=>{x.resume();r(x.statusCode===200)});q.on('error',()=>r(false));q.setTimeout(300,()=>{q.destroy();r(false)})});
(async()=>{
 const w=spawn(watcher);let winAt=null;w.stdout.on('data',d=>{winAt=+String(d).trim()});
 await sleep(100);
 const t0=Date.now();const out={label};
 const a=spawn(bin,['--user-data-dir='+udd,'--remote-debugging-port=9333'],{stdio:'ignore'});let exited=null;a.on('exit',c=>{exited=c});
 let hAt=null;while(hAt===null&&Date.now()-t0<90000&&exited===null){if(await health())hAt=Date.now()-t0;else await sleep(20)}
 out.health=hAt;await sleep((+settleS)*1000);
 out.window=winAt?winAt-t0:null;
 try{
  const b=await chromium.connectOverCDP('http://127.0.0.1:9333',{timeout:30000});
  const pg=b.contexts().flatMap(c=>c.pages())[0];out.url=pg?pg.url():null;
  if(pg){const m=await pg.evaluate(async()=>{const n=performance.getEntriesByType('resource');return{origin:performance.timeOrigin,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,root:document.getElementById('root')?.childElementCount,res:n.length,sw:(await navigator.serviceWorker.getRegistrations()).length}});
   out.fcp=m.fcp==null?null:Math.round(m.origin-t0+m.fcp);out.root=m.root;out.res=m.res;out.sw=m.sw;}
  await b.close();
 }catch(e){out.cdpError=String(e.message).slice(0,160)}
 out.exited=exited;console.log('RESULT '+JSON.stringify(out));
 a.kill();try{w.kill()}catch{};await sleep(1500);try{a.kill('SIGKILL')}catch{};
 process.exit(0);
})();
