/* Response-reader contract: no extra requests, unchanged responses, ID-only replay. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const listeners={},posts=[],calls=[],origin='https://x.com',pathname='/author/status/1000';
let payload={data:{tweets:[{rest_id:'1007',legacy:{in_reply_to_status_id_str:'1001',full_text:'private body'}},{rest_id:'1008',legacy:{in_reply_to_status_id_str:'1008'}},{rest_id:'1009',legacy:{in_reply_to_status_id_str:1001}}]}};
const response={ok:true,clone(){return {text:async()=>JSON.stringify(payload)}}};
class XHR {
 open(...args){this.args=args}send(){this.status=200;this.responseType='';this.responseText=JSON.stringify(payload);this.onload()}
 addEventListener(type,callback){if(type==='load')this.onload=callback}
}
const window={fetch:async(...args)=>{calls.push(args);return response},postMessage:(message,target)=>posts.push({message,target}),addEventListener:(type,fn)=>listeners[type]=fn};
const context={window,location:{origin,pathname,href:origin+pathname},XMLHttpRequest:XHR,URL};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/parents.js'),'utf8'),context);
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const input=new URL(origin+'/i/api/graphql/hash/TweetDetail'),init={headers:{authorization:'not-to-be-published'}};
 assert.equal(await window.fetch(input,init),response);await tick();
 assert.equal(calls.length,1);assert.equal(calls[0][0],input);assert.equal(calls[0][1],init);
 const expected={channel:'liubai:parents:v1',path:pathname,pairs:[['1007','1001']]};
 assert.deepEqual(JSON.parse(JSON.stringify(posts[0].message)),expected);assert.equal(posts[0].target,origin);
 posts.length=0;listeners.message({source:window,origin,data:{channel:expected.channel,request:true,path:pathname}});
 assert.deepEqual(JSON.parse(JSON.stringify(posts[0].message)),expected,'early response can be replayed after the content script starts');
 posts.length=0;listeners.message({source:{},origin,data:{channel:expected.channel,request:true,path:pathname}});assert.equal(posts.length,0);
 payload={rest_id:'1010',legacy:{in_reply_to_status_id_str:'1001',full_text:'another private body'}};
 const xhr=new XHR();xhr.open('GET',String(input));xhr.send();assert.equal(xhr.responseText,JSON.stringify(payload));assert.equal(posts[0].message.pairs[0][0],'1010');
 assert.ok(!JSON.stringify(posts).includes('private body'));assert.ok(!JSON.stringify(posts).includes('authorization'));
 posts.length=0;await window.fetch(origin+'/i/api/graphql/hash/OtherOperation');await tick();assert.equal(posts.length,0);
 payload='{invalid JSON';response.clone=()=>({text:async()=>payload});assert.equal(await window.fetch(input),response);await tick();assert.equal(posts.length,0);
 console.log('PASS parent bridge: response identity, exact ID extraction, early replay, XHR, invalid data and operation isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
