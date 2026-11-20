/* Isolated Chromium extension tests. No credentials, X traffic, or real account changes. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {html,article,rows}=require('./fixture.cjs');
const out=path.resolve(__dirname,'..'),extension=path.join(out,'extension'),work=path.resolve(process.env.REPLY_TEST_WORK||path.join(os.tmpdir(),'reply-sieve-qa'));
fs.mkdirSync(work,{recursive:true});fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
require(path.join(extension,'model-data.js'));const scorer=require(path.join(extension,'scorer.js'));
const quantile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.min(xs.length-1,Math.floor(xs.length*p))]??null;
const summarize=xs=>({n:xs.length,p50:quantile(xs,.5),p95:quantile(xs,.95),max:xs.length?Math.max(...xs):null});
const errors=[],checks=[],remote=[],result={environment:{node:process.version,platform:process.platform,cpu:os.cpus()[0].model,logicalCPUs:os.cpus().length},checks,errors};
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name)}
async function launch(enabled=true){
 return chromium.launchPersistentContext(fs.mkdtempSync(path.join(work,'profile-')),{
  executablePath:process.env.CHROMIUM_EXECUTABLE||undefined,channel:'chromium',headless:true,viewport:{width:1280,height:900},locale:'zh-CN',colorScheme:'light',
  args:enabled?['--disable-extensions-except='+extension,'--load-extension='+extension]:[],
 });
}
async function metric(worker,tabId){return worker.evaluate(id=>chrome.tabs.sendMessage(id,{type:'metrics'}),tabId)}
const observeStartup=()=>{window.__rsQALongTasks=[];new PerformanceObserver(list=>list.getEntries().forEach(e=>window.__rsQALongTasks.push({startMs:e.startTime,durationMs:e.duration}))).observe({type:'longtask',buffered:true})};
async function scroll(page){
 const data=await page.evaluate(async()=>{
  const frames=[],longTasks=[];let last=performance.now();const observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>longTasks.push(e.duration)));observer.observe({type:'longtask',buffered:false});
  for(let i=0;i<180;i++)await new Promise(resolve=>requestAnimationFrame(now=>{frames.push(now-last);last=now;window.scrollBy(0,100);resolve()}));observer.disconnect();return {frames,longTasks};
 });
 return {frameMs:summarize(data.frames),longTasks:data.longTasks};
}
(async()=>{
 const context=await launch();
 try{
  result.environment.chromium=context.browser()?.version()||'persistent Chromium';
  await context.addInitScript(observeStartup);
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
  await context.route('https://x.com/**',route=>{
   const url=new URL(route.request().url());
   if(url.pathname.startsWith('/i/api/graphql/fixture/'))return route.fulfill({contentType:'application/json',body:JSON.stringify({data:{entries:JSON.parse(url.searchParams.get('pairs')||'[]').map(([id,parent])=>({tweet_results:{result:{rest_id:id,legacy:{in_reply_to_status_id_str:parent,full_text:'body stays in page response only'}}}}))}})});
   let body=html(route.request().url().includes('loadtest')?600:0);
   if(route.request().url().includes('root-metadata'))body=body.replace(article(rows[1]),article({...rows[1],missing:true,quote:true}).replace('data-testid="User-Name"','data-testid="pending-name"'));
   if(url.searchParams.has('parents-early'))body=body.replace('</head>','<script>fetch("/i/api/graphql/fixture/TweetDetail?pairs='+encodeURIComponent(JSON.stringify([['1007','1001'],['1008','1000']]))+'")</script></head>');
   return route.fulfill({contentType:'text/html',body});
  });
  context.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url())});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host;
  const popup=await context.newPage();await popup.setViewportSize({width:368,height:780});await popup.goto('chrome-extension://'+id+'/popup.html');
  const message=msg=>popup.evaluate(m=>chrome.runtime.sendMessage(m),msg);
  const get=()=>message({type:'get'}),set=patch=>message({type:'settings',patch});
  await popup.locator('#status-text').filter({hasText:'已启用'}).waitFor();
  await popup.locator('body').screenshot({path:path.join(out,'screenshots/popup-light.png'),animations:'disabled'});
  const page=await context.newPage();await page.goto('https://x.com/testauthor/status/1000');

  const a=n=>page.locator('[data-fixture-id="'+n+'"]'),host=n=>page.locator('[data-rs-entry="'+n+'"]'),tray=page.locator('[data-rs-tray]');
  const open=async p=>{const button=p.locator('[data-rs-tray] .rs-toggle-all');await button.waitFor();if(await button.getAttribute('aria-expanded')==='false')await button.click()};
  const absent=async(p,n)=>p.waitForFunction(n=>!document.querySelector('[data-rs-entry="'+n+'"]'),n);
  await tray.waitFor();
  const tabs=await worker.evaluate(()=>chrome.tabs.query({}));
  let tabId;for(const tab of tabs){try{const m=await metric(worker,tab.id);if(m.active){tabId=tab.id;break}}catch{}}
  assert.ok(tabId,'content script metrics reachable');
  await check('one bottom collection replaces every inline fold marker; default is one button with zero entry rows',async()=>{
   assert.equal((await get()).settings.threshold,.3);assert.equal(await tray.count(),1);
   await tray.locator('.rs-count').filter({hasText:'已收起 2 条回复'}).waitFor();
   assert.equal(await tray.getByRole('button').count(),1);assert.equal(await host(1001).count(),0);
   assert.equal(await page.locator('article [data-rs-host],article [data-rs-tray]').count(),0);
   assert.equal(await tray.evaluate(n=>n===n.parentElement.lastElementChild),true);
   for(const n of [1001,1003]){assert.equal(await a(n).getAttribute('data-rs-folded'),'');assert.equal(await a(n).evaluate(n=>n.getBoundingClientRect().height),0)}
   for(const n of [999,1000,1002,1004,1005,1006,1007,1008,900000])assert.equal(await a(n).getAttribute('data-rs-folded'),null);
   await tray.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'screenshots/collection-closed.png'),fullPage:true});
  });
  await check('one click expands every reply as plain text, no per-reply toggle or cards; keyboard collapses all',async()=>{
   await open(page);for(const n of [1001,1003])await host(n).waitFor();
   assert.equal(await tray.locator('.rs-text').count(),2);assert.equal(await tray.locator('.rs-toggle-all').count(),1);
   assert.equal(await host(1003).locator('.rs-text').textContent(),rows[4].text);
   assert.equal(await a(1003).isVisible(),false);assert.equal(await tray.locator('.toggle').count(),0);
   assert.equal(await host(1003).evaluate(n=>getComputedStyle(n).borderTopWidth),'0px');
   const link=host(1003).getByRole('link',{name:'查看原回复 ↗'});assert.equal(await link.getAttribute('href'),'https://x.com/helpful_dev/status/1003');assert.equal(await link.getAttribute('target'),'_blank');
   await tray.locator('.rs-toggle-all').focus();await page.keyboard.press('Space');assert.equal(await tray.locator('.rs-list').isVisible(),false);await page.keyboard.press('Space');assert.equal(await tray.locator('.rs-list').isVisible(),true);
   await page.screenshot({path:path.join(out,'screenshots/collection-open.png'),fullPage:true});
  });
  await check('root-author replies and normal replies keep native markup without badges or toolbar spacing; recycled cells restore',async()=>{
   for(const n of [1002,1004,1007,1008]){assert.equal(await a(n).getAttribute('data-rs-managed'),null);assert.equal(await a(n).getAttribute('data-rs-folded'),null);assert.equal(await a(n).evaluate(n=>n.style.getPropertyValue('--rs-toolbar-height')),'')}
   await a(1001).evaluate(n=>n.className='native-hover-state');assert.equal(await a(1001).isVisible(),false);
   await a(1002).evaluate(n=>{n.style.display='flex';n.style.gap='12px';n.querySelector('.tweet').style.display='contents';n.querySelector('.body').style.width='0px'});assert.ok(await a(1002).locator('.body').evaluate(n=>n.getBoundingClientRect().width)>300);
   await a(1001).evaluate(n=>{const cell=document.createElement('div');cell.dataset.testid='cellInnerDiv';cell.style.minHeight='180px';n.before(cell);cell.append(n)});
   await page.waitForFunction(()=>document.querySelector('[data-fixture-id="1001"]').closest('[data-testid=cellInnerDiv]').hasAttribute('data-rs-hidden-cell'));
   assert.ok(await a(1001).evaluate(n=>n.closest('[data-testid=cellInnerDiv]').getBoundingClientRect().height)<=1);
   await set({enabled:false});await page.waitForFunction(()=>!document.querySelector('[data-rs-tray]'));assert.equal(await a(1001).isVisible(),true);assert.equal(await a(1001).evaluate(n=>n.closest('[data-testid=cellInnerDiv]').hasAttribute('data-rs-hidden-cell')),false);
   await set({enabled:true});await open(page);
  });
  await check('root author survives virtualization and is reset when the detail route changes',async()=>{
   const p=await context.newPage();await p.goto('https://x.com/testauthor/status/1000');await open(p);
   await p.locator('[data-fixture-id="1000"]').evaluate(n=>n.remove());
   await p.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),article({id:'1010',account:'TESTAUTHOR',text:rows[2].text})+article({id:'1011',account:'another_reader',text:rows[2].text}));
   await p.locator('[data-rs-entry="1011"]').waitFor();assert.equal(await p.locator('[data-rs-entry="1010"]').count(),0);
   await p.locator('[data-fixture-id="999"]').evaluate((n,markup)=>n.insertAdjacentHTML('afterend',markup),article(rows[1]));
   await p.evaluate(()=>history.pushState({},'','/helpful_dev/status/1003'));await p.waitForFunction(()=>document.querySelector('[data-fixture-id="1007"]').hasAttribute('data-rs-folded'));await open(p);assert.equal(await p.locator('[data-rs-entry="1003"]').count(),0);
   await p.evaluate(()=>history.pushState({},'','/home'));await p.waitForFunction(()=>!document.querySelector('[data-rs-tray]'));assert.equal(await p.locator('[data-rs-folded]').count(),0);
   await p.close();
  });
  await check('missing root text, quoted authors and delayed root headers preserve author scope',async()=>{
   const p=await context.newPage();await p.goto('https://x.com/i/web/status/1000?root-metadata');await p.waitForTimeout(200);assert.equal(await p.locator('[data-rs-tray]').count(),0);
   await p.locator('[data-testid=pending-name]').evaluate(n=>{const header=n.cloneNode(true);header.dataset.testid='User-Name';n.replaceWith(header)});await open(p);
   for(const n of [1007,1008])assert.equal(await p.locator('[data-rs-entry="'+n+'"]').count(),0);
   await p.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),article({id:'1012',account:'quoteauthor',text:rows[2].text}));await p.locator('[data-rs-entry="1012"]').waitFor();await p.close();
  });
  await check('root-author replies follow exact folded parents; one global expansion keeps them together',async()=>{
   const p=await context.newPage();await p.goto('https://x.com/testauthor/status/1000?parents-early');await open(p);
   const h=n=>p.locator('[data-rs-entry="'+n+'"]');await h(1007).locator('.rs-reason').filter({hasText:'随上级收起'}).waitFor();assert.equal(await h(1008).count(),0);
   const parents=async(pairs,xhr=false,endpoint='TweetDetail')=>p.evaluate(async({pairs,xhr,endpoint})=>{
    const url='/i/api/graphql/fixture/'+endpoint+'?pairs='+encodeURIComponent(JSON.stringify(pairs));
    if(xhr)await new Promise((resolve,reject)=>{const r=new XMLHttpRequest();r.open('GET',url);r.responseType='json';r.onload=resolve;r.onerror=reject;r.send()});else await (await fetch(url)).json();
   },{pairs,xhr,endpoint});
   await p.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),[
    {id:'1013',account:'another_reader',text:'哈哈哈'},{id:'1014',account:'testauthor',text:'哈哈哈'},
    {id:'1015',account:'TESTAUTHOR',text:'哈哈哈'},{id:'1016',account:'testauthor',text:rows[2].text},
    {id:'1017',account:'testauthor',text:rows[2].text},{id:'1018',account:'testauthor',text:'哈哈哈'},
   ].map(article).join(''));
   await parents([['1013','1001'],['1014','1002'],['1015','1007'],['1017','1008']]);await h(1015).waitFor();for(const n of [1013,1014,1016,1017])assert.equal(await h(n).count(),0);
   await parents([['1018','1001']],true);await h(1018).waitFor();
   await p.locator('.rs-toggle-all').click();assert.equal(await p.locator('.rs-list').isVisible(),false);await open(p);assert.equal(await p.locator('[data-fixture-id="1007"]').isVisible(),false);
   await set({threshold:.95});await absent(p,1007);await set({threshold:.30});await h(1007).waitFor();
   await message({type:'white-add',account:'example_ai'});await absent(p,1007);await message({type:'white-remove',account:'example_ai'});await h(1007).waitFor();
   await message({type:'white-add',account:'testauthor'});await absent(p,1007);await message({type:'white-remove',account:'testauthor'});await h(1007).waitFor();
   await p.locator('[data-fixture-id="1001"]').evaluate(n=>n.remove());await p.waitForTimeout(80);assert.equal(await h(1001).count(),1);assert.equal(await p.locator('[data-fixture-id="1007"]').getAttribute('data-rs-folded'),'');
   await parents([['1016','1001']],false,'OtherOperation');await p.waitForTimeout(80);assert.equal(await h(1016).count(),0);
   await p.evaluate(()=>{for(const message of [{path:'/wrong',pairs:[['1016','1001']]},{path:location.pathname,pairs:[['1016','1016'],['1016',1001]]}])window.postMessage({channel:'liubai:parents:v1',...message},location.origin)});await p.waitForTimeout(80);assert.equal(await h(1016).count(),0);
   await h(1018).getByRole('button',{name:'不该折叠',exact:true}).click();await absent(p,1018);
   const exported=await message({type:'export'}),feedback=exported.feedback.find(f=>f.url.endsWith('/1018'));assert.equal(feedback.foldReason,'parent_folded');assert.equal(feedback.parentId,'1001');assert.ok(Math.abs(feedback.modelScore-scorer.score('哈哈哈'))<1e-6);
   await worker.evaluate(()=>chrome.storage.local.set({feedback:[]}));
   await p.screenshot({path:path.join(out,'screenshots/author-parent-folds.png'),fullPage:true});await p.close();
  });
  await check('one-click whitelist restores native replies, updates the collection and persists across reload',async()=>{
   await host(1001).getByRole('button',{name:'总是保留 @example_ai',exact:true}).click();await absent(page,1001);assert.equal(await a(1001).isVisible(),true);assert.ok((await get()).settings.whitelist.includes('example_ai'));
   await page.reload();await open(page);assert.equal(await host(1001).count(),0);
   await popup.getByRole('button',{name:'移除 @example_ai 的白名单',exact:true}).click();await host(1001).waitFor();
  });
  await check('feedback restores the native reply for this page and exports an explicit local keep label',async()=>{
   await host(1003).getByRole('button',{name:'不该折叠',exact:true}).click();await absent(page,1003);assert.equal(await a(1003).isVisible(),true);assert.equal((await get()).feedbackCount,1);
   const downloadPromise=popup.waitForEvent('download');await popup.locator('#export').click();const download=await downloadPromise;const exportPath=path.join(work,'feedback-test-export.json');await download.saveAs(exportPath);
   const data=JSON.parse(fs.readFileSync(exportPath,'utf8'));assert.equal(data.feedback.length,1);assert.equal(data.feedback[0].account,'helpful_dev');assert.equal(data.feedback[0].label,'保留');assert.equal(data.feedback[0].foldReason,'model');
  });
  await check('popup presets, slider, validation and normalized handles',async()=>{
   await popup.getByRole('button',{name:'保守',exact:true}).click();await popup.waitForFunction(()=>document.querySelector('#strength-name').textContent==='保守');assert.equal((await get()).settings.threshold,.7304868345052445);
   await popup.getByRole('button',{name:'标准',exact:true}).click();await popup.waitForFunction(()=>document.querySelector('#strength-name').textContent==='标准');assert.equal((await get()).settings.threshold,.45);
   await popup.locator('#intensity').fill('75');await popup.locator('#intensity').dispatchEvent('change');await popup.waitForFunction(()=>document.querySelector('#strength-name').textContent==='自定义');
   await popup.waitForTimeout(250);assert.equal((await get()).settings.threshold,.25);
   await popup.locator('#account').fill('bad account');await popup.locator('#white-form button').click();await popup.locator('#message.error').waitFor();assert.equal((await get()).settings.whitelist.length,0);
   await popup.locator('#account').fill('@Reader_Test');await popup.locator('#white-form button').click();await popup.locator('.white-row').filter({hasText:'@reader_test'}).waitFor();assert.ok((await get()).settings.whitelist.includes('reader_test'));await popup.getByRole('button',{name:'移除 @reader_test 的白名单',exact:true}).click();
   const r=await Promise.all(['@TEST_A','test_b','test_c'].map(account=>message({type:'white-add',account})));assert.ok(r.every(x=>x.ok));assert.deepEqual((await get()).settings.whitelist.sort(),['test_a','test_b','test_c']);
   await popup.getByRole('button',{name:'移除 @test_b 的白名单',exact:true}).click();await popup.waitForTimeout(100);assert.equal((await get()).settings.whitelist.includes('test_b'),false);
   for(const account of ['test_a','test_c'])await message({type:'white-remove',account});
   await popup.getByRole('button',{name:'激进',exact:true}).click();await popup.waitForTimeout(100);
  });
  await check('concurrent local writes serialize without losing accounts; invalid settings are rejected',async()=>{
   const replies=await Promise.all(['parallel_a','parallel_b','parallel_c'].map(account=>message({type:'white-add',account})));
   assert.ok(replies.every(r=>r.ok));const list=(await get()).settings.whitelist;for(const account of ['parallel_a','parallel_b','parallel_c'])assert.ok(list.includes(account));
   for(const account of ['parallel_a','parallel_b','parallel_c'])await message({type:'white-remove',account});
   assert.equal((await set({threshold:-1})).ok,false);assert.equal((await get()).settings.threshold,.30);
  });

  await check('recommendations remain excluded when their heading disappears, and new replies keep the collection last',async()=>{
   await page.evaluate(markup=>{document.querySelector('h2').remove();document.querySelector('[data-fixture-id="900000"]').outerHTML=markup},article({id:'900001',account:'another_post',text:rows[2].text}));await page.waitForTimeout(80);assert.equal(await host(900001).count(),0);
   await a(900001).evaluate(n=>{const h=document.createElement('h2');h.textContent='发现更多';n.before(h)});
   await page.evaluate(markup=>document.querySelector('[data-testid=primaryColumn]').insertAdjacentHTML('beforeend',markup),article({id:'900002',account:'extra_rec',text:rows[2].text}));await page.waitForTimeout(100);assert.equal(await tray.evaluate(n=>n===n.parentElement.lastElementChild),true);assert.equal(await host(900002).count(),0);
  });
  await check('virtualized article recycling restores the cell while keeping the old reply readable in the collection',async()=>{
   await a(1001).evaluate((node,markup)=>{const box=document.createElement('div');box.innerHTML=markup;node.replaceChildren(...box.firstElementChild.childNodes);node.dataset.fixtureId='1100'},article({id:'1100',account:'new_reader',text:'哈哈哈'}));
   await page.waitForFunction(()=>!document.querySelector('[data-fixture-id="1100"]').hasAttribute('data-rs-folded'));assert.equal(await a(1100).isVisible(),true);assert.equal(await host(1100).count(),0);await host(1001).waitFor();assert.equal(await host(1001).locator('.rs-author').textContent(),'@example_ai');
  });
  await check('shortened URLs use actual href for scoring; collected text is escaped and feedback keeps displayed text',async()=>{
   const prefix=rows[2].text+' ',url='https://t.co/testlink123',expected=scorer.score(prefix+url);
   await a(1004).locator('[data-testid=tweetText]').first().evaluate((n,prefix)=>{const link=document.createElement('a');link.href='https://t.co/testlink123';link.textContent='github.com/example/…';n.replaceChildren(document.createTextNode(prefix),link)},prefix);
   await host(1004).getByRole('button',{name:'不该折叠',exact:true}).click();await absent(page,1004);
   const record=(await message({type:'export'})).feedback.find(r=>r.account==='quoted_reply');assert.ok(Math.abs(record.modelScore-expected)<1e-6);assert.equal(record.text,prefix+'github.com/example/…');
   const text=rows[2].text+' <img src=x onerror=alert(1)>',id='1020';assert.ok(scorer.score(text)>.3);await page.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),article({id,account:'markup_reader',text}));
   await host(id).waitFor();assert.equal(await host(id).locator('.rs-text').textContent(),text);assert.equal(await host(id).locator('.rs-text img').count(),0);
  });
  await check('one collection is responsive and theme-aware; closing all keeps keyboard focus on its single control',async()=>{
   assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);result.popupBodyHeight=await popup.locator('body').evaluate(n=>n.getBoundingClientRect().height);assert.ok(result.popupBodyHeight<=600);
   await popup.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await popup.locator('body').screenshot({path:path.join(out,'screenshots/popup-dark.png'),animations:'disabled'});
   await page.setViewportSize({width:390,height:844});await tray.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'screenshots/collection-narrow.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(60);assert.equal(await tray.evaluate(n=>n.style.getPropertyValue('--rs-bg')),'#15202b');await page.screenshot({path:path.join(out,'screenshots/collection-dark.png'),fullPage:true});
   await tray.locator('.rs-toggle-all').click();assert.equal(await tray.locator('.rs-list').isVisible(),false);assert.equal(await tray.locator('.rs-toggle-all').evaluate(n=>document.activeElement===n),true);await open(page);
   await popup.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1280,height:900});
  });
  await check('plugin has no account block control and collection gestures never navigate the native article',async()=>{
   assert.equal(await page.getByRole('button',{name:'屏蔽账号 ↗',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.fixture.menuOpens),0);assert.equal(await page.evaluate(()=>window.fixture.articlePresses),0);
  });
  result.functionalMetrics=await metric(worker,tabId);
  const load=await context.newPage();let t=performance.now();await load.goto('https://x.com/testauthor/status/1000?loadtest');
  let loadId;const deadline=performance.now()+30000;
  while(!loadId&&performance.now()<deadline){for(const tab of await worker.evaluate(()=>chrome.tabs.query({}))){try{const m=await metric(worker,tab.id);if(m.scores.length===604){loadId=tab.id;break}}catch{}}if(!loadId)await load.waitForTimeout(50)}
  result.largePageReadyMs=performance.now()-t;
  assert.ok(loadId,'load page tab id');
  result.largePageMetrics=await metric(worker,loadId);
  result.inferenceMs=summarize(result.largePageMetrics.scores);result.processingBatchMs=summarize(result.largePageMetrics.batches);
  const nav=await load.evaluate(()=>performance.getEntriesByType('navigation')[0].toJSON());result.navigation={domContentLoadedMs:nav.domContentLoadedEventEnd,loadMs:nav.loadEventEnd};
  result.startupLongTasks=await load.evaluate(()=>window.__rsQALongTasks);
  result.scroll=await scroll(load);
  assert.equal(await load.locator('[data-rs-tray] .rs-toggle-all').count(),1);assert.equal(await load.locator('[data-rs-entry]').count(),0);
  result.collectionOpen=await load.evaluate(async()=>{const start=performance.now();document.querySelector('.rs-toggle-all').click();const handlerMs=performance.now()-start;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));return {handlerMs,twoFramesMs:performance.now()-start,entries:document.querySelectorAll('[data-rs-entry]').length}});
  assert.ok(result.collectionOpen.entries>100);result.collectionOpen.scroll=await scroll(load);checks.push('600-reply stress page expands all collected replies with one button, retaining no inline markers');
  // Profile the scorer separately from DOM reading, style/layout and toolbars.
  const bench=await context.newPage();await bench.goto('about:blank');await bench.addScriptTag({path:path.join(extension,'model-data.js')});await bench.addScriptTag({path:path.join(extension,'scorer.js')});
  result.browserScorer=await bench.evaluate(()=>{const text='自迭代最好别让它直接改主记忆 先写进一个待合并区 跑几次任务没变差再合进去';for(let i=0;i<50;i++)ReplyScorer.score(text);const times=[];for(let i=0;i<1000;i++){const t=performance.now();ReplyScorer.score(text);times.push(performance.now()-t)}return times});result.browserScorer=summarize(result.browserScorer);
  result.lengthScorer=await bench.evaluate(()=>[16,64,256,1024,4096,12000].map(length=>{const text='这是一些回复文本，测试本地字符分类器。'.repeat(1000).slice(0,length),times=[];for(let i=0;i<40;i++){const t=performance.now();ReplyScorer.score(text);times.push(performance.now()-t)}return {length,times}}));result.lengthScorer=result.lengthScorer.map(r=>({length:r.length,...summarize(r.times)}));
  const baseline=await launch(false);
  try{
   await baseline.addInitScript(observeStartup);
   await baseline.route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:html(600)}));
   const bare=await baseline.newPage();await bare.goto('https://x.com/testauthor/status/1000?loadtest');await bare.waitForLoadState('load');
   await bare.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const nav=await bare.evaluate(()=>performance.getEntriesByType('navigation')[0].toJSON());result.withoutExtension={navigation:{domContentLoadedMs:nav.domContentLoadedEventEnd,loadMs:nav.loadEventEnd},startupLongTasks:await bare.evaluate(()=>window.__rsQALongTasks),scroll:await scroll(bare)};
  }finally{await baseline.close()}
  result.httpRequests=remote;assert.ok(remote.every(u=>['/testauthor/status/1000','/i/web/status/1000'].includes(new URL(u).pathname)||new URL(u).pathname.startsWith('/i/api/graphql/fixture/')));assert.deepEqual(errors,[]);checks.push('no runtime errors or extension-created remote service calls in offline fixtures');
  fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:checks.length,inference:result.inferenceMs,batch:result.processingBatchMs,scroll:result.scroll.frameMs,ready:result.largePageReadyMs}));
 }finally{await context.close()}
})().catch(error=>{result.failure=error.stack;fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(result,null,2));console.error(error);process.exitCode=1});
