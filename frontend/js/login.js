/* ISO/IEC 27001:2022 A.8.28: secure-coding guidance considered; no compliance certification is implied. */
'use strict';
const form=document.querySelector('#loginForm'),button=document.querySelector('#submitBtn'),error=document.querySelector('#error');
const credentialsStep=document.querySelector('#credentialsStep'),otpStep=document.querySelector('#otpStep');
const verifyOtpBtn=document.querySelector('#verifyOtpBtn'),backBtn=document.querySelector('#backBtn');
const stepTitle=document.querySelector('#stepTitle'),stepIntro=document.querySelector('#stepIntro');
let turnstileWidget=null,turnstileToken='',challengeId='',turnstileReady=false;
function showError(message){error.textContent=message||''}
function setBusy(control,busy,label){control.disabled=busy;control.textContent=busy?'Please wait…':label}
function loadTurnstile(siteKey){
 if(!siteKey){showError('Security verification is not configured. Please contact your administrator.');return}
 const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;
 script.onload=()=>{turnstileWidget=window.turnstile.render('#turnstileWidget',{sitekey:siteKey,theme:'auto',callback:token=>{turnstileToken=token;turnstileReady=true;button.disabled=false;button.textContent='Continue'},'expired-callback':()=>{turnstileToken='';turnstileReady=false;button.disabled=true;button.textContent='Complete security check again'},'error-callback':()=>{turnstileToken='';turnstileReady=false;button.disabled=true;showError('Security verification could not load. Refresh and try again.')}})};
 script.onerror=()=>showError('Unable to load the security verification service. Check your connection and refresh.');document.head.appendChild(script);
}
(async()=>{try{const r=await fetch('/api/auth/config',{credentials:'same-origin',cache:'no-store'}),d=await r.json();if(!r.ok||!d.turnstileSiteKey)throw new Error();loadTurnstile(d.turnstileSiteKey)}catch{showError('Security verification is not configured. Please contact your administrator.')}})();
form.addEventListener('submit',async event=>{
 event.preventDefault();showError('');if(!turnstileToken){showError('Complete the security verification first.');return}setBusy(button,true,'Continue');
 try{
  const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({identifier:form.elements.identifier.value,password:form.elements.password.value,turnstileToken})}),d=await r.json();
  if(!r.ok)throw new Error(d.error||'Unable to sign in');if(!d.emailOtpRequired||!d.challengeId)throw new Error('The email verification step could not be started. Please try again.');
  challengeId=d.challengeId;credentialsStep.hidden=true;otpStep.hidden=false;stepTitle.textContent='Check your email';stepIntro.textContent='One more step to secure your account';document.querySelector('#otpCode').focus();
  document.querySelector('#otpHint').textContent='A six-digit verification code was sent to '+(d.emailHint||'your registered email address')+'. It expires in 10 minutes.';
 }catch(e){showError(e.message||'Unable to sign in.');if(window.turnstile&&turnstileWidget!==null){window.turnstile.reset(turnstileWidget);turnstileToken='';turnstileReady=false;button.disabled=true;button.textContent='Complete security check'}}
 finally{if(!otpStep.hidden){button.disabled=true}else if(turnstileReady){button.disabled=false;button.textContent='Continue'}}
});
verifyOtpBtn.addEventListener('click',async()=>{
 showError('');const code=document.querySelector('#otpCode').value.trim();if(!/^\d{6}$/.test(code)){showError('Enter the six-digit code from your email.');return}setBusy(verifyOtpBtn,true,'Verify and sign in');
 try{const r=await fetch('/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({action:'verify',challengeId,method:'email_otp',code})}),d=await r.json();if(!r.ok)throw new Error(d.error||'The verification code could not be accepted');location.replace(d.user.role==='employee'?'employee.html':'index.html')}
 catch(e){showError(e.message||'Unable to verify the code.');setBusy(verifyOtpBtn,false,'Verify and sign in')}
});
backBtn.addEventListener('click',()=>{challengeId='';otpStep.hidden=true;credentialsStep.hidden=false;stepTitle.textContent='Welcome back';stepIntro.textContent='Sign in to your workspace';document.querySelector('#otpCode').value='';showError('')});
document.querySelector('#otpCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();verifyOtpBtn.click()}});
