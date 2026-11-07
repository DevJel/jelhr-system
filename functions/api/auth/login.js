import { respond, readJson, clientIp } from "../../_shared/http.js";
import { sha256b64, verifyPassword, dummyPasswordWork } from "../../_shared/crypto.js";
import { findUser, afterFirstFactor } from "../../_shared/login.js";
import { loadPolicy } from "../../_shared/authpolicy.js";


const WINDOW_SECONDS=900, MAX_ATTEMPTS=8, ACCOUNT_LOCK_AFTER=10, ACCOUNT_LOCK_SECONDS=900;
export async function verifyTurnstile(env,token,ip,hostname,request) {
  if(!token)return false;
  // Prefer the internal verifier service when configured; otherwise use Siteverify
  // directly with the encrypted Pages secret. Never accept a client-only widget token.
  if(env.TURNSTILE_VERIFIER){
    try{
      const r=await env.TURNSTILE_VERIFIER.fetch("https://turnstile.internal/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,ip,hostname,action:"login"})});
      if(!r.ok)return false;
      return (await r.json().catch(()=>({}))).success===true;
    }catch{return false}
  }
  if(!env.TURNSTILE_SECRET_KEY)return false;
  try{
    const body=new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:String(token),remoteip:String(ip||"")});
    const r=await (env.__fetch||fetch)("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(5000)});
    if(!r.ok)return false;
    const result=await r.json().catch(()=>({}));
    const expectedHost=String(hostname||new URL(request.url).hostname).toLowerCase();
    return result.success===true&&String(result.hostname||"").toLowerCase()===expectedHost&&result.action==="login";
  }catch{return false}
}
export async function onRequestPost({request,env}) {
  if(!env.DB||!env.JELHR_JWT_SECRET||env.JELHR_JWT_SECRET.length<32)return respond({error:"Authentication service is not configured."},503);
  const b=await readJson(request,4096),identifier=String(b.identifier??b.email??"").trim(),workspace=String(b.workspace||"").trim(),password=String(b.password||"");
  if(!identifier||identifier.length>254||!password||password.length>256)return respond({error:"Enter your email, username or employee ID, and your password."},400);
  const ip=clientIp(request);
  if(!await verifyTurnstile(env,b.turnstileToken,ip,new URL(request.url).hostname,request))return respond({error:"Security verification failed or expired. Please complete Turnstile again."},400);
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
  await env.DB.batch([
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE key=?").bind(rateKey),
    env.DB.prepare("DELETE FROM auth_rate_limits WHERE window_started_at < ? AND (locked_until IS NULL OR locked_until < ?)").bind(now-86400,now),
    env.DB.prepare("DELETE FROM auth_challenges WHERE expires_at < ?").bind(new Date(Date.now()-86400000).toISOString())
  ]);
  return afterFirstFactor(env,request,user,{authMethod:"password"});
}
