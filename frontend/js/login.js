/* ISO/IEC 27001:2022 A.8.28: secure-coding guidance considered; no compliance certification is implied. */
'use strict';
const form=document.querySelector('#loginForm'),button=document.querySelector('#submitBtn'),error=document.querySelector('#error');
const credentialsStep=document.querySelector('#credentialsStep'),otpStep=document.querySelector('#otpStep');
const verifyOtpBtn=document.querySelector('#verifyOtpBtn'),backBtn=document.querySelector('#backBtn');
const stepTitle=document.querySelector('#stepTitle'),stepIntro=document.querySelector('#stepIntro');
const requestedReturnTo=(()=>{const raw=new URLSearchParams(location.search).get('returnTo');if(!raw||!raw.startsWith('/')||raw.startsWith('//'))return null;try{const u=new URL(raw,location.origin);return u.origin===location.origin?u.pathname+u.search+u.hash:null}catch{return null}})();
let turnstileWidget=null,turnstileToken='',challengeId='',turnstileReady=false,turnstileLoading=false;
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
  const r=await fetch('/api/auth/config',{credentials:'same-origin',cache:'no-store'});
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
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({identifier:form.elements.identifier.value,password:form.elements.password.value,turnstileToken:token})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'Unable to sign in');
  if(!d.emailOtpRequired||!d.challengeId)throw new Error('The email verification step could not be started. Please try again.');
  challengeId=d.challengeId;credentialsStep.hidden=true;otpStep.hidden=false;stepTitle.textContent='Check your email';stepIntro.textContent='One more step to secure your account';
  document.querySelector('#otpCode').focus();
  document.querySelector('#otpHint').textContent='A six-digit verification code was sent to '+(d.emailHint||'your registered email address')+'. It expires in 10 minutes.';
 }catch(e){
  showError(e.message||'Unable to sign in.');
  resetTurnstile();
 }finally{
  if(!otpStep.hidden){button.disabled=true}
  else if(turnstileReady){button.disabled=false;button.textContent='Continue'}
 }
});
verifyOtpBtn.addEventListener('click',async()=>{
 showError('');
 const code=document.querySelector('#otpCode').value.trim();
 if(!/^\d{6}$/.test(code)){showError('Enter the six-digit code from your email.');return}
 setBusy(verifyOtpBtn,true,'Verify and sign in');
 try{
  const r=await fetch('/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'verify',challengeId,method:'email_otp',code})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.error||'The verification code could not be accepted');
  location.replace(requestedReturnTo||(d.user.role==='employee'?'employee.html':'index.html'));
 }catch(e){showError(e.message||'Unable to verify the code.');setBusy(verifyOtpBtn,false,'Verify and sign in')}
});
backBtn.addEventListener('click',()=>{
 challengeId='';otpStep.hidden=true;credentialsStep.hidden=false;stepTitle.textContent='Welcome back';stepIntro.textContent='Sign in to your workspace';
 document.querySelector('#otpCode').value='';showError('');resetTurnstile();
});
document.querySelector('#otpCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();verifyOtpBtn.click()}});
