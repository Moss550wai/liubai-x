'use strict';
const DEFAULTS={enabled:true,threshold:0.30,whitelist:[]};
let queue=Promise.resolve();
const normalizeHandle=value=>String(value||'').trim().replace(/^@/,'').toLowerCase();
function handle(value) {
  const result=normalizeHandle(value);
  if(!/^[a-z0-9_]{1,15}$/.test(result))throw Error('请输入有效的 X 用户名（不是显示名或链接）');
  return result;
}
async function state() {
  const {settings={},feedback=[]}=await chrome.storage.local.get(['settings','feedback']);
  return {settings:{...DEFAULTS,...settings},feedbackCount:feedback.length};
}
async function receive(message,sender) {
  if(sender.id!==chrome.runtime.id)throw Error('来源无效');
  const ownPage=sender.url?.startsWith(chrome.runtime.getURL(''));
  const xPage=/^https:\/\/(x\.com|twitter\.com)\//.test(sender.url||'');
  if(!ownPage&&!xPage)throw Error('页面无效');
  if(message.type==='get')return state();
  if(message.type==='export'&&ownPage) {
    const {settings}=await state(),{feedback=[]}=await chrome.storage.local.get('feedback');
    return {format:'reply-sieve-feedback-v1',exportedAt:new Date().toISOString(),settings,feedback};
  }
  if(message.type==='settings'&&ownPage) {
    const current=await state(),patch=message.patch||{};
    if(Object.keys(patch).some(k=>!['enabled','threshold'].includes(k)))throw Error('未知设置');
    if('enabled'in patch&&typeof patch.enabled!=='boolean')throw Error('开关无效');
    if('threshold'in patch&&(!Number.isFinite(patch.threshold)||patch.threshold<0.05||patch.threshold>0.95))throw Error('强度无效');
    await chrome.storage.local.set({settings:{...current.settings,...patch}});return state();
  }
  if(message.type==='white-add'||message.type==='white-remove') {
    const account=handle(message.account),current=await state();
    const whitelist=current.settings.whitelist.filter(v=>v!==account);
    if(message.type==='white-add')whitelist.push(account);
    await chrome.storage.local.set({settings:{...current.settings,whitelist}});return state();
  }
  if(message.type==='feedback'&&xPage) {
    const account=handle(message.account);
    if(typeof message.text!=='string'||!message.text.trim()||message.text.length>100000)throw Error('回复文本无效');
    if(!Number.isFinite(message.score)||message.score<0||message.score>1||!Number.isFinite(message.threshold)||message.threshold<.05||message.threshold>.95)throw Error('模型记录无效');
    let url;
    try{url=new URL(message.url)}catch{throw Error('回复链接无效')}
    if(!['x.com','twitter.com'].includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||!new RegExp('^/'+account+'/status/\\d+$','i').test(url.pathname))throw Error('回复账号与链接不一致');
    const {feedback=[]}=await chrome.storage.local.get('feedback');
    const key=url.origin+url.pathname;
    if(!feedback.some(f=>f.url===key&&f.label==='保留'&&f.text===message.text)) {
      feedback.push({id:crypto.randomUUID(),createdAt:new Date().toISOString(),text:message.text,account,url:key,label:'保留',modelScore:message.score,threshold:message.threshold});
      try{await chrome.storage.local.set({feedback})}catch{throw Error('保存失败：请先导出反馈，检查浏览器存储空间')}
    }
    return state();
  }
  throw Error('不支持的操作');
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(!message||!['get','export','settings','white-add','white-remove','feedback'].includes(message.type))return false;
  const job=queue.then(()=>receive(message,sender));queue=job.catch(()=>{});
  job.then(data=>reply({ok:true,...data}),error=>reply({ok:false,error:error.message}));return true;
});
