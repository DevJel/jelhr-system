import { respond, readJson, clientIp } from "../../_shared/http.js";
import { sha256b64, verifyPassword, dummyPasswordWork, randomToken } from "../../_shared/crypto.js";
import { loadPolicy } from "../../_shared/authpolicy.js";
import { findUser, MFA_CHALLENGE_MINUTES } from "../../_shared/login.js";
import { issueOtp } from "../../_shared/otp.js";


const WINDOW_SECONDS=900, MAX_ATTEMPTS=8, ACCOUNT_LOCK_AFTER=10, ACCOUNT_LOCK_SECONDS=900;
async function verifyTurnstile(env,token,ip) {
  if(!env.TURNSTILE_VERIFIER||!token)return false;
  const r=await env.TURNSTILE_VERIFIER.fetch("https://turnstile.internal/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,ip})});
  if(!r.ok)return false;
  return (await r.json().catch(()=>({}))).success===true;
}
export async function onRequestPost({request,env}) {
  if(!env.DB||!env.JELHR_JWT_SECRET||env.JELHR_JWT_SECRET.length<32)return respond({error:"Authentication service is not configured."},503);
  const b=await readJson(request,4096),identifier=String(b.identifier??b.email??"").trim(),workspace=String(b.workspace||"").trim(),password=String(b.password||"");
  if(!identifier||identifier.length>254||!password||password.length>256)return respond({error:"Enter your email, username or employee ID, and your password."},400);
  const ip=clientIp(request);
  if(!await verifyTurnstile(env,b.turnstileToken,ip))return respond({error:"Security verification failed or expired. Please complete Turnstile again."},400);
  const ipHash=await sha256b64(ip),rateKey=await sha256b64(identifier.toLowerCase()+"|"+workspace.toLowerCase()+"|"+ip),now=Math.floor(Date.now()/1000);
  const rate=await env.DB.prepare("SELECT attempts,window_started_at,locked_until FROM auth_rate_limits WHERE key=?").bind(rateKey).first();
  if(rate?.locked_until&&rate.locked_until>now)return respond({error:"Too many attempts. Try again later."},429);
  const fresh=rate&&now-rate.window_started_at<WINDOW_SECONDS,found=await findUser(env,request,identifier,workspace);
  if(found.needsWorkspace){await dummyPasswordWork(password);return respond({error:"Enter your workspace ID to sign in with a username or employee ID.",code:"workspace_required"},400);}
  const user=found.user,locked=user?.locked_until&&Date.parse(user.locked_until)>Date.now();let valid=false;
  if(user&&user.status==="active"&&!locked&&user.password_hash&&user.password_salt)valid=await verifyPassword(password,user.password_salt,user.password_hash);else await dummyPasswordWork(password);
  await env.DB.prepare("INSERT INTO auth_events(id,user_id,email,event,ip_hash) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),user?.id||null,user?.email||identifier.toLowerCase(),valid?"password_ok":locked?"login_locked":"login_failed",ipHash).run();
  if(!valid){
    const attempts=(fresh?rate.attempts:0)+1,ops=[env.DB.prepare("INSERT INTO auth_rate_limits(key,attempts,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until").bind(rateKey,attempts,fresh?rate.window_started_at:now,attempts>=MAX_ATTEMPTS?now+WINDOW_SECONDS:null)];
    if(user&&!locked){const failures=(user.failed_login_count||0)+1,until=failures>=ACCOUNT_LOCK_AFTER?new Date(Date.now()+ACCOUNT_LOCK_SECONDS*1000).toISOString():null;ops.push(env.DB.prepare("UPDATE users SET failed_login_count=?,locked_until=? WHERE id=?").bind(until?0:failures,until,user.id));}
    await env.DB.batch(ops);return respond({error:"Those sign-in details are incorrect."},401);
  }
  const policy=await loadPolicy(env,user.organization_id);
  if(policy.sso.enabled&&policy.sso.enforced&&user.role!=="owner")return respond({error:"Your organization signs in with single sign-on. Use “Sign in with SSO”.",code:"sso_required"},403);
  const id=crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE key=?").bind(rateKey),
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ? AND (locked_until IS NULL OR locked_until < ?)").bind(now-86400,now),
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(new Date(Date.now()-86400000).toISOString()),
    env.DB.prepare("INSERT INTO auth_challenges(id,purpose,user_id,organization_id,challenge,data_json,expires_at) VALUES(?,?,?,?,?,?,?)").bind(id,"mfa",user.id,user.organization_id,randomToken(16),JSON.stringify({authMethod:"password",methods:["email_otp"],bootstrap:false,ipHash}),new Date(Date.now()+MFA_CHALLENGE_MINUTES*60000).toISOString())
  ]);
  try{
    const sent=await issueOtp(env,user,"login");
    if(!sent.sent){await env.DB.prepare("UPDATE auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return respond({error:"We couldn't send your verification email. Please try again or contact your administrator."},503);}
  }catch(e){await env.DB.prepare("UPDATE auth_challenges SET consumed_at=? WHERE id=?").bind(new Date().toISOString(),id).run();throw e;}
  const [local,domain]=user.email.split("@"),hint=domain?local.slice(0,2)+"•".repeat(Math.max(1,local.length-2))+"@"+domain:"your registered email";
  return respond({emailOtpRequired:true,challengeId:id,emailHint:hint,expiresIn:MFA_CHALLENGE_MINUTES*60});
}