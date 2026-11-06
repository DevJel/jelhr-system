/* ISO/IEC 27001:2022 A.8.28: secure-coding guidance considered; no compliance certification is implied. */
'use strict';
const form=document.querySelector('#loginForm'),button=document.querySelector('#submitBtn'),error=document.querySelector('#error');
const credentialsStep=document.querySelector('#credentialsStep'),otpStep=document.querySelector('#otpStep');
const verifyOtpBtn=document.querySelector('#verifyOtpBtn'),backBtn=document.querySelector('#backBtn');
const stepTitle=document.querySelector('#stepTitle'),stepIntro=document.querySelector('#stepIntro');
const requestedReturnTo=(()=>{const raw=new URLSearchParams(location.search).get('returnTo');if(!raw||!raw.startsWith('/')||raw.startsWith('//'))return null;try{const u=new URL(raw,location.origin);return u.origin===location.origin?u.pathname+u.search+u.hash:null}catch{return null}})();
let turnstileWidget=null,turnstileToken='',challengeId='',turnstileReady=false,turnstileLoading=false;
const workspaceField=document.querySelector('#workspace'),ssoLink=document.querySelector('#ssoLink');
async function loadWorkspaceOptions(){const ws=workspaceField.value.trim();if(!ws){ssoLink.hidden=true;return}try{const r=await fetch('/api/auth/options?workspace='+encodeURIComponent(ws),{cache:'no-store'}),d=await r.json();ssoLink.hidden=!(d.found&&d.sso&&d.sso.enabled);ssoLink.href='/api/auth/sso/start?workspace='+encodeURIComponent(ws)}catch{ssoLink.hidden=true}}
workspaceField.addEventListener('change',loadWorkspaceOptions);workspaceField.addEventListener('blur',loadWorkspaceOptions);
function showError(message){error.textContent=message||''}
function setBusy(control,busy,label){control.disabled=busy;control.textContent=busy?'Please wait…':label}
function setTurnstileState(ready,label){
 turnstileReady=ready;
 button.disabled=!ready;
 button.textContent=label||(ready?'Continue':'Complete security check');
}
function resetTurnstile(){
 turnstileToken='';
 setTurnstileState(false,'Complete security check again');
 if(window.turnstile&&turnstileWidget!==null)window.turnstile.reset(turnstileWidget);
}
function loadTurnstile(siteKey){
 if(!siteKey){showError('Security verification is not configured. Please contact your administrator.');setTurnstileState(false,'Security check unavailable');return}
 if(turnstileLoading||turnstileWidget!==null)return;
 turnstileLoading=true;
 const script=document.createElement('script');
 script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
 script.async=true;script.defer=true;
 script.onload=()=>{
  turnstileLoading=false;
  if(!window.turnstile){showError('Security verification could not initialize. Refresh and try again.');setTurnstileState(false,'Security check unavailable');return}
  try{
   turnstileWidget=window.turnstile.render('#turnstileWidget',{
    sitekey:siteKey,theme:'auto',action:'login',size:'flexible',
    callback:token=>{turnstileToken=token;showError('');setTurnstileState(true,'Continue')},
    'expired-callback':()=>{turnstileToken='';setTurnstileState(false,'Complete security check again')},
    'error-callback':()=>{turnstileToken='';setTurnstileState(false,'Security check unavailable');showError('Security verification could not load. Refresh and try again.')}
   });
  }catch{
   showError('Security verification could not be displayed. Refresh and try again.');
   setTurnstileState(false,'Security check unavailable');
  }
 };
 script.onerror=()=>{turnstileLoading=false;showError('Unable to load Cloudflare Turnstile. Check your connection and refresh.');setTurnstileState(false,'Security check unavailable')};
 document.head.appendChild(script);
}
(async()=>{
 const fallbackSiteKey='0x4AAAAAAF0JVFRrhPXqt914';
 let siteKey=fallbackSiteKey;
 try{
  const r=await fetch('/api/bff/auth/config',{credentials:'same-origin',cache:'no-store'});
  const d=await r.json().catch(()=>({}));
  if(r.ok&&d.turnstileSiteKey)siteKey=d.turnstileSiteKey;
  else console.warn('Using the configured public Turnstile site key fallback.');
 }catch(e){
  console.warn('Turnstile config endpoint unavailable; using the public site key fallback.',e);
 }
 loadTurnstile(siteKey);
})();
form.addEventListener('submit',async event=>{
 event.preventDefault();showError('');
 if(!turnstileToken||!turnstileReady){showError('Complete the Cloudflare security verification first.');return}
 const token=turnstileToken;
 setBusy(button,true,'Continue');
 try{
  const r=await fetch('/api/bff/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({identifier:form.elements.identifier.value,workspace:form.elements.workspace.value,password:form.elements.password.value,turnstileToken:token})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Unable to sign in');
  if(d.user){location.replace(requestedReturnTo||(d.user.role==='employee'?'employee.html':'index.html'));return}
  if(!d.mfaRequired||!d.challengeId)throw new Error('The next sign-in step could not be started. Please try again.');
  challengeId=d.challengeId;credentialsStep.hidden=true;otpStep.hidden=false;stepTitle.textContent='Verify your identity';stepIntro.textContent='Complete the verification method required by your workspace';
  methodSelect.innerHTML=(d.methods||[]).map(m=>'<option value="'+m+'">'+({email_otp:'Email code',totp:'Authenticator app',passkey:'Passkey'}[m]||m)+'</option>').join('');
  if(d.bootstrap&&d.methods.includes('email_otp'))methodSelect.value='email_otp';else if(d.methods.includes('totp'))methodSelect.value='totp';
  await prepareMfaMethod();
 }catch(e){
  showError(e.message||'Unable to sign in.');
  resetTurnstile();
 }finally{
  if(!otpStep.hidden){button.disabled=true}
  else if(turnstileReady){button.disabled=false;button.textContent='Continue'}
 }
});
const methodSelect=document.querySelector('#mfaMethod'),otpCode=document.querySelector('#otpCode'),otpLabel=document.querySelector('#otpLabel'),otpHint=document.querySelector('#otpHint');
async function prepareMfaMethod(){
 const method=methodSelect.value;
 otpCode.hidden=method==='passkey';otpLabel.hidden=method==='passkey';
 if(method==='email_otp'){
  otpLabel.textContent='Email verification code';
  const r=await fetch('/api/bff/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'email',challengeId})});
  const d=await r.json().catch(()=>({}));if(!r.ok||!d.sent)throw new Error(d.error||'Unable to send the email code');
  otpHint.textContent='A six-digit code was sent to your registered email. It expires in 10 minutes.';
 }else if(method==='totp'){otpLabel.textContent='Authenticator code';otpHint.textContent='Enter the current six-digit code from your authenticator app.'}
 else{otpHint.textContent='Use your device PIN, fingerprint or face recognition to verify your passkey.'}
}
methodSelect.addEventListener('change',()=>prepareMfaMethod().catch(e=>showError(e.message)));
verifyOtpBtn.addEventListener('click',async()=>{
 showError('');
 const method=methodSelect.value,code=otpCode.value.trim();
 if(method!=='passkey'&&!/^\d{6}$/.test(code)){showError('Enter the six-digit verification code.');return}
 setBusy(verifyOtpBtn,true,'Verifying…');
 try{
  let credential=null;
  if(method==='passkey'){
   if(!navigator.credentials||!window.PublicKeyCredential)throw new Error('Passkeys are not supported by this browser.');
   const o=await fetch('/api/bff/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'passkey_options',challengeId})});
   const opts=await o.json();if(!o.ok)throw new Error(opts.error||'Unable to start passkey verification');
   const fromB64=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
   const toB64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
   const pk=opts.publicKey;pk.challenge=fromB64(pk.challenge);pk.allowCredentials=(pk.allowCredentials||[]).map(x=>({...x,id:fromB64(x.id)}));
   const c=await navigator.credentials.get({publicKey:pk});
   credential={id:c.id,rawId:toB64(c.rawId),type:c.type,clientDataJSON:toB64(c.response.clientDataJSON),authenticatorData:toB64(c.response.authenticatorData),signature:toB64(c.response.signature),userHandle:c.response.userHandle?toB64(c.response.userHandle):null};
  }
  const r=await fetch('/api/bff/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'verify',challengeId,method,code:method==='passkey'?undefined:code,credential})});
  const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Verification failed');
  location.replace(requestedReturnTo||(d.mfaEnrollmentRequired?'security-v04.html':d.user.role==='employee'?'employee.html':'index.html'));
 }catch(e){showError(e.message||'Unable to verify.');}
 finally{setBusy(verifyOtpBtn,false,'Verify and sign in')}
});
backBtn.addEventListener('click',()=>{
 challengeId='';otpStep.hidden=true;credentialsStep.hidden=false;stepTitle.textContent='Welcome back';stepIntro.textContent='Sign in to your workspace';
 document.querySelector('#otpCode').value='';showError('');resetTurnstile();
});
document.querySelector('#otpCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();verifyOtpBtn.click()}});

const passkeyLoginBtn=document.querySelector('#passkeyBtn');
function fromB64url(s){return Uint8Array.from(atob(String(s).replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((String(s).length+3)%4)),c=>c.charCodeAt(0))}
function toB64url(b){return btoa(String.fromCharCode(...new Uint8Array(b))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
passkeyLoginBtn.addEventListener('click',async()=>{
 showError('');
 if(!window.PublicKeyCredential||!navigator.credentials){showError('This browser does not support passkeys.');return}
 setBusy(passkeyLoginBtn,true,'Waiting for your passkey…');
 try{
  const o=await fetch('/api/auth/passkey',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'options'})});
  const d=await o.json().catch(()=>({}));
  if(!o.ok)throw new Error(d.error||'Passkey sign-in is unavailable');
  const p=d.publicKey;p.challenge=fromB64url(p.challenge);p.allowCredentials=(p.allowCredentials||[]).map(x=>({...x,id:fromB64url(x.id)}));
  const c=await navigator.credentials.get({publicKey:p});
  const credential={id:c.id,rawId:toB64url(c.rawId),type:c.type,clientDataJSON:toB64url(c.response.clientDataJSON),authenticatorData:toB64url(c.response.authenticatorData),signature:toB64url(c.response.signature),userHandle:c.response.userHandle?toB64url(c.response.userHandle):null};
  const v=await fetch('/api/auth/passkey',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'verify',challengeId:d.challengeId,credential})});
  const result=await v.json().catch(()=>({}));
  if(!v.ok)throw new Error(result.error||'Passkey verification failed');
  location.replace(requestedReturnTo||(result.user&&result.user.role==='employee'?'employee.html':'index.html'));
 }catch(e){showError(e.message||'Passkey sign-in failed.');}
 finally{setBusy(passkeyLoginBtn,false,'Sign in with a passkey')}
});
