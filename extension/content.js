(() => {
  'use strict';
  const HOST='[data-rs-host]',ARTICLE='article[data-testid="tweet"]';
  const states=new Map(),pending=new Set(),cache=new Map(),expanded=new Map(),knownReplies=new Map();
  let settings={enabled:false,threshold:.30,whitelist:[]},route='',rootSeen=false,rootNode=null,rootAccount='',discoverySeen=false,scheduled=false,dead=false;
  const metrics={scores:[],batches:[],processed:0,started:performance.now(),readyMs:null};
  const owners=new WeakMap(),sizes=new ResizeObserver(entries=>{for(const entry of entries){const article=owners.get(entry.target);if(article?.isConnected)article.style.setProperty('--rs-toolbar-height',Math.ceil(entry.borderBoxSize?.[0]?.blockSize||entry.contentRect.height)+'px')}});

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
    if(!rootSeen||!rootAccount||data.account===rootAccount)return false;
    if(discoverySeen&&!boundaries.length&&!knownReplies.has(data.id))return false;
    if(boundaries.some(n=>n.compareDocumentPosition(article)&Node.DOCUMENT_POSITION_FOLLOWING))return false;
    return true;
  }
  function forget(article) {const old=states.get(article);if(old){sizes.unobserve(old.host);article.removeAttribute('data-rs-folded');article.removeAttribute('data-rs-managed');article.style.removeProperty('--rs-toolbar-height');article.style.removeProperty('--rs-original-bottom');old.host.remove();states.delete(article)}}
  function reset(){for(const a of states.keys())forget(a);pending.clear();knownReplies.clear();rootSeen=false;rootNode=null;rootAccount='';discoverySeen=false}
  function remember(map,key,value,limit){map.delete(key);map.set(key,value);if(map.size>limit)map.delete(map.keys().next().value)}
  function notice(state,text,error=false){const p=state.host.querySelector('.message');p.textContent=text;p.classList.toggle('error',error)}
  function palette() {
    let c=getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g);
    if(c?.length===4&&Number(c[3])===0)c=getComputedStyle(document.documentElement).backgroundColor.match(/[\d.]+/g);
    const dark=c?.length===4&&Number(c[3])===0?matchMedia('(prefers-color-scheme:dark)').matches:c&&c.length>=3&&(Number(c[0])+Number(c[1])+Number(c[2]))<360;
    return dark?['#a7b7c1','#7ccba0','#192a34','#15202b','#354450','#fa929a']:['#536471','#216746','#eff3f4','#fff','#eff3f4','#b6363e'];
  }
  function applyPalette(state,colors){['ink','accent','hover','bg','line','danger'].forEach((name,i)=>state.host.style.setProperty('--rs-'+name,colors[i]))}
  function recolor(){const colors=palette();for(const state of states.values())applyPalette(state,colors)}
  function make(article,data,score,colors,bottom) {
    const host=document.createElement('div');host.setAttribute('data-rs-host','');
    host.setAttribute('role','group');host.setAttribute('aria-label','留白回复操作');
    const controls=host;
    const bar=document.createElement('div');bar.className='bar';
    bar.innerHTML='<span class="summary"><svg class="mark" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 4h10M3 8h7M3 12h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span class="label"></span></span><span class="actions"><button class="toggle primary" type="button" role="button"></button><button class="feedback" type="button" role="button">不该折叠</button><button class="white" type="button" role="button" title="总是保留此账号" aria-label="加入白名单">保留账号</button></span><span class="message" role="status" aria-live="polite"></span>';
    controls.append(bar);article.style.setProperty('--rs-original-bottom',bottom);article.setAttribute('data-rs-managed','');article.append(host);owners.set(host,article);sizes.observe(host);
    const state={article,data,score,host,bar,feedback:false};states.set(article,state);
    applyPalette(state,colors);
    // Isolate gestures; mouse focus can move X replies, while keyboard focus stays available.
    for(const type of ['click','dblclick','auxclick','pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup'])host.addEventListener(type,event=>{event.stopPropagation();if(type==='pointerdown'&&event.pointerType==='mouse'&&event.target.closest('button'))event.preventDefault()});
    controls.querySelector('.toggle').onclick=()=>{remember(expanded,data.id,!expanded.get(data.id),1000);render(state)};
    controls.querySelector('.white').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{const result=await request({type:'white-add',account:data.account});settings=result.settings;refresh()}catch(error){notice(state,error.message,true)}finally{button.disabled=false}
    };
    controls.querySelector('.feedback').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{await request({type:'feedback',...data,score,threshold:settings.threshold});state.feedback=true;remember(expanded,data.id,true,1000);render(state);notice(state,'已展开，纠错记录仅保存在本机。')}catch(error){notice(state,error.message,true)}finally{button.disabled=state.feedback}
    };
    return state;
  }
  function render(state) {
    const {article,data,host,score,bar}=state,hit=score>=settings.threshold&&!settings.whitelist.includes(data.account);
    if(!hit){forget(article);return}
    const folded=!expanded.get(data.id);
    article.toggleAttribute('data-rs-folded',folded);bar.classList.toggle('unfolded',!folded);
    host.querySelector('.label').textContent=(folded?'已收起 @':'已展开 @')+data.account+' 的回复';
    const toggle=host.querySelector('.toggle');toggle.hidden=!hit;toggle.textContent=folded?'展开':'收起';toggle.setAttribute('aria-expanded',String(!folded));
    const feedback=host.querySelector('.feedback');feedback.hidden=!hit;feedback.textContent=state.feedback?'已记下':'不该折叠';feedback.disabled=state.feedback;
    const whiteButton=host.querySelector('.white');whiteButton.setAttribute('aria-label','总是保留 @'+data.account);whiteButton.title='总是保留 @'+data.account;
    host.setAttribute('data-rs-state',folded?'folded':'expanded');
  }
  function process(article,data,id,boundaries,colors,bottom) {
    if(!article.isConnected){forget(article);return}
    if(!settings.enabled||!eligible(article,data,id,boundaries)){forget(article);return}
    remember(knownReplies,data.id,true,2000);
    const old=states.get(article);
    // Visibility and link wrapping can change whitespace; keep the focused controls.
    if(old&&old.data.id===data.id&&old.data.modelKey===data.modelKey&&old.data.account===data.account&&old.host.isConnected){Object.assign(old.data,data);return}
    forget(article);
    let score=cache.get(data.modelKey);
    if(score===undefined){const start=performance.now();score=ReplyScorer.score(data.modelText);if(metrics.scores.length<5000)metrics.scores.push(performance.now()-start);remember(cache,data.modelKey,score,1000)}
    if(score<settings.threshold||settings.whitelist.includes(data.account))return;
    const state=make(article,data,score,colors,bottom);render(state);metrics.processed++;
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
    // Read a small batch before writing any controls, avoiding one layout per reply.
    const batch=[...pending].slice(0,6).map(article=>({article,data:extract(article),bottom:states.has(article)?article.style.getPropertyValue('--rs-original-bottom'):getComputedStyle(article).paddingBottom})),colors=palette();
    for(const {article,data,bottom} of batch){pending.delete(article);try{process(article,data,id,boundaries,colors,bottom)}catch{forget(article)}if(performance.now()-start>=4)break}
    if(metrics.batches.length<5000)metrics.batches.push(performance.now()-start);
    if(metrics.readyMs===null&&states.size)metrics.readyMs=performance.now()-metrics.started;
    for(const article of states.keys())if(!article.isConnected)forget(article);
    if(pending.size)schedule();
  }
  function schedule(){if(!scheduled&&!dead){scheduled=true;setTimeout(flush,0)}}
  function scan(){if(rootId()&&settings.enabled){document.querySelectorAll('[data-testid="primaryColumn"] '+ARTICLE).forEach(a=>pending.add(a));schedule()}}
  function refresh(){if(!settings.enabled){reset();return}for(const state of states.values())render(state);scan()}
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
  function shutdown(){clearInterval(routeTimer);observer.disconnect();themeObserver.disconnect();sizes.disconnect();colorScheme.removeEventListener('change',recolor);dead=true;reset()}
  window.addEventListener('pagehide',event=>{if(!event.persisted)shutdown()});
  window.addEventListener('pageshow',event=>{if(event.persisted)request({type:'get'}).then(result=>{settings=result.settings;refresh();recolor()}).catch(shutdown)});
  request({type:'get'}).then(result=>{settings=result.settings;route=location.pathname;scan()}).catch(shutdown);
})();
