// Generates the "Send to Beyond-Papers" bookmarklet.
//
// Why a bookmarklet (not server-side fetching): share links on claude.ai / chatgpt.com /
// gemini sit behind Cloudflare bot protection that blocks datacenter IPs, and their ToS
// forbids circumventing it. The bookmarklet sidesteps all of that by running in the user's
// OWN browser, on a page they're already viewing — it reads the rendered conversation from
// the DOM (no scraping service, no proxy, no ToS violation) and hands it to our import
// receiver via postMessage. Nothing is uploaded until the user reviews and submits.
//
// Transport: the injected code opens {origin}/chats/import, waits for that page to post
// a 'beyond-papers-ready' handshake back to the opener, then posts the captured payload to
// it (targeted at our exact origin, so the transcript is only ever delivered to us).

const MAX_TRANSCRIPT = 500_000; // mirrors the server's per-chat cap

/** The raw source of the injected IIFE, with the app origin baked in. Kept readable here;
 *  callers wrap it into a `javascript:` URL via {@link bookmarkletHref}. */
export function bookmarkletSource(origin: string): string {
  // `origin` is JSON-encoded so it can't break out of the string literal.
  const O = JSON.stringify(origin);
  const MAX = String(MAX_TRANSCRIPT);
  return `(function(){
var O=${O};
var h=location.hostname;
var p=/claude\\.ai/.test(h)?'claude':(/chatgpt\\.com|chat\\.openai\\.com/.test(h)?'chatgpt':(/gemini\\.google\\.com/.test(h)?'gemini':'other'));
function ex(){
try{
if(p==='chatgpt'){var n=document.querySelectorAll('[data-message-author-role]');if(n.length)return Array.prototype.map.call(n,function(e){return (e.getAttribute('data-message-author-role')+': '+e.innerText).trim();}).join('\\n\\n');}
if(p==='claude'){var c=document.querySelectorAll('[data-testid="user-message"],.font-claude-message,[data-testid="chat-message"]');if(c.length)return Array.prototype.map.call(c,function(e){return e.innerText.trim();}).join('\\n\\n');}
}catch(err){}
return document.body.innerText;
}
var t=(ex()||'').slice(0,${MAX});
if(t.trim().length<40){alert('Beyond-Papers: could not read a conversation on this page.');return;}
var payload={type:'beyond-papers-chat',platform:p,title:(document.title||'').slice(0,200),url:location.href,transcript:t};
var w=window.open(O+'/chats/import','_blank');
if(!w){alert('Beyond-Papers: allow pop-ups for this site, then click the bookmarklet again.');return;}
function onmsg(e){if(e.origin!==O)return;if(e.data&&e.data.type==='beyond-papers-ready'){w.postMessage(payload,O);window.removeEventListener('message',onmsg);}}
window.addEventListener('message',onmsg);
})();`;
}

/** The full `javascript:` href to put on an <a> for drag-to-bookmarks-bar. */
export function bookmarkletHref(origin: string): string {
  return 'javascript:' + encodeURIComponent(bookmarkletSource(origin));
}
