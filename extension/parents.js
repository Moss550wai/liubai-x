(() => {
  'use strict';
  const channel='liubai:parents:v1',parents=new Map(),valid=id=>typeof id==='string'&&/^\d{1,24}$/.test(id);
  function publish(pairs) {if(pairs.length)window.postMessage({channel,path:location.pathname,pairs:pairs.slice(-4000)},location.origin)}
  function read(payload) {
    const pairs=[],stack=[[payload,0]];let visited=0;
    while(stack.length&&visited++<50000) {
      const [value,depth]=stack.pop();if(!value||typeof value!=='object'||depth>90)continue;
      const id=value.rest_id,parent=value.legacy?.in_reply_to_status_id_str;
      if(valid(id)&&valid(parent)&&BigInt(parent)<BigInt(id)&&parents.get(id)!==parent) {
        parents.delete(id);parents.set(id,parent);if(parents.size>4000)parents.delete(parents.keys().next().value);pairs.push([id,parent]);
      }
      for(const child of Object.values(value))if(child&&typeof child==='object')stack.push([child,depth+1]);
    }
    publish(pairs);
  }
  function isThread(url) {try{const u=new URL(url,location.href);return u.origin===location.origin&&/\/i\/api\/graphql\/[^/]+\/TweetDetail$/.test(u.pathname)}catch{return false}}
  function readText(text) {if(typeof text==='string'&&text.length<=4000000){try{read(JSON.parse(text))}catch{}}}
  // Read only responses already requested by X; never pass bodies, headers or credentials to the extension.
  const originalFetch=window.fetch;
  window.fetch=async function(...args) {
    const response=await originalFetch.apply(this,args);
    try{if(response.ok&&isThread(typeof args[0]==='string'?args[0]:args[0]?.url||args[0]?.href))response.clone().text().then(readText).catch(()=>{})}catch{}
    return response;
  };
  const urls=new WeakMap(),open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,String(url));return open.call(this,method,url,...rest)};
  XMLHttpRequest.prototype.send=function(...args) {
    this.addEventListener('load',()=>{if(this.status!==200||!isThread(urls.get(this)))return;try{if(this.responseType==='json')read(this.response);else readText(this.responseText)}catch{}},{once:true});
    return send.apply(this,args);
  };
  window.addEventListener('message',event=>{
    if(event.source===window&&event.origin===location.origin&&event.data?.channel===channel&&event.data.request===true&&event.data.path===location.pathname)publish([...parents]);
  });
})();
