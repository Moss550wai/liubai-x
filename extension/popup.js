'use strict';
const $=id=>document.getElementById(id);
let current,saveTimer;
async function request(message){const result=await chrome.runtime.sendMessage(message);if(!result?.ok)throw Error(result?.error||'无法连接插件，请重新打开面板');return result}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error)}
function strength(threshold) {
  const presets=[{t:0.7304868345052445,name:'保守',caption:'少打扰，收起最明显的模板回复。'},{t:.45,name:'标准',caption:'过滤模板感，留一点余地。'},{t:.30,name:'激进',caption:'多收起一些，想看再展开。'}];
  const preset=presets.find(p=>Math.abs(p.t-threshold)<1e-8);
  $('strength-name').textContent=preset?.name||'自定义';
  $('strength-caption').textContent=preset?.caption||'已微调强度，越往右折叠越多。';
  document.querySelectorAll('[data-threshold]').forEach(b=>b.setAttribute('aria-pressed',String(Math.abs(Number(b.dataset.threshold)-threshold)<1e-8)));
  $('intensity').value=String(Math.round((1-threshold)*100));
}
function render(result){
  current=result.settings;document.body.classList.toggle('paused',!current.enabled);$('enabled').checked=current.enabled;$('status-text').textContent=current.enabled?'已启用':'已暂停';strength(current.threshold);
  $('feedback-count').textContent=result.feedbackCount;$('white-count').textContent=current.whitelist.length;
  const list=$('white-list');list.replaceChildren();
  if(!current.whitelist.length){const p=document.createElement('p');p.className='empty';p.textContent='展开底部回复后，也可一键保留账号。';list.append(p)}
  for(const account of current.whitelist){
    const row=document.createElement('div'),name=document.createElement('span'),remove=document.createElement('button');row.className='white-row';name.textContent='@'+account;remove.textContent='移除';remove.setAttribute('aria-label','移除 @'+account+' 的白名单');
    remove.onclick=()=>mutate({type:'white-remove',account},'已移出白名单');row.append(name,remove);list.append(row);
  }
}
async function mutate(data,notice='已保存'){
  try{render(await request(data));message(notice);return true}catch(error){message(error.message,true);return false}
}
$('enabled').onchange=()=>mutate({type:'settings',patch:{enabled:$('enabled').checked}},$('enabled').checked?'已启用':'已暂停，所有回复恢复显示');
document.querySelectorAll('[data-threshold]').forEach(button=>button.onclick=()=>{clearTimeout(saveTimer);mutate({type:'settings',patch:{threshold:Number(button.dataset.threshold)}})});
$('intensity').oninput=()=>{const threshold=(100-Number($('intensity').value))/100;strength(threshold);clearTimeout(saveTimer);saveTimer=setTimeout(()=>mutate({type:'settings',patch:{threshold}}),180)};
$('intensity').onchange=()=>{clearTimeout(saveTimer);mutate({type:'settings',patch:{threshold:(100-Number($('intensity').value))/100}})};
$('white-form').onsubmit=async event=>{event.preventDefault();if(await mutate({type:'white-add',account:$('account').value},'已加入白名单'))$('account').value=''};
$('export').onclick=async()=>{
  try{
    const data=await request({type:'export'});delete data.ok;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');
    link.href=url;link.download='reply-sieve-feedback-'+new Date().toISOString().slice(0,10)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);message('已导出反馈与设置');
  }catch(error){message(error.message,true)}
};
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.settings||changes.feedback))request({type:'get'}).then(render).catch(error=>message(error.message,true))});
request({type:'get'}).then(render).catch(error=>message(error.message,true));
