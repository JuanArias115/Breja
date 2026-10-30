import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.js';
import { PersistentLimiter, clientAddress, securityConfig, verifyTurnstile } from '../server/security.js';
import { createMailer } from '../server/mailer.js';
import { dispatch } from './dispatch.js';

const application={name:'Applicant',birthday:'1992-02-29',position:'winger',language:'es'};
function fixture(t){
 let clock=new Date('2026-10-30T12:00:00Z');const s=new Store(':memory:',()=>clock);t.after(()=>s.db.close());
 const admin=s.addUser({name:'Owner',email:'owner@example.test',language:'es'},'admin'),member=s.addUser({name:'Applicant',email:'applicant@example.test'},'member','onboarding');
 const limiter=new PersistentLimiter(s,'test-secret');const config={emailDaily:90,emailMonthly:2500};
 const sent=[];let fetcher=async(url,options)=>{sent.push({url,...options,payload:JSON.parse(options.body)});return {ok:true,status:200};};
 const worker=createMailer(s,{enabled:true,config,limiter,origin:'https://breja.example.test',apiKey:'test-key',from:'test@example.test',fetchImpl:(...args)=>fetcher(...args),sleep:async()=>{}});
 return {s,admin,member,limiter,config,sent,worker,clock:value=>{clock=new Date(value);},fetch:value=>{fetcher=value;}};
}
test('only successful applications enqueue one generic notification per active admin, with no duplicate sends',async t=>{
 const {s,admin,member,worker,sent}=fixture(t);
 const second=s.addUser({name:'Other admin',email:'other-admin@example.test',language:'de'},'admin');
 s.addUser({name:'Developer',email:'dev@example.test'},'dev');
 assert.throws(()=>s.submitApplication(member.id,{...application,birthday:'invalid'}));assert.equal(s.all('SELECT * FROM outbox').length,0);
 s.submitApplication(member.id,application);
 assert.throws(()=>s.submitApplication(member.id,application),{code:'application_not_editable'});
 const queued=s.all('SELECT * FROM outbox');assert.equal(queued.length,2);assert.deepEqual(queued.map(m=>m.user_id).sort(),[admin.id,second.id].sort());
 for(const mail of queued){assert.equal(mail.subject_user_id,member.id);assert.doesNotMatch(mail.body,/1992|applicant@example|Applicant/);}
 await Promise.all([worker.drain(),worker.drain()]);await worker.drain();
 assert.equal(sent.length,2);assert.ok(sent.every(m=>m.payload.text.endsWith('https://breja.example.test/members')));
 assert.deepEqual(sent.map(m=>m.headers['Idempotency-Key']).sort(),queued.map(m=>m.id).sort());
 assert.ok(s.all('SELECT status FROM outbox').every(m=>m.status==='sent'));
});
test('pending notifications are cancelled for demoted recipients and removed when the applicant is anonymized',async t=>{
 const {s,admin,member,worker,sent}=fixture(t);
 const second=s.addUser({name:'Other',email:'other@example.test'},'admin');
 s.submitApplication(member.id,application);s.setRole(admin.id,second.id,'member');await worker.drain();
 assert.equal(sent.length,1);assert.equal(s.get('SELECT status FROM outbox WHERE user_id=?',second.id).status,'cancelled');
 s.anonymizeMember(admin.id,member.id);assert.equal(s.all('SELECT * FROM outbox').length,0);
});
test('persistent limits survive restarts, hash personal identifiers and reject atomically with retry timing',t=>{
 const dir=mkdtempSync(join(tmpdir(),'breja-limit-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite');
 let now=new Date('2026-10-30T12:00:00Z'),s=new Store(path,()=>now),limiter=new PersistentLimiter(s,'stable-secret');
 const rule={key:'email:private@example.test',max:2,window:60000};limiter.consume([rule]);s.db.close();
 s=new Store(path,()=>now);limiter=new PersistentLimiter(s,'stable-secret');limiter.consume([rule]);
 assert.throws(()=>limiter.consume([{key:'other',max:10,window:60000},rule]),e=>e.status===429&&e.details.retry_after===60);
 assert.equal(limiter.usage('other'),0);assert.doesNotMatch(JSON.stringify(s.all('SELECT * FROM security_counters')),/private@example/);
 now=new Date('2026-10-30T12:01:00Z');limiter.consume([rule]);assert.equal(limiter.usage(rule.key),1);s.db.close();
});
test('forged forwarding headers cannot select a visitor IP, while the explicitly trusted proxy can',()=>{
 const req={socket:{remoteAddress:'203.0.113.8'},headers:{'x-real-ip':'198.51.100.4','x-forwarded-for':'1.1.1.1','cf-connecting-ip':'2.2.2.2'}};
 assert.equal(clientAddress(req,[]),'203.0.113.8');assert.equal(clientAddress(req,['172.23.0.5']),'203.0.113.8');
 req.socket.remoteAddress='::ffff:172.23.0.5';assert.equal(clientAddress(req,['172.23.0.5']),'198.51.100.4');
 req.headers['x-real-ip']='1.2.3.4, 9.8.7.6';assert.equal(clientAddress(req,['172.23.0.5']),'172.23.0.5');
 assert.throws(()=>securityConfig({NODE_ENV:'production'}));assert.throws(()=>securityConfig({NODE_ENV:'production',TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET_KEY:'dummy'}));
 assert.throws(()=>securityConfig({TURNSTILE_SITE_KEY:'test-site-key'}));assert.throws(()=>securityConfig({TRUSTED_PROXY_IPS:'*'}));
});
test('Turnstile fails closed on missing, reused, wrong-host or wrong-action tokens and provider errors',async()=>{
 const config={siteKey:'test-site-key',secretKey:'private-test-key'},origin='https://breja.example.test';let calls=0;
 const response=data=>async(url,options)=>{calls++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(JSON.parse(options.body).secret,config.secretKey);return {ok:true,json:async()=>data};};
 await assert.rejects(()=>verifyTurnstile('','login_email',config,origin,response({})),{code:'human_verification_required'});assert.equal(calls,0);
 for(const data of [{success:false,'error-codes':['timeout-or-duplicate']},{success:true,hostname:'attacker.test',action:'login_email'},{success:true,hostname:'breja.example.test',action:'membership'},null]){
  await assert.rejects(()=>verifyTurnstile('token','login_email',config,origin,response(data)),{code:'human_verification_required'});
 }
 await assert.rejects(()=>verifyTurnstile('token','login_email',config,origin,async()=>{throw Error('offline');}),{code:'human_verification_unavailable'});
 await verifyTurnstile('token','login_email',config,origin,response({success:true,hostname:'breja.example.test',action:'login_email'}));
});
test('mail budgets cannot be bypassed by deleting outbox rows and defer new messages',async t=>{
 const {s,admin,member,worker,sent,config,limiter}=fixture(t);config.emailDaily=1;
 s.submitApplication(member.id,application);await worker.drain();assert.equal(sent.length,1);
 s.run('DELETE FROM outbox');s.enqueue(admin,'statement','another','Summary','Body');await worker.drain();
 assert.equal(sent.length,1);assert.equal(limiter.usage('mail:daily'),1);assert.equal(s.get('SELECT status,error FROM outbox').status,'queued');assert.equal(s.get('SELECT error FROM outbox').error,'mail_budget_exhausted');
});
test('transient email errors retry with the same idempotency key and stop after three attempts',async t=>{
 const {s,admin,worker,fetch:fakeFetch,clock,limiter}=fixture(t);const keys=[];
 fakeFetch(async(url,options)=>{keys.push(options.headers['Idempotency-Key']);return {ok:false,status:429,headers:{get:()=> '60'}};});
 s.enqueue(admin,'membership','retry','New request','Body');await worker.drain();await worker.drain();assert.equal(keys.length,1);
 clock('2026-10-30T12:01:00Z');await worker.drain();assert.equal(keys.length,2);
 clock('2026-10-30T12:06:00Z');await worker.drain();await worker.drain();assert.equal(keys.length,3);
 assert.equal(new Set(keys).size,1);assert.equal(s.get('SELECT status FROM outbox').status,'failed');assert.equal(limiter.usage('mail:daily'),3);
});
test('expired codes are never sent, sent codes are redacted, and mailer stops without sending the rest of a batch',async t=>{
 const {s,admin,worker,sent,clock,fetch:fakeFetch}=fixture(t);
 s.enqueue(admin,'login','old-code','Login','Old secret code');clock('2026-10-30T12:11:00Z');await worker.drain();assert.equal(sent.length,0);assert.equal(s.get('SELECT body FROM outbox').body,'');
 s.enqueue(admin,'login','fresh-code','Login','Fresh code');await worker.drain();assert.equal(sent.length,1);assert.equal(s.get("SELECT body FROM outbox WHERE dedupe_key='fresh-code'").body,'');
 let resolve;const inFlight=new Promise(r=>{resolve=r;});fakeFetch(async()=>{await inFlight;return {ok:true,status:200};});
 s.enqueue(admin,'membership','wait1','First','Body');s.enqueue(admin,'membership','wait2','Second','Body');
 const draining=worker.drain(),stopped=worker.stop();resolve();await Promise.all([draining,stopped]);
 assert.equal(s.get("SELECT status FROM outbox WHERE dedupe_key='wait1'").status,'sent');assert.equal(s.get("SELECT status FROM outbox WHERE dedupe_key='wait2'").status,'queued');
});

process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
process.env.TURNSTILE_SITE_KEY='test-site-key';process.env.TURNSTILE_SECRET_KEY='private-test-key';
const {api,store}=await import('../server/index.js');
const call=(path,cookie='',method='GET',body)=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});
const cookieOf=r=>r.headers['set-cookie'].split(';')[0];
test('real API enforces Turnstile before email and membership side effects, with IP and address quotas',async t=>{
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let action='login_email',valid=true;
 globalThis.fetch=async()=>({ok:true,json:async()=>({success:valid,hostname:'breja.test',action})});
 const bootstrap=(await call('/bootstrap')).json();assert.equal(bootstrap.config.turnstileSiteKey,'test-site-key');assert.equal(JSON.stringify(bootstrap).includes('private-test-key'),false);
 const input={name:'Applicant',email:'protected@example.test',language:'es'};
 const before=store.all('SELECT * FROM outbox').length;
 assert.equal((await call('/auth/request','','POST',input)).status,400);assert.equal(store.all('SELECT * FROM outbox').length,before);
 const requested=await call('/auth/request','','POST',{...input,turnstile_token:'verified'});assert.equal(requested.status,200);
 const verified=await call('/auth/verify','','POST',{email:input.email,code:requested.json().developmentCode});assert.equal(verified.status,200);const cookie=cookieOf(verified);
 assert.equal((await call('/membership/application',cookie,'POST',application)).status,400);
 const uid=(await call('/bootstrap',cookie)).json().me.id;assert.equal(store.get('SELECT membership_status FROM users WHERE id=?',uid).membership_status,'onboarding');
 assert.equal((await call('/membership/application',cookie,'POST',{...application,turnstile_token:'wrong-action'})).status,400);
 action='membership';assert.equal((await call('/membership/application',cookie,'POST',{...application,turnstile_token:'verified'})).status,200);
 assert.equal(store.get("SELECT COUNT(*) n FROM outbox WHERE kind='membership' AND subject_user_id=?",uid).n,1);
 assert.equal((await call('/membership/application',cookie,'POST',{...application,turnstile_token:'verified'})).status,409);
 action='login_email';
 for(let i=0;i<2;i++)assert.equal((await call('/auth/request','','POST',{...input,turnstile_token:'verified'})).status,200);
 assert.equal((await call('/auth/request','','POST',{...input,turnstile_token:'verified'})).status,429);
 // Distinct recipients still share the source-IP limit.
 for(let i=0;i<8;i++)await call('/auth/request','','POST',{...input,email:`other${i}@example.test`,turnstile_token:'verified'});
 assert.equal((await call('/auth/request','','POST',{...input,email:'last@example.test',turnstile_token:'verified'})).status,429);
});
