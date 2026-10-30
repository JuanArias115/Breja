import { clientAddress, securityConfig, PersistentLimiter, verifyTurnstile, mailBudgetRules } from './security.js';
import { createMailer } from './mailer.js';
import { firebaseConfig, verifyGoogleToken, linkGoogleUser } from './firebase.js';
import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Store, AppError, fail, id, text, cents, FOOTBALL_POSITIONS, birthdayValue } from './store.js';
import { newsInput, newsImage } from './news.js';
import { seedDevelopment } from './seed.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),production=process.env.NODE_ENV==='production';
const googleConfig=firebaseConfig(),security=securityConfig();
const port=Number(process.env.PORT||4173),origin=process.env.APP_ORIGIN||`http://localhost:${port}`;
if(production){for(const key of ['ADMIN_EMAIL','SESSION_SECRET','RESEND_API_KEY','MAIL_FROM','APP_ORIGIN'])if(!process.env[key])throw Error(`Production requires ${key}`);if(process.env.SESSION_SECRET.length<32||!origin.startsWith('https://'))throw Error('Use a 32+ character SESSION_SECRET and HTTPS APP_ORIGIN.');}
mkdirSync(join(root,'.data'),{recursive:true});
export const store=new Store(process.env.DATABASE_PATH||join(root,'.data',production?'breja.sqlite':'development.sqlite'));
if(!production)seedDevelopment(store);
const secret=process.env.SESSION_SECRET||randomBytes(32).toString('hex');
const hash=v=>createHash('sha256').update(v).digest('hex'),codeHash=(email,code)=>createHmac('sha256',secret).update(email+':'+code).digest('hex');
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const cookie=(res,token,clear=false)=>res.setHeader('Set-Cookie',`breja_session=${clear?'':token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear?0:60*60*24*30}${production?'; Secure':''}`);
const session=(res,uid)=>{store.run('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 4)',uid,uid);const token=randomBytes(32).toString('base64url');store.run('INSERT INTO sessions VALUES (?,?,?)',hash(token),uid,new Date(Date.now()+30*86400000).toISOString());cookie(res,token);};
function user(req){const token=req.headers.cookie?.match(/(?:^|; )breja_session=([^;]+)/)?.[1];if(!token)return null;return store.get('SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.deleted_at IS NULL',hash(token),store.now())||null;}
async function body(req,max=65536){let result='';for await(const chunk of req){result+=chunk;fail(Buffer.byteLength(result)<=max,'request_too_large',413);}if(req.accountId)fail(store.get('SELECT id FROM users WHERE id=? AND deleted_at IS NULL',req.accountId),'unauthorized',401);try{return JSON.parse(result||'{}');}catch{throw new AppError('invalid_json');}}
const limits=new Map(),limiter=new PersistentLimiter(store,secret);
function throttle(key,max=100,window=60000){const now=Date.now();let slot=limits.get(key);if(!slot||slot.expires<now){fail(limits.has(key)||limits.size<10000,'rate_limited',429,{retry_after:60});slot={n:0,expires:now+window};limits.set(key,slot);}fail(++slot.n<=max,'rate_limited',429,{retry_after:Math.ceil((slot.expires-now)/1000)});}
const mailer=createMailer(store,{enabled:production,config:security,limiter,origin,apiKey:process.env.RESEND_API_KEY,from:process.env.MAIL_FROM});
const deliverOutbox=()=>mailer.drain();
function visibleMatch(m,me){
  const registrations=store.all(`SELECT r.*,u.display_name,p.display_name sponsor_name FROM registrations r LEFT JOIN users u ON r.user_id=u.id JOIN users p ON r.responsible_id=p.id WHERE r.match_id=? ORDER BY r.joined_at,r.id`,m.id);
  return {...m,registrations:registrations.map(r=>({id:r.id,user_id:r.user_id,name:r.guest_name||r.display_name,guest:!!r.guest_name,sponsor:r.guest_name?r.sponsor_name:null,status:r.status,attendance:r.attendance,mine:r.responsible_id===me.id,offer_until:r.responsible_id===me.id?r.offer_until:null,...(me.role==='admin'?{responsible_id:r.responsible_id}: {})})),occupied:store.occupancy(m.id)};
}
function bootstrap(me){
  const config={firebase:googleConfig,development:!production,emailEnabled:true,turnstileSiteKey:security.siteKey,timezone:store.settings().timezone,positions:FOOTBALL_POSITIONS};
  if(!me)return {me:null,config};
  if(me.membership_status!=='approved')return {me:store.publicUser(me),config};
  for(const m of store.all("SELECT id FROM matches WHERE status='open'"))store.promote(m.id);
  const settings=store.settings(),developer=me.role==='dev',manager=me.role==='admin'||developer;
  const visibleSettings=developer?Object.fromEntries(['price_cents','capacity','cancel_hours','timezone'].map(key=>[key,settings[key]])):settings;
  return {me:store.publicUser(me),config,settings:visibleSettings,leaderboard:store.leaderboard(),photos:store.all("SELECT user_id,'/api/members/'||user_id||'/photo?v='||version url FROM profile_photos"),venues:store.all('SELECT * FROM venues WHERE archived=0 OR ? ORDER BY archived,name',manager?1:0),matches:store.all("SELECT * FROM matches WHERE status<>'draft' OR created_by=? OR ? ORDER BY starts_at DESC",me.id,manager?1:0).map(m=>visibleMatch(m,me)),news:store.all("SELECT id,title_en,title_de,title_es,body_en,body_de,body_es,pinned,created_at,CASE WHEN image_data<>'' THEN '/api/news/'||id||'/image' ELSE '' END image_url FROM news ORDER BY pinned DESC,created_at DESC"),...(developer?{}:{account:{balance:store.balance(me.id),ledger:store.all('SELECT * FROM ledger WHERE user_id=? ORDER BY occurred_at DESC,created_at DESC',me.id),reports:store.all('SELECT * FROM payment_reports WHERE user_id=? ORDER BY created_at DESC',me.id)},statements:store.all('SELECT id,month,snapshot,created_at FROM statements WHERE user_id=? ORDER BY month DESC',me.id).map(r=>({...r,snapshot:JSON.parse(r.snapshot)}))})};
}
function adminData(){return {security:{turnstile:!!security.siteKey,emailDailyLimit:security.emailDaily,emailDailyUsed:limiter.usage('mail:daily'),emailMonthlyLimit:security.emailMonthly,emailMonthlyUsed:limiter.usage('mail:monthly')},applications:store.all("SELECT * FROM users WHERE membership_status IN ('pending','rejected') AND deleted_at IS NULL ORDER BY application_submitted_at").map(u=>store.publicUser(u)),stats:{received:store.get("SELECT COALESCE(-SUM(l.amount_cents),0) total FROM ledger l LEFT JOIN ledger original ON original.id=l.reverses_id WHERE l.kind='payment' OR (l.kind='reversal' AND original.kind='payment')").total},archivedMembers:store.all('SELECT id,display_name,deleted_at FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC').map(u=>({...u,balance:store.balance(u.id)})),members:store.all("SELECT * FROM users WHERE membership_status='approved' AND deleted_at IS NULL ORDER BY display_name").map(u=>({...store.publicUser(u),balance:store.balance(u.id)})),ledger:store.all('SELECT l.*,u.display_name FROM ledger l JOIN users u ON l.user_id=u.id ORDER BY l.created_at DESC LIMIT 200'),reports:store.all("SELECT r.*,u.display_name FROM payment_reports r JOIN users u ON r.user_id=u.id WHERE r.status='pending' ORDER BY r.created_at"),outbox:store.all("SELECT id,user_id,recipient,subject,body,kind,status,error,created_at,sent_at FROM outbox WHERE kind<>'login' ORDER BY created_at DESC LIMIT 100"),statements:store.all('SELECT s.id,s.month,s.created_at,u.display_name FROM statements s JOIN users u ON s.user_id=u.id ORDER BY s.created_at DESC'),audit:store.all('SELECT a.*,u.display_name FROM audit a LEFT JOIN users u ON a.actor_id=u.id ORDER BY a.created_at DESC LIMIT 40')};}

