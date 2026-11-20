/* The same character TF-IDF / logistic classifier, with no runtime dependency. */
(() => {
  'use strict';
  const model = globalThis.ReplyModelData;
  const ws = '[\\s\\u0085\\u001c-\\u001f]';
  const leading = new RegExp('^(?:'+ws+'*@[A-Za-z0-9_]{1,15})+'+ws+'*');
  const spaces = new RegExp(ws+'+', 'g');
  function clean(text) {
    return text.normalize('NFKC').replace(leading, '')
      .replace(/https?:\/\/t\.co\/[A-Za-z0-9]+/g, ' <URL> ')
      .replace(new RegExp('https?://[^\\s\\u0085\\u001c-\\u001f<>，。！？、；：“”‘’（）【】]+','g'), ' <URL> ')
      .replace(/@[A-Za-z0-9_]{1,15}/g, '<USER>').replace(spaces, ' ').trim().toLowerCase();
  }
  function score(text) {
    if (typeof text !== 'string') throw new TypeError('回复文本须为字符串');
    const chars = Array.from(clean(text)), counts = new Map();
    for (let n=1;n<=4;n++) for (let i=0;i<=chars.length-n;i++) {
      const term=chars.slice(i,i+n).join('');
      if (Object.hasOwn(model.vocabulary,term)) {
        const id=model.vocabulary[term]; counts.set(id,(counts.get(id)||0)+1);
      }
    }
    let square=0,dot=0;
    for (const [id,count] of counts) {
      const value=(1+Math.log(count))*model.idf[id];
      square+=value*value; dot+=value*model.weights[id];
    }
    const logit=model.intercept+(square ? dot/Math.sqrt(square) : 0);
    return 1/(1+Math.exp(-logit));
  }
  globalThis.ReplyScorer={score,clean,sourceHash:model.source_sha256};
  if(typeof module!=='undefined') module.exports=globalThis.ReplyScorer;
})();
