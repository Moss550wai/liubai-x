(() => {
  'use strict';
  const HOST='[data-rs-tray]',ARTICLE='article[data-testid="tweet"]';
  const states=new Map(),pending=new Set(),cache=new Map(),expanded=new Map(),knownReplies=new Map(),parents=new Map(),authorReplies=new Set(),collected=new Map();
  let settings={enabled:false,threshold:.30,whitelist:[]},route='',rootSeen=false,rootNode=null,rootAccount='',discoverySeen=false,scheduled=false,dead=false,relationsDirty=false;
  let tray=null,trayOpen=false,trayDirty=false;
  const metrics={scores:[],batches:[],processed:0,started:performance.now(),readyMs:null};

  async function request(message) {
    const result=await chrome.runtime.sendMessage(message);
    if(!result?.ok)throw Error(result?.error||'插件连接已断开，请刷新页面');return result;
  }
  function rootId(){return location.pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d{1,24})(?:\/|$)/)?.[1]||''}
  function own(node,article){return node.closest('article')===article&&!node.closest('div[role="link"]')}
  function accountOf(article) {
    const header=[...article.querySelectorAll('[data-testid="User-Name"]')].find(n=>own(n,article));
    const profile=header&&[...header.querySelectorAll('a[href]')].map(n=>n.getAttribute('href')).find(h=>/^\/[A-Za-z0-9_]{1,15}\/?$/.test(h));
    return profile?profile.replaceAll('/','').toLowerCase():'';
  }
  function extract(article) {
    const account=accountOf(article);if(!account)return null;
    const time=[...article.querySelectorAll('time')].find(n=>own(n,article)&&new RegExp('^/'+account+'/status/\\d+(?:[/?]|$)','i').test(n.closest('a')?.getAttribute('href')||''));
    if(!time)return null;
    const id=time.closest('a').getAttribute('href').match(/\/status\/(\d+)/)[1];
    if(id.length>24)return null;
    const blocks=[...article.querySelectorAll('[data-testid="tweetText"]')].filter(n=>own(n,article));
    const text=blocks.map(n=>n.innerText||n.textContent).join('\n').trim();
    const modelText=blocks.map(block=>{
      let value=block.innerText||block.textContent;
      for(const link of block.querySelectorAll('a[href]')){
        const shown=link.innerText||link.textContent,href=link.getAttribute('href');
        if(shown&&/^https?:\/\//i.test(href))value=value.replace(shown,' '+href+' ');
      }
      return value;
    }).join('\n').trim();
    if(!text||article.querySelector('[data-testid="promotedIndicator"]'))return null;
    // shortcut: very large replies stay visible; move scoring to a worker if these need filtering.
    if(Array.from(text).length>12000)return null;
    return {id,account,text,modelText,modelKey:ReplyScorer.clean(modelText),url:'https://x.com/'+account+'/status/'+id};
  }
  function eligible(article,data,id,boundaries) {
    const primary=article.closest('[data-testid="primaryColumn"]');
    if(!primary||!id||!data||data.id===id)return false;
    // Older ancestors in the thread must never be treated as replies.
    if(BigInt(data.id)<=BigInt(id))return false;
    if(rootNode?.isConnected&&!(rootNode.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING))return false;
    if(!rootSeen||!rootAccount)return false;
    if(discoverySeen&&!boundaries.length&&!knownReplies.has(data.id))return false;
    if(boundaries.some(n=>n.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING))return false;
    return true;
  }
  function forget(article) {const old=states.get(article);if(old){article.removeAttribute('data-rs-folded');if(old.cell?.getAttribute('data-rs-hidden-cell')===old.data.id)old.cell.removeAttribute('data-rs-hidden-cell');states.delete(article)}}
  function hide(article,data) {
    const wrapper=article.closest('[data-testid="cellInnerDiv"]'),cell=wrapper?.querySelectorAll(ARTICLE).length===1?wrapper:null;
    const old=states.get(article);if(old?.cell!==cell)old?.cell?.removeAttribute('data-rs-hidden-cell');
    article.setAttribute('data-rs-folded','');cell?.setAttribute('data-rs-hidden-cell',data.id);states.set(article,{data,cell});
  }
  function requestParents(){window.postMessage({channel:'liubai:parents:v1',request:true,path:location.pathname},location.origin)}
  function reset(){for(const a of states.keys())forget(a);pending.clear();knownReplies.clear();parents.clear();authorReplies.clear();collected.clear();tray?.remove();tray=null;trayOpen=false;trayDirty=false;relationsDirty=false;rootSeen=false;rootNode=null;rootAccount='';discoverySeen=false;requestParents()}
  function remember(map,key,value,limit){map.delete(key);map.set(key,value);if(map.size>limit)map.delete(map.keys().next().value)}
  function queueAuthors(){for(const a of authorReplies){if(a.isConnected)pending.add(a);else authorReplies.delete(a)}if(pending.size)schedule()}
  function foldReason(data,score) {
    if(settings.whitelist.includes(data.account)||expanded.get(data.id))return '';
    if(data.account!==rootAccount)return score>=settings.threshold?'model':'';
    let id=parents.get(data.id);
    // shortcut: unknown or evicted parents stay visible; no adjacency-based guesses.
    for(let depth=0;id&&depth<100;depth++) {
      const parent=knownReplies.get(id);
      if(!parent||expanded.get(id)||settings.whitelist.includes(parent.account))return '';
      if(parent.account!==rootAccount)return parent.score>=settings.threshold?'parent_folded':'';
      id=parents.get(id);
    }
    return '';
  }
  function notice(entry,text,error=false){if(!entry.row)return;const p=entry.row.querySelector('.rs-message');p.textContent=text;p.classList.toggle('rs-error',error)}
  function palette() {
    let c=getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
    if(c?.length===4&&Number(c[3])===0)c=getComputedStyle(document.documentElement).backgroundColor.match(/[\d.]+/g);
    const dark=c?.length===4&&Number(c[3])===0?matchMedia('(prefers-color-scheme:dark)').matches:c&&c.length>=3&&(Number(c[0])+Number(c[1])+Number(c[2]))<360;
    return dark?['#a7b7c1','#7ccba0','#192a34','#15202b','#354450','#fa929a']:['#536471','#216746','#eff3f4','#fff','#eff3f4','#b6363e'];
  }
  function recolor(){if(tray)['ink','accent','hover','bg','line','danger'].forEach((name,i)=>tray.style.setProperty('--rs-'+name,palette()[i]))}
  function makeTray() {
    tray=document.createElement('section');tray.setAttribute('data-rs-tray','');tray.setAttribute('aria-label','已折叠回复');
    tray.innerHTML='<button class="rs-toggle-all" type="button" aria-expanded="false" aria-controls="rs-collected-replies"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="rs-count"></span><span class="rs-toggle-label">展开</span></button><div id="rs-collected-replies" class="rs-list" role="list" hidden></div><p class="rs-status" role="status" aria-live="polite"></p>';
    for(const type of ['click','dblclick','auxclick','pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup'])tray.addEventListener(type,event=>{event.stopPropagation();if(type==='pointerdown'&&event.pointerType==='mouse'&&event.target.closest('button'))event.preventDefault()});
    tray.querySelector('.rs-toggle-all').onclick=()=>{
      trayOpen=!trayOpen;syncTray();
      if(!trayOpen){const button=tray.querySelector('.rs-toggle-all');if(button.getBoundingClientRect().top<0)button.scrollIntoView({block:'nearest'});button.focus({preventScroll:true})}
    };
    recolor();
  }
  function makeRow(entry) {
    const row=document.createElement('div');row.setAttribute('data-rs-entry',entry.data.id);row.setAttribute('role','listitem');
    row.innerHTML='<div class="rs-entry-heading"><a class="rs-author" target="_blank" rel="noopener noreferrer"></a><span class="rs-reason"></span></div><p class="rs-text"></p><div class="rs-entry-actions"><a class="rs-original" target="_blank" rel="noopener noreferrer">查看原回复 ↗</a><button class="rs-feedback" type="button">不该折叠</button><button class="rs-white" type="button">保留账号</button></div><p class="rs-message" role="status" aria-live="polite"></p>';
    row.querySelector('.rs-white').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{const result=await request({type:'white-add',account:entry.data.account});settings=result.settings;refresh();tray?.querySelector('.rs-toggle-all').focus({preventScroll:true})}catch(error){notice(entry,error.message,true)}finally{button.disabled=false}
    };
    row.querySelector('.rs-feedback').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        await request({type:'feedback',...entry.data,score:entry.score,threshold:settings.threshold,foldReason:foldReason(entry.data,entry.score),parentId:parents.get(entry.data.id)});
        remember(expanded,entry.data.id,true,1000);refresh();
        if(tray){tray.querySelector('.rs-status').textContent='已恢复 @'+entry.data.account+' 的回复，纠错仅保存在本机。';tray.querySelector('.rs-toggle-all').focus({preventScroll:true})}
      }catch(error){notice(entry,error.message,true)}finally{button.disabled=false}
    };
    entry.row=row;return row;
  }
  function syncTray() {
    trayDirty=false;
    const primary=document.querySelector('[data-testid="primaryColumn"]');if(!primary||!settings.enabled||!rootId())return;
    const hits=[...collected.values()].filter(entry=>foldReason(entry.data,entry.score));
    if(!hits.length){tray?.remove();return}
    if(!tray)makeTray();
    if(primary.lastElementChild!==tray)primary.append(tray);
    const button=tray.querySelector('.rs-toggle-all'),list=tray.querySelector('.rs-list');
    tray.querySelector('.rs-count').textContent='已收起 '+hits.length+' 条回复';
    tray.querySelector('.rs-toggle-label').textContent=trayOpen?'收起':'展开';button.setAttribute('aria-expanded',String(trayOpen));list.hidden=!trayOpen;
    const ids=new Set(hits.map(e=>e.data.id));
    for(const row of [...list.children])if(!ids.has(row.getAttribute('data-rs-entry')))row.remove();
    if(!trayOpen)return;
    const fragment=document.createDocumentFragment();
    for(const entry of hits){
      const row=entry.row||makeRow(entry),reason=foldReason(entry.data,entry.score);
      if(entry.drawnData!==entry.data||entry.drawnReason!==reason){
        row.querySelector('.rs-text').textContent=entry.data.text;
        const author=row.querySelector('.rs-author');author.textContent='@'+entry.data.account;author.href='https://x.com/'+entry.data.account;
        row.querySelector('.rs-original').href=entry.data.url;
        row.querySelector('.rs-reason').textContent=reason==='parent_folded'?'随上级收起':'';
        row.querySelector('.rs-white').setAttribute('aria-label','总是保留 @'+entry.data.account);entry.drawnData=entry.data;entry.drawnReason=reason;
      }
      if(row.parentElement!==list)fragment.append(row);
    }
    list.append(fragment);
  }
  function process(article,data,id,boundaries) {
    if(!article.isConnected){authorReplies.delete(article);forget(article);return}
    if(!settings.enabled||!eligible(article,data,id,boundaries)){authorReplies.delete(article);forget(article);return}
    const entry=collected.get(data.id);
    if(entry&&(entry.data.text!==data.text||entry.data.modelKey!==data.modelKey||entry.data.account!==data.account)){entry.data=data;trayDirty=true}
    if(data.account===rootAccount)authorReplies.add(article);else authorReplies.delete(article);
    if(data.account===rootAccount&&!foldReason(data,0)){
      if(knownReplies.get(data.id)?.account!==data.account){remember(knownReplies,data.id,{account:data.account,score:0},2000);relationsDirty=true}
      forget(article);return;
    }
    let score=cache.get(data.modelKey);
    if(score===undefined){const start=performance.now();score=ReplyScorer.score(data.modelText);if(metrics.scores.length<5000)metrics.scores.push(performance.now()-start);remember(cache,data.modelKey,score,1000)}
    const previous=knownReplies.get(data.id);
    if(!previous||previous.score!==score||previous.account!==data.account){remember(knownReplies,data.id,{account:data.account,score},2000);relationsDirty=true}
    if(entry&&entry.score!==score){entry.score=score;trayDirty=true}
    if(!foldReason(data,score)){forget(article);return}
    // shortcut: keep further replies visible after 2,000 cached hits; add paging if this limit is reached in use.
    if(!entry&&collected.size>=2000){forget(article);return}
    if(!entry){collected.set(data.id,{data,score,row:null});metrics.processed++;trayDirty=true}
    hide(article,data);
  }
  function flush() {
    scheduled=false;if(dead)return;
    const start=performance.now(),id=rootId();
    if(route!==location.pathname){reset();route=location.pathname;scan();return}
    const primary=document.querySelector('[data-testid="primaryColumn"]');
    if(!rootNode?.isConnected){rootNode=[...(primary?.querySelectorAll('time')||[])].find(n=>own(n,n.closest('article'))&&new RegExp('/status/'+id+'(?:[/?]|$)').test(n.closest('a')?.getAttribute('href')||''))?.closest(ARTICLE)||null;if(rootNode)rootSeen=true}
    if(rootNode?.isConnected){
      const account=accountOf(rootNode);
      if(account&&account!==rootAccount){rootAccount=account;primary.querySelectorAll(ARTICLE).forEach(a=>pending.add(a))}
    }
    const boundaries=[...(primary?.querySelectorAll('h2,[role="heading"]')||[])].filter(n=>/^(发现更多|探索更多|更多帖子|相关帖子|为你推荐|Discover more|More posts|Related posts|You might like)$/i.test(n.textContent.trim()));
    if(boundaries.length)discoverySeen=true;
    const batch=[...pending].slice(0,6).map(article=>({article,data:extract(article)}));
    for(const {article,data} of batch){pending.delete(article);try{process(article,data,id,boundaries)}catch{forget(article)}if(performance.now()-start>=4)break}
    if(metrics.readyMs===null&&states.size)metrics.readyMs=performance.now()-metrics.started;
    for(const article of states.keys())if(!article.isConnected)forget(article);
    if(relationsDirty){relationsDirty=false;trayDirty=true;queueAuthors()}
    if(trayDirty||tray&&(!tray.isConnected||primary?.lastElementChild!==tray))syncTray();
    if(metrics.batches.length<5000)metrics.batches.push(performance.now()-start);
    if(pending.size)schedule();
  }
  function schedule(){if(!scheduled&&!dead){scheduled=true;setTimeout(flush,0)}}
  function scan(){if(rootId()&&settings.enabled){document.querySelectorAll('[data-testid="primaryColumn"] '+ARTICLE).forEach(a=>pending.add(a));schedule()}}
  function refresh(){if(!settings.enabled){reset();return}for(const [article,state] of states)if(!foldReason(state.data,collected.get(state.data.id)?.score||0))forget(article);trayDirty=true;syncTray();requestParents();scan()}
  window.addEventListener('message',event=>{
    const msg=event.data;
    if(dead||event.source!==window||event.origin!==location.origin||msg?.channel!=='liubai:parents:v1'||msg.path!==location.pathname||!Array.isArray(msg.pairs)||msg.pairs.length>4000)return;
    if(route!==location.pathname){reset();route=location.pathname;scan()}
    let changed=false;
    for(const pair of msg.pairs){
      if(!Array.isArray(pair)||pair.length!==2)continue;
      const [id,parent]=pair;
      if(typeof id!=='string'||typeof parent!=='string'||!/^\d{1,24}$/.test(id)||!/^\d{1,24}$/.test(parent)||BigInt(parent)>=BigInt(id))continue;
      if(parents.get(id)!==parent){remember(parents,id,parent,4000);changed=true}
    }
    if(changed){trayDirty=true;queueAuthors();schedule()}
  });
  const observer=new MutationObserver(records=>{
    if(!settings.enabled||!rootId())return;
    let rescan=false;
    for(const r of records){
      const node=r.target.nodeType===Node.ELEMENT_NODE?r.target:r.target.parentElement;
      if(node?.closest(HOST))continue;
      const changed=[...r.addedNodes,...r.removedNodes];
      if(changed.length&&changed.every(n=>n.nodeType===1&&n.matches(HOST)))continue;
      const article=node?.closest(ARTICLE),fields='[data-testid="tweetText"],[data-testid="User-Name"],time';
      if(article){if(node.closest(fields)||changed.some(n=>n.nodeType===1&&(n.matches(fields)||n.querySelector(fields))))pending.add(article)}
      else if(changed.some(n=>n.nodeType===1&&(n.matches(ARTICLE+',h2,[role="heading"]')||n.querySelector(ARTICLE+',h2,[role="heading"]'))))rescan=true;
    }
    if(rescan)scan();else if(pending.size)schedule();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  const themeObserver=new MutationObserver(recolor);
  for(const node of [document.documentElement,document.body])themeObserver.observe(node,{attributes:true,attributeFilter:['style','class']});
  const colorScheme=matchMedia('(prefers-color-scheme:dark)');colorScheme.addEventListener('change',recolor);
  // Poll only the route; X changes history without a full document navigation.
  const routeTimer=setInterval(()=>{if(route!==location.pathname){reset();route=location.pathname;scan()}},500);
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.settings){settings={...settings,...changes.settings.newValue};refresh()}});
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(sender.id===chrome.runtime.id&&msg?.type==='metrics')reply({...metrics,active:states.size,cacheSize:cache.size,threshold:settings.threshold,rootSeen,rootAccount})});
  function shutdown(){clearInterval(routeTimer);observer.disconnect();themeObserver.disconnect();colorScheme.removeEventListener('change',recolor);dead=true;reset()}
  window.addEventListener('pagehide',event=>{if(!event.persisted)shutdown()});
  window.addEventListener('pageshow',event=>{if(event.persisted)request({type:'get'}).then(result=>{settings=result.settings;refresh();recolor()}).catch(shutdown)});
  request({type:'get'}).then(result=>{settings=result.settings;route=location.pathname;requestParents();scan()}).catch(shutdown);
})();
