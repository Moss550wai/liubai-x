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
  const a=number=>page.locator('[data-fixture-id="'+number+'"]'),host=number=>a(number).locator('[data-rs-host]');
  await host(1003).waitFor();
  const tabs=await worker.evaluate(()=>chrome.tabs.query({}));
  let tabId;for(const tab of tabs){try{const m=await metric(worker,tab.id);if(m.active){tabId=tab.id;break}}catch{}}
  assert.ok(tabId,'content script metrics reachable');
  await check('default aggressive, text-only scope, root/ancestors/quotes/ads/media/recommendations preserved',async()=>{
   assert.equal((await get()).settings.threshold,.3);
   for(const n of [999,1000,1002,1004,1005,1006,1007,1008,900000])assert.equal(await host(n).count(),0);
   assert.equal(await a(1003).getAttribute('data-rs-folded'),'');
   assert.equal(await a(1003).locator('.tweet').isVisible(),false);
  });
  await check('root-author replies and normal replies keep native markup without badges or toolbar spacing',async()=>{
   assert.ok(scorer.score(rows.find(r=>r.id==='1007').text)>.3);
   for(const n of [1002,1004,1007,1008]){assert.equal(await host(n).count(),0);assert.equal(await a(n).getAttribute('data-rs-managed'),null);assert.equal(await a(n).getAttribute('data-rs-folded'),null);assert.equal(await a(n).evaluate(a=>a.style.getPropertyValue('--rs-toolbar-height')),'')}
  });
  await check('root author survives virtualization and is reset when the detail route changes',async()=>{
   await a(1000).evaluate(n=>n.remove());
   await page.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),article({id:'1010',account:'TESTAUTHOR',text:rows[2].text})+article({id:'1011',account:'another_reader',text:rows[2].text}));
   await host(1011).waitFor();assert.equal(await host(1010).count(),0);
   await a(999).evaluate((n,markup)=>n.insertAdjacentHTML('afterend',markup),article(rows[1]));
   await page.evaluate(()=>history.pushState({},'','/helpful_dev/status/1003'));await host(1007).waitFor();assert.equal(await host(1003).count(),0);
   await page.evaluate(()=>history.pushState({},'','/testauthor/status/1000'));await host(1003).waitFor();await page.waitForFunction(()=>!document.querySelector('[data-fixture-id="1007"] [data-rs-host]'));assert.equal(await host(1008).count(),0);
  });
  await check('missing root text, quoted authors and delayed root headers cannot fold the original author',async()=>{
   const metadata=await context.newPage();await metadata.goto('https://x.com/i/web/status/1000?root-metadata');await metadata.waitForTimeout(200);assert.equal(await metadata.locator('[data-rs-host]').count(),0);
   await metadata.locator('[data-testid=pending-name]').evaluate(n=>{const header=n.cloneNode(true);header.dataset.testid='User-Name';n.replaceWith(header)});
   await metadata.locator('[data-fixture-id="1001"] [data-rs-host]').waitFor();
   for(const n of [1007,1008])assert.equal(await metadata.locator('[data-fixture-id="'+n+'"] [data-rs-host]').count(),0);
   await metadata.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),article({id:'1012',account:'quoteauthor',text:rows[2].text}));
   await metadata.locator('[data-fixture-id="1012"] [data-rs-host]').waitFor();await metadata.close();
  });
  await check('root-author replies follow exact folded parents; native thread posts and other users stay independent',async()=>{
   const thread=await context.newPage();await thread.goto('https://x.com/testauthor/status/1000?parents-early');
   const t=n=>thread.locator('[data-fixture-id="'+n+'"]'),h=n=>t(n).locator('[data-rs-host]');
   const parents=async(pairs,xhr=false,endpoint='TweetDetail')=>thread.evaluate(async({pairs,xhr,endpoint})=>{
    const url='/i/api/graphql/fixture/'+endpoint+'?pairs='+encodeURIComponent(JSON.stringify(pairs));
    const body=xhr?await new Promise((resolve,reject)=>{const r=new XMLHttpRequest();r.open('GET',url);r.responseType='json';r.onload=()=>resolve(r.response);r.onerror=reject;r.send()}):await (await fetch(url)).json();
    return body.data.entries.length;
   },{pairs,xhr,endpoint});
   const absent=async n=>thread.waitForFunction(n=>!document.querySelector('[data-fixture-id="'+n+'"] [data-rs-host]'),n);
   await h(1007).getByText('随上级收起 @testauthor 的回复',{exact:true}).waitFor();assert.equal(await h(1008).count(),0);
   await thread.evaluate(markup=>document.querySelector('h2').insertAdjacentHTML('beforebegin',markup),[
    {id:'1013',account:'another_reader',text:'哈哈哈'},
    {id:'1014',account:'testauthor',text:'哈哈哈'},
    {id:'1015',account:'TESTAUTHOR',text:'哈哈哈'},
    {id:'1016',account:'testauthor',text:rows[2].text},
    {id:'1017',account:'testauthor',text:rows[2].text},
    {id:'1018',account:'testauthor',text:'哈哈哈'},
   ].map(article).join(''));
   assert.equal(await parents([['1013','1001'],['1014','1002'],['1015','1007'],['1017','1008']]),4);
   await h(1015).waitFor();for(const n of [1013,1014,1016,1017])assert.equal(await h(n).count(),0);
   assert.equal(await parents([['1018','1001']],true),1);await h(1018).waitFor();
   await h(1015).getByRole('button',{name:'展开',exact:true}).click();assert.equal(await t(1015).locator('.tweet').isVisible(),true);await h(1015).getByRole('button',{name:'收起',exact:true}).click();
   await h(1001).getByRole('button',{name:'展开',exact:true}).click();for(const n of [1007,1015,1018])await absent(n);
   await h(1001).getByRole('button',{name:'收起',exact:true}).click();for(const n of [1007,1015,1018])await h(n).waitFor();
   await set({threshold:.95});await absent(1007);await set({threshold:.30});await h(1007).waitFor();
   await message({type:'white-add',account:'example_ai'});await absent(1007);await message({type:'white-remove',account:'example_ai'});await h(1007).waitFor();
   await message({type:'white-add',account:'testauthor'});await absent(1007);await message({type:'white-remove',account:'testauthor'});await h(1007).waitFor();
   await t(1001).evaluate(a=>a.remove());await thread.waitForTimeout(80);assert.equal(await t(1007).getAttribute('data-rs-folded'),'');
   await t(1000).evaluate((n,markup)=>n.insertAdjacentHTML('afterend',markup),article(rows[2]));await h(1001).waitFor();
   await parents([['1016','1001']],false,'OtherOperation');await thread.waitForTimeout(80);assert.equal(await h(1016).count(),0);
   await thread.evaluate(()=>{for(const message of [{path:'/wrong',pairs:[['1016','1001']]},{path:location.pathname,pairs:[['1016','1016'],['1016',1001]]}])window.postMessage({channel:'liubai:parents:v1',...message},location.origin)});await thread.waitForTimeout(80);assert.equal(await h(1016).count(),0);
   const before=(await get()).feedbackCount;await h(1018).getByRole('button',{name:'不该折叠',exact:true}).click();await h(1018).getByText('已展开，纠错记录仅保存在本机。',{exact:true}).waitFor();
   const exported=await message({type:'export'}),feedback=exported.feedback.find(f=>f.url.endsWith('/1018'));assert.equal(feedback.foldReason,'parent_folded');assert.equal(feedback.parentId,'1001');assert.ok(Math.abs(feedback.modelScore-scorer.score('哈哈哈'))<1e-6);
   assert.equal(exported.feedback.length,before+1);
   // Keep the existing feedback checks isolated from this separate synthetic thread.
   await worker.evaluate(()=>chrome.storage.local.set({feedback:[]}));
   await thread.evaluate(()=>history.pushState({},'','/helpful_dev/status/1003'));await h(1007).getByText('已收起 @testauthor 的回复',{exact:true}).waitFor();await absent(1015);
   await thread.evaluate(()=>history.pushState({},'','/testauthor/status/1000'));await h(1007).getByText('随上级收起 @testauthor 的回复',{exact:true}).waitFor();
   await thread.screenshot({path:path.join(out,'screenshots/author-parent-folds.png'),fullPage:true});await thread.close();
  });
  await page.screenshot({path:path.join(out,'screenshots/replies-folded.png'),fullPage:true});
  await check('one-click expand and refold retain original content',async()=>{
   const text=await a(1003).locator('[data-testid=tweetText]').textContent();
   await host(1003).getByRole('button',{name:'展开',exact:true}).click();assert.equal(await a(1003).locator('.tweet').isVisible(),true);
   await host(1003).getByRole('button',{name:'收起',exact:true}).click();assert.equal(await a(1003).locator('.tweet').isVisible(),false);
   assert.equal(await a(1003).locator('[data-testid=tweetText]').textContent(),text);
   await host(1003).getByRole('button',{name:'展开',exact:true}).focus();await page.keyboard.press('Space');assert.equal(await a(1003).locator('.tweet').isVisible(),true);await page.keyboard.press('Space');assert.equal(await a(1003).locator('.tweet').isVisible(),false);
  });
  await check('X replacing article classes cannot drop the fold state or toolbar spacing',async()=>{
   await a(1003).evaluate(a=>a.className='native-hover-state');assert.equal(await a(1003).getAttribute('data-rs-folded'),'');assert.equal(await a(1003).locator('.tweet').isVisible(),false);
   await a(1002).evaluate(a=>a.className='native-hover-state');assert.equal(await a(1002).getAttribute('data-rs-managed'),null);
  });
  await check('recommendations stay unfiltered after their heading is removed by virtualization',async()=>{
   await page.evaluate(newHTML=>{document.querySelector('h2').remove();document.querySelector('[data-fixture-id="900000"]').outerHTML=newHTML},article({id:'900001',account:'another_post',text:rows[2].text}));
   await page.waitForTimeout(100);assert.equal(await host(900001).count(),0);
   await a(900001).evaluate(a=>{const heading=document.createElement('h2');heading.textContent='发现更多';a.before(heading)});
  });
  await check('normal flex replies have no extra spacing; expanded folds keep controls below native content',async()=>{
   await a(1002).evaluate(a=>{a.style.display='flex';a.style.gap='12px';a.querySelector('.tweet').style.display='contents';a.querySelector('.body').style.width='0px'});await page.waitForTimeout(60);
   assert.equal(await host(1002).count(),0);assert.ok(await a(1002).locator('.body').evaluate(n=>n.getBoundingClientRect().width)>300,'native flex body must not collapse into a narrow column');
   await host(1003).getByRole('button',{name:'展开',exact:true}).click();await page.waitForTimeout(60);
   const boxes=await a(1003).evaluate(a=>({body:a.querySelector('.tweet').getBoundingClientRect().toJSON(),bar:a.querySelector('[data-rs-host]').getBoundingClientRect().toJSON()}));assert.ok(boxes.bar.y>=boxes.body.bottom-1);await host(1003).getByRole('button',{name:'收起',exact:true}).click();
  });
  await check('feedback saved locally once, expands reply, export JSON includes text and explicit keep label',async()=>{
   await host(1003).getByRole('button',{name:'不该折叠',exact:true}).click();
   await host(1003).getByText('已展开，纠错记录仅保存在本机。',{exact:true}).waitFor();
   assert.equal((await get()).feedbackCount,1);assert.equal(await a(1003).locator('.tweet').isVisible(),true);
   const downloadPromise=popup.waitForEvent('download');await popup.locator('#export').click();const download=await downloadPromise;const exportPath=path.join(work,'feedback-test-export.json');await download.saveAs(exportPath);
   const data=JSON.parse(fs.readFileSync(exportPath,'utf8'));assert.equal(data.feedback.length,1);assert.equal(data.feedback[0].label,'保留');assert.equal(data.feedback[0].account,'helpful_dev');assert.ok(data.feedback[0].text.startsWith('自迭代'));
  });
  await check('one-click whitelist overrides model and persists across reload; removal restores filtering',async()=>{
   await host(1001).getByRole('button',{name:'总是保留 @example_ai',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('[data-fixture-id="1001"] [data-rs-host]'));assert.ok((await get()).settings.whitelist.includes('example_ai'));
   await page.reload();await host(1003).waitFor();assert.equal(await host(1001).count(),0);assert.equal(await a(1001).locator('.tweet').isVisible(),true);
   await popup.getByRole('button',{name:'移除 @example_ai 的白名单',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[data-fixture-id="1001"]').hasAttribute('data-rs-folded'));
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
  await check('disabled restores originals, enabled resumes, home/search routes untouched',async()=>{
   await set({enabled:false});await page.waitForFunction(()=>!document.querySelector('[data-rs-host]'));assert.equal(await a(1001).locator('.tweet').isVisible(),true);
   await set({enabled:true});await host(1001).waitFor();
   await page.evaluate(()=>history.pushState({},'','/home'));await page.waitForFunction(()=>!document.querySelector('[data-rs-host]'));
   await page.evaluate(()=>history.pushState({},'','/testauthor/status/1000'));await host(1001).waitFor();
  });
  await check('virtualized article recycling does not leak author, fold state or feedback target',async()=>{
   await a(1001).evaluate((node,newHTML)=>{const box=document.createElement('div');box.innerHTML=newHTML;node.replaceChildren(...box.firstElementChild.childNodes);node.dataset.fixtureId='1100'},article({id:'1100',account:'new_reader',text:'哈哈哈'}));
   await page.waitForFunction(()=>!document.querySelector('[data-fixture-id="1100"]').hasAttribute('data-rs-managed'));assert.equal(await a(1100).locator('.tweet').isVisible(),true);assert.equal(await host(1100).count(),0);
  });
  await check('display-shortened URLs normalize using their actual link, without storing changed reply text',async()=>{
   const prefix=rows[2].text+' ',url='https://t.co/testlink123',expected=scorer.score(prefix+url);assert.ok(expected>.3);
   await a(1004).locator('[data-testid=tweetText]').first().evaluate((node,prefix)=>{const link=document.createElement('a');link.href='https://t.co/testlink123';link.textContent='github.com/example/…';node.replaceChildren(document.createTextNode(prefix),link)},prefix);
   await host(1004).getByRole('button',{name:'不该折叠',exact:true}).waitFor();await host(1004).getByRole('button',{name:'不该折叠',exact:true}).click();await host(1004).getByText('已展开，纠错记录仅保存在本机。',{exact:true}).waitFor();
   const data=await message({type:'export'}),record=data.feedback.find(r=>r.account==='quoted_reply');assert.ok(Math.abs(record.modelScore-expected)<1e-6);assert.equal(record.text,prefix+'github.com/example/…');
  });
  await check('light/dark popup and narrow reply layout have no horizontal overflow; keyboard works',async()=>{
   assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);result.popupBodyHeight=await popup.locator('body').evaluate(n=>n.getBoundingClientRect().height);assert.ok(result.popupBodyHeight<=600);
   await popup.locator('#account').fill('');await popup.evaluate(()=>document.querySelector('#message').textContent='');
   await popup.locator('#account').fill('');await popup.evaluate(()=>document.querySelector('#message').textContent='');
   await popup.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await popup.locator('body').screenshot({path:path.join(out,'screenshots/popup-dark.png'),animations:'disabled'});
   await popup.locator('#enabled').focus();await popup.keyboard.press('Space');await popup.waitForTimeout(100);assert.equal((await get()).settings.enabled,false);await popup.keyboard.press('Space');await popup.waitForTimeout(100);
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'screenshots/replies-narrow.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(100);assert.equal(await host(1004).evaluate(h=>h.style.getPropertyValue('--rs-bg')),'#15202b');await page.screenshot({path:path.join(out,'screenshots/replies-dark.png'),fullPage:true});
   await popup.emulateMedia({colorScheme:'light'});await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:1280,height:900});
  });
  await check('plugin has no account block button or automatic X account action',async()=>{assert.equal(await page.getByRole('button',{name:'屏蔽账号 ↗',exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.fixture.menuOpens),0);assert.equal(await page.evaluate(()=>window.fixture.articlePresses),0)});
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