export async function api(req,res,url){
 const path=url.pathname,method=req.method,me=user(req),address=clientAddress(req,security.trustedProxies);
 if(method!=='GET'){
   fail(req.headers.origin===origin,'invalid_origin',403);
   fail(req.headers['content-type']?.startsWith('application/json'),'invalid_content_type',415);
 }
 throttle(address,300);
 if(path==='/api/bootstrap'&&method==='GET')return json(res,200,bootstrap(me));
 if(path.startsWith('/api/public/match/')&&method==='GET'){
   const m=store.get("SELECT * FROM matches WHERE share_token=? AND status<>'draft'",path.split('/').at(-1));fail(m,'not_found',404);
   const {title,starts_at,ends_at,timezone,venue,address,map_url,price_cents,capacity,cancel_hours,status}=m;
   return json(res,200,{title,starts_at,ends_at,timezone,venue,address,map_url,price_cents,capacity,cancel_hours,status,occupied:store.occupancy(m.id),...(me?.membership_status==='approved'?{id:m.id}: {})});
 }
 if(path==='/api/auth/google'&&method==='POST'){
  limiter.consume([{key:'google:'+address,max:20,window:600000}]);const input=await body(req);
  const claims=await verifyGoogleToken(input.id_token,googleConfig);const account=linkGoogleUser(store,claims,input.language,process.env.ADMIN_EMAIL||'');session(res,account.id);return json(res,200,{ok:true});
 }
 if(path==='/api/auth/request'&&method==='POST'){
   limiter.consume([{key:'email-ip:'+address,max:10,window:600000},{key:'email-ip-day:'+address,max:30,window:86400000}]);
   const input=await body(req),email=text(input.email,254).toLowerCase();fail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'invalid_email');
   await verifyTurnstile(input.turnstile_token,'login_email',security,origin);
   limiter.consume([{key:'email:'+email,max:3,window:900000},{key:'email-day:'+email,max:6,window:86400000},...(production?[{key:'email-cooldown:'+email,max:1,window:60000}]:[]),{key:'login-hour',max:30,window:3600000},{key:'login-day',max:60,window:86400000}]);
   const existing=store.get('SELECT * FROM users WHERE email=?',email);const profile={email,name:existing?.name||text(input.name,100),display_name:existing?.display_name||text(input.name,60),language:['en','de','es'].includes(input.language)?input.language:'en'};
   store.run("UPDATE outbox SET status='cancelled',body='',error='superseded' WHERE kind='login' AND recipient=? AND status='queued'",email);
   const code=String(randomInt(100000,1000000));store.run('INSERT OR REPLACE INTO login_codes VALUES (?,?,?,0,?,?)',email,codeHash(email,code),new Date(Date.now()+10*60000).toISOString(),JSON.stringify(profile),store.now());
   store.enqueue(existing||{id:null,email},'login','login:'+id(),profile.language==='es'?'Tu código de acceso a Breja FC':profile.language==='de'?'Dein Breja FC Anmeldecode':'Your Breja FC sign-in code',profile.language==='es'?`Tu código: ${code}\nCaduca en 10 minutos.`:profile.language==='de'?`Dein Code: ${code}\nEr ist 10 Minuten gültig.`:`Your code: ${code}\nIt expires in 10 minutes.`);
   if(production)void deliverOutbox();return json(res,200,{ok:true,...(!production?{developmentCode:code}: {})});
 }
 if(path==='/api/auth/verify'&&method==='POST'){
   limiter.consume([{key:'verify-ip:'+address,max:30,window:600000}]);
   const input=await body(req),email=text(input.email,254).toLowerCase(),code=text(input.code,6);limiter.consume([{key:'verify-email:'+email,max:10,window:900000}]);const login=store.get('SELECT * FROM login_codes WHERE email=?',email);
   fail(login&&login.expires_at>store.now()&&login.attempts<5,'invalid_code',401);store.run('UPDATE login_codes SET attempts=attempts+1 WHERE email=?',email);
   fail(timingSafeEqual(Buffer.from(login.code_hash),Buffer.from(codeHash(email,code))),'invalid_code',401);
   let u=store.get('SELECT * FROM users WHERE email=?',email);if(!u){const initialAdmin=store.canBootstrapAdmin(email,process.env.ADMIN_EMAIL||'');u=store.addUser(JSON.parse(login.profile),initialAdmin?'admin':'member',initialAdmin?'approved':'onboarding');}
   store.run('DELETE FROM login_codes WHERE email=?',email);store.run("UPDATE outbox SET status='cancelled',body='',error='code_used' WHERE kind='login' AND recipient=? AND status='queued'",email);session(res,u.id);return json(res,200,{ok:true});
 }
 if(path==='/api/auth/development'&&method==='POST'){
   fail(!production,'not_found',404);const input=await body(req);fail(['member','admin'].includes(input.role),'invalid_role');const email=input.role==='member'?'sam@example.test':'alex@example.test';session(res,store.get('SELECT id FROM users WHERE email=?',email).id);return json(res,200,{ok:true});
 }
 fail(me,'unauthorized',401);req.accountId=me.id;
 if(path==='/api/auth/logout'&&method==='POST'){const token=req.headers.cookie?.match(/breja_session=([^;]+)/)?.[1];if(token)store.run('DELETE FROM sessions WHERE token_hash=?',hash(token));cookie(res,'',true);return json(res,200,{ok:true});}
 if(path==='/api/membership/application'&&method==='POST'){
  fail(me.membership_status==='onboarding','application_not_editable',409);
  limiter.consume([{key:'application-ip:'+address,max:10,window:3600000}]);
  const input=await body(req);await verifyTurnstile(input.turnstile_token,'membership',security,origin);
  limiter.consume([{key:'application-day',max:50,window:86400000}]);
  const result=store.submitApplication(me.id,input);if(production)void deliverOutbox();return json(res,200,result);
 }
 // All private club APIs, including media and profile edits, require approval.
 fail(me.membership_status==='approved','membership_required',403);
 const imageMatch=path.match(/^\/api\/news\/([^/]+)\/image$/);
 if(imageMatch&&method==='GET'){
  const row=store.get('SELECT image_data FROM news WHERE id=?',imageMatch[1]);fail(row?.image_data,'not_found',404);
  const image=newsImage(row.image_data);res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.buffer.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});return res.end(image.buffer);
 }
 const photoMatch=path.match(/^\/api\/members\/([^/]+)\/photo$/);
 if(photoMatch&&method==='GET'){
  const row=store.get('SELECT image_data FROM profile_photos WHERE user_id=?',photoMatch[1]);fail(row,'not_found',404);const image=newsImage(row.image_data);
  res.writeHead(200,{'Content-Type':image.type,'Content-Length':image.buffer.length,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});return res.end(image.buffer);
 }
 if(path==='/api/profile/photo'&&method==='POST'){
  const p=await body(req,3*1024*1024);const image=newsImage(p.image_data);fail(image,'invalid_image');
  store.run('INSERT OR REPLACE INTO profile_photos VALUES (?,?,?)',me.id,p.image_data,id());store.audit(me.id,'profile.photo.update',me.id);return json(res,200,{ok:true});
 }
 if(path==='/api/profile/photo'&&method==='DELETE'){store.run('DELETE FROM profile_photos WHERE user_id=?',me.id);store.audit(me.id,'profile.photo.remove',me.id);return json(res,200,{ok:true});}
 if(path==='/api/profile'&&method==='PATCH'){
   const p=await body(req);fail(['en','de','es'].includes(p.language),'invalid_input');const birthday=birthdayValue(p.birthday,store.now().slice(0,10),!!me.application_submitted_at);
   const position=text(p.position||'',50,false),secondary=text(p.position_secondary??me.position_secondary,50,false);
   fail((!position&&!me.application_submitted_at||FOOTBALL_POSITIONS.includes(position)||position===me.position)&&(!secondary||FOOTBALL_POSITIONS.includes(secondary))&&(!secondary||secondary!==position),'invalid_positions');
   store.run('UPDATE users SET name=?,display_name=?,phone=?,birthday=?,position=?,position_secondary=?,language=? WHERE id=?',text(p.name,100),text(p.display_name,60),text(p.phone||'',30,false),birthday,position,secondary,p.language,me.id);return json(res,200,{ok:true});
 }
 if(me.role==='dev'&&(/^\/api\/(matches|registrations)\//.test(path)||path==='/api/payment-reports'))throw new AppError('forbidden',403);
 let match=path.match(/^\/api\/matches\/([^/]+)\/join$/);if(match&&method==='POST'){const p=await body(req);fail(p.accept_policy===true,'policy_required');return json(res,200,store.join(me.id,match[1],p.guest_name||null));}
 match=path.match(/^\/api\/registrations\/([^/]+)\/(cancel|accept)$/);if(match&&method==='POST'){const p=await body(req);if(match[2]==='accept')fail(p.accept_policy===true,'policy_required');return json(res,200,match[2]==='cancel'?store.cancelRegistration(me.id,match[1],p.accept_fee===true):store.accept(me.id,match[1])||{ok:true});}
 if(path==='/api/payment-reports'&&method==='POST'){const p=await body(req),amount=cents(p.amount_cents);fail(amount>0&&['cash','transfer','other'].includes(p.method),'invalid_input');fail(!store.get("SELECT id FROM payment_reports WHERE user_id=? AND status='pending'",me.id),'report_pending',409);store.run('INSERT INTO payment_reports (id,user_id,amount_cents,method,note,created_at) VALUES (?,?,?,?,?,?)',id(),me.id,amount,p.method,text(p.note||'',300,false),store.now());return json(res,200,{ok:true});}
 const technicalAction=(path==='/api/admin/settings'&&method==='PATCH')||
   (path==='/api/admin/venues'&&method==='POST')||
   (/^\/api\/admin\/venues\/[^/]+(\/archive)?$/.test(path)&&method==='PATCH')||
   (path==='/api/admin/matches'&&method==='POST')||
   (/^\/api\/admin\/matches\/[^/]+\/publish$/.test(path)&&method==='POST');
 fail(me.role==='admin'||me.role==='dev'&&technicalAction,'forbidden',403);
 match=path.match(/^\/api\/admin\/applications\/([^/]+)$/);
 if(match&&method==='PATCH')return json(res,200,store.reviewApplication(me.id,match[1],(await body(req)).decision));
 match=path.match(/^\/api\/admin\/members\/([^/]+)\/role$/);
 if(match&&method==='PATCH')return json(res,200,store.setRole(me.id,match[1],(await body(req)).role));
 match=path.match(/^\/api\/admin\/members\/([^/]+)$/);
 if(match&&method==='DELETE'){fail((await body(req)).confirm===true,'deletion_confirmation_required');return json(res,200,store.anonymizeMember(me.id,match[1]));}
 if(path==='/api/admin/members'&&method==='POST'){
  const p=await body(req);fail(['en','de','es'].includes(p.language),'invalid_input');const member=store.addUser(p,'member');store.audit(me.id,'member.create',member.id);return json(res,201,store.publicUser(member));
 }
 if(path==='/api/admin'&&method==='GET')return json(res,200,adminData());
 if(path==='/api/admin/venues'&&method==='POST')return json(res,201,store.saveVenue(me.id,await body(req)));
 match=path.match(/^\/api\/admin\/venues\/([^/]+)(\/archive)?$/);
 if(match&&method==='PATCH'){const p=await body(req);if(match[2]){store.archiveVenue(me.id,match[1],p.archived);return json(res,200,{ok:true});}return json(res,200,store.saveVenue(me.id,p,match[1]));}
 if(path==='/api/admin/matches'&&method==='POST')return json(res,201,store.createMatch(me.id,await body(req)));
 match=path.match(/^\/api\/admin\/matches\/([^/]+)\/(close|cancel|publish)$/);if(match&&method==='POST'){
   const p=await body(req);if(match[2]==='close')return json(res,200,store.closeMatch(me.id,match[1],p.attendance||{}));
   if(match[2]==='cancel')store.cancelMatch(me.id,match[1]);
   else {const m=store.match(match[1]);fail(m.status==='draft'&&m.starts_at>store.now(),'invalid_state');store.run("UPDATE matches SET status='open' WHERE id=?",m.id);store.audit(me.id,'match.publish',m.id);}
   return json(res,200,{ok:true});
 }
 if(path==='/api/admin/payments'&&method==='POST')return json(res,201,store.payment(me.id,await body(req)));
 match=path.match(/^\/api\/admin\/ledger\/([^/]+)\/reverse$/);if(match&&method==='POST'){store.reverse(me.id,match[1],(await body(req)).reason);return json(res,200,{ok:true});}
 match=path.match(/^\/api\/admin\/reports\/([^/]+)$/);if(match&&method==='POST'){
   const p=await body(req),r=store.get("SELECT * FROM payment_reports WHERE id=? AND status='pending'",match[1]);fail(r,'not_found',404);fail(['confirm','reject'].includes(p.action),'invalid_input');
   store.transaction(()=>{if(p.action==='confirm')store.payment(me.id,{user_id:r.user_id,amount_cents:r.amount_cents,method:r.method,note:r.note||'Payment report',request_key:'report:'+r.id});store.run('UPDATE payment_reports SET status=? WHERE id=?',p.action==='confirm'?'confirmed':'rejected',r.id);store.audit(me.id,'payment-report.'+p.action,r.id);});return json(res,200,{ok:true});
 }
 if(path==='/api/admin/statements/preview'&&method==='POST')return json(res,200,{statements:store.statementPreview((await body(req)).month)});
 if(path==='/api/admin/statements/generate'&&method==='POST'){const result=store.generateStatements(me.id,(await body(req)).month);if(production)void deliverOutbox();return json(res,200,result);}
 if(path==='/api/admin/settings'&&method==='PATCH'){
   const p=await body(req);fail(Number.isInteger(p.capacity)&&p.capacity>=2&&p.capacity<=100&&Number.isInteger(p.cancel_hours)&&p.cancel_hours>=0&&p.cancel_hours<=168,'invalid_input');cents(p.price_cents);try{new Intl.DateTimeFormat('en',{timeZone:p.timezone}).format();}catch{throw new AppError('invalid_timezone');}
   p.default_venue_id=p.default_venue_id??store.settings().default_venue_id;
   if(me.role==='admin'&&p.default_venue_id)fail(store.get('SELECT id FROM venues WHERE id=? AND archived=0',p.default_venue_id),'venue_unavailable');
   store.transaction(()=>{for(const key of (me.role==='dev'?['price_cents','capacity','cancel_hours','timezone']:['price_cents','capacity','cancel_hours','timezone','default_venue_id','payment_instructions_en','payment_instructions_de','payment_instructions_es'])){if(key==='payment_instructions_es'&&p[key]===undefined)p[key]=store.settings()[key];const v=typeof p[key]==='string'?text(p[key],key.startsWith('payment')?1000:300,false):p[key];fail(v!==undefined,'invalid_input');store.run('UPDATE settings SET value=? WHERE key=?',JSON.stringify(v),key);}store.audit(me.id,'settings.update',null);});return json(res,200,{ok:true});
 }
 if(path==='/api/admin/news'&&method==='POST'){
  const p=newsInput(await body(req,3*1024*1024));
  const nid=id();store.run('INSERT INTO news (id,title_en,title_de,body_en,body_de,pinned,created_at,title_es,body_es,image_data) VALUES (?,?,?,?,?,?,?,?,?,?)',nid,p.title_en,p.title_de,p.body_en,p.body_de,p.pinned?1:0,store.now(),p.title_es,p.body_es,p.image_data);
  return json(res,201,{ok:true,id:nid});
 }
 if(path==='/api/admin/export'&&method==='GET'){
   const rows=store.all('SELECT l.*,u.name,u.email FROM ledger l JOIN users u ON u.id=l.user_id ORDER BY l.occurred_at');
   const cell=x=>'"'+(typeof x==='number'?String(x):String(x??'').replace(/^[=+@-]/,"'$&")).replaceAll('"','""')+'"';
   const columns=['id','name','email','kind','amount_cents','description','occurred_at','method','payer_name'];
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="breja-ledger.csv"','Cache-Control':'no-store'});return res.end('\uFEFF'+[columns.join(','),...rows.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n'));
 }
 throw new AppError('not_found',404);
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  const firebaseSources=googleConfig?` https://${googleConfig.authDomain}`:'';
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://www.gstatic.com https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://www.gstatic.com"+firebaseSources+"; frame-src https://challenges.cloudflare.com https://maps.google.com https://www.google.com https://accounts.google.com"+firebaseSources+"; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
  try{
    const allowedHosts=new Set([new URL(origin).host,`127.0.0.1:${port}`]);fail(allowedHosts.has(req.headers.host),'invalid_host',403);
    const url=new URL(req.url,origin);if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    fail(req.method==='GET'||req.method==='HEAD','not_found',404);
    const file=url.pathname==='/'||!extname(url.pathname)?join(root,'public','index.html'):resolve(root,'public','.'+decodeURIComponent(url.pathname));
    fail(file.startsWith(join(root,'public')+ '\\')||file.startsWith(join(root,'public')+'/'),'not_found',404);fail(existsSync(file)&&statSync(file).isFile(),'not_found',404);
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
    res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});if(req.method==='HEAD')return res.end();createReadStream(file).pipe(res);
  }catch(e){if(e.status===429&&!res.headersSent)res.setHeader('Retry-After',String(e.details?.retry_after||60));if(!res.headersSent)json(res,e.status||500,{error:e.code||'server_error',details:e.details||{}});else res.end();if(!e.status)console.error(e);}
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
const timer=isMain?setInterval(()=>{
  try{
    for(const m of store.all("SELECT id FROM matches WHERE status='open'"))store.promote(m.id);
    store.run('DELETE FROM sessions WHERE expires_at<?',store.now());store.run('DELETE FROM login_codes WHERE expires_at<?',store.now());
    store.run('DELETE FROM security_counters WHERE expires_at<=?',store.clock().getTime());
    store.run("UPDATE outbox SET status='cancelled',body='',error='expired' WHERE kind='login' AND status='queued' AND created_at<?",new Date(store.clock().getTime()-600000).toISOString());
    store.run("DELETE FROM outbox WHERE status IN ('sent','cancelled','failed') AND created_at<?",new Date(store.clock().getTime()-30*86400000).toISOString());
    for(const [key,v] of limits)if(v.expires<Date.now())limits.delete(key);
    if(process.env.AUTO_STATEMENTS==='true'){
      const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:store.settings().timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
      if(Number(parts.day)<=7){const d=new Date(Date.UTC(Number(parts.year),Number(parts.month)-2,1));const month=d.toISOString().slice(0,7);const admin=store.get("SELECT id FROM users WHERE role='admin' LIMIT 1");if(admin&&!store.get('SELECT id FROM audit WHERE action=? AND entity_id=?','statements.generate',month))try{store.generateStatements(admin.id,month);}catch(e){if(e.code!=='unclosed_matches')throw e;}}
    }
    void deliverOutbox();
  }catch(e){console.error('Background task:',e.code||e.message);}
},30000):null;timer?.unref();
if(isMain){
 server.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Breja FC · ${production?'production':'local development'}\nLocal: ${origin}\nDatabase: ${production?'breja.sqlite':'development.sqlite (sample data)'}`));
 const shutdown=()=>{clearInterval(timer);server.close(async()=>{await mailer.stop();store.db.close();process.exit(0);});};
 process.on('SIGINT',shutdown);
 process.on('SIGTERM',shutdown);
}
