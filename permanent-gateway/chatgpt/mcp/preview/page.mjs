// Only the canonical, validated opaque link is interpolated. This public
// handoff deliberately does not look up a job or assert that it exists.
import {gatewayOrigin} from '../consent-policy.mjs';
import {assets} from '../consent-assets.mjs';
export const previewSecurity={
 'Cache-Control':'no-store',
 'X-Content-Type-Options':'nosniff',
 'X-Frame-Options':'DENY',
 'Referrer-Policy':'no-referrer',
 'X-Robots-Tag':'noindex, nofollow, noarchive',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function previewPage(job){
 if(!uuid.test(job))throw Error('Invalid preview identifier');
 const url=gatewayOrigin+'/artifacts/'+job;
 return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>AgentSystems — Animation preview</title><link rel="stylesheet" href="/preview/style.css"><script type="module" src="/preview/client.js"></script></head>
<body><main><header>AgentSystems</header><article aria-labelledby="preview-title">
<h1 id="preview-title">Continue on your Android phone</h1>
<p>This animation link opens the AgentSystems app on an authorized Android device.</p>
<canvas id="preview-qr" hidden role="img" aria-label="QR code for the animation preview link"></canvas>
<p id="scan-help" hidden>Scan this code using your phone’s camera.</p>
<label for="preview-url">Preview link</label><input id="preview-url" type="url" readonly value="${url}" autocomplete="off" spellcheck="false">
<button id="copy-link" type="button" hidden>Copy preview link</button>
<p id="copy-status" role="status" aria-live="polite"></p>
<details><summary>Already on Android?</summary><p>Open the link from ChatGPT or another app. If it stays in the browser, check that AgentSystems is installed and allowed to open supported links in Android app settings. Use a connected, authorized device.</p></details>
<noscript><p>Copy the preview link and open it on your Android phone.</p></noscript>
</article><footer>Private media stays protected. Browser playback is not available yet.</footer></main></body></html>`,
 {headers:{...previewSecurity,'Content-Type':'text/html; charset=utf-8'}});
}
export function previewAsset(path,method,search){
 if(path!=='/preview/client.js'&&path!=='/preview/style.css')return null;
 if(method!=='GET'||search)return new Response(null,{status:404,headers:previewSecurity});
 const js=path.endsWith('.js');
 return new Response(js?assets.previewJs:assets.previewCss,{headers:{...previewSecurity,'Content-Type':js?'application/javascript; charset=utf-8':'text/css; charset=utf-8'}});
}
