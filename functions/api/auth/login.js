const enc = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("=","").replaceAll("+","-").replaceAll("/","_");
const json = (body,status=200,headers={}) => Response.json(body,{status,headers:{"Cache-Control":"no-store",...headers}});
async function digest(value){return b64url(await crypto.subtle.digest("SHA-256",enc.encode(value)));}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveBits"]);return b64url(await crypto.subtle.deriveBits({name:"PBKDF2",salt:enc.encode(salt),iterations:210000,hash:"SHA-256"},key,256));}
async function sign(payload,secret){const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const head=b64url(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"})));const body=b64url(enc.encode(JSON.stringify(payload)));const input=head+"."+body;return input+"."+b64url(await crypto.subtle.sign("HMAC",key,enc.encode(input)));}
export async function onRequestPost({request,env}) {
 if(!env.DB || !env.JELHR_JWT_SECRET || env.JELHR_JWT_SECRET.length<32) return json({error:"Authentication service is not configured."},503);
 let body;try{body=await request.json()}catch{return json({error:"Invalid request."},400)}
 const email=String(body.email||"").trim().toLowerCase(),password=String(body.password||"");
 if(!email.includes("@")||!email.split("@")[1]?.includes(".")||password.length<1||password.length>256)return json({error:"Enter a valid email and password."},400);
 const ip=request.headers.get("CF-Connecting-IP")||"unknown",rateKey=await digest(email+"|"+ip),now=Math.floor(Date.now()/1000);
 const rate=await env.DB.prepare("SELECT * FROM auth_rate_limits WHERE key=?").bind(rateKey).first();
 if(rate?.locked_until>now)return json({error:"Too many attempts. Try again later."},429);
 const user=await env.DB.prepare("SELECT id,organization_id,email,display_name,password_hash,password_salt,role,status,locked_until FROM users WHERE email=? COLLATE NOCASE LIMIT 1").bind(email).first();
 let valid=false;
 if(user && user.status==="active" && (!user.locked_until || Date.parse(user.locked_until)<Date.now()) && user.password_hash && user.password_salt){
  valid=(await passwordHash(password,user.password_salt))===user.password_hash;
 }
 await env.DB.prepare("INSERT INTO auth_events(id,user_id,email,event,ip_hash) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),user?.id||null,email,valid?"login_success":"login_failed",await digest(ip)).run();
 if(!valid){
  const attempts=(rate?.attempts||0)+1,locked=attempts>=8?now+900:null;
  await env.DB.prepare("INSERT INTO auth_rate_limits(key,attempts,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until").bind(rateKey,attempts,rate?.window_started_at||now,locked).run();
  return json({error:"Email or password is incorrect."},401);
 }
 await env.DB.prepare("DELETE FROM auth_rate_limits WHERE key=?").bind(rateKey).run();
 const sessionId=crypto.randomUUID(),expires=now+60*60*8,token=await sign({sub:user.id,org:user.organization_id,role:user.role,sid:sessionId,iat:now,exp:expires},env.JELHR_JWT_SECRET),tokenHash=await digest(token);
 await env.DB.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,?,?,?)").bind(sessionId,user.id,tokenHash,new Date(expires*1000).toISOString(),new Date().toISOString()).run();
 await env.DB.prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP,failed_login_count=0 WHERE id=?").bind(user.id).run();
 return json({user:{id:user.id,email:user.email,name:user.display_name,role:user.role,organizationId:user.organization_id}},200,{"Set-Cookie":"jelhr_session="+token+"; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800"});
}
