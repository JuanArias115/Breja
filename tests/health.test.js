import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Store } from '../server/store.js';
import { createTelemetry, recordRequestFailure } from '../server/health.js';
import { PersistentLimiter } from '../server/security.js';
import { createMailer } from '../server/mailer.js';
import { dispatch } from './dispatch.js';

const sensitive='private@example.test secret-token payment-987';
test('technical logs whitelist all fields, aggregate events and exclude identity and financial audit details',t=>{
 const s=new Store(':memory:',()=>new Date('2026-10-30T12:00:00Z'));t.after(()=>s.db.close());const log=createTelemetry(s);
 for(let i=0;i<3;i++)recordRequestFailure(log,{healthRole:sensitive},'/api/unknown/'+sensitive,{status:500,code:sensitive,message:sensitive,stack:sensitive});
 log.record(sensitive,{scope:sensitive});log.record('access.denied',{scope:sensitive,role:sensitive,code:sensitive,status:sensitive});
 const admin=s.addUser({email:'owner@example.test',name:'Private Owner'},'admin');
 s.audit(admin.id,'settings.update',sensitive,{password:sensitive});s.audit(admin.id,'payment.record',sensitive,{amount:987});
 const report=log.report();assert.equal(report.errors.length,1);assert.equal(report.errors24h,3);assert.equal(report.errors[0].occurrences,3);assert.equal(report.errors[0].code,'internal_error');assert.equal(report.errors[0].role,'anonymous');assert.equal(report.errors[0].scope,'other');
 assert.ok(report.activity.some(e=>e.event==='settings.updated'&&e.role==='admin'));
 assert.doesNotMatch(JSON.stringify(report),/private@|secret-token|payment-987|password|Private Owner|owner@|amount/);
 assert.equal(s.get('SELECT COUNT(*) n FROM technical_events').n,3);
 assert.throws(()=>s.transaction(()=>{s.audit(admin.id,'venue.create','rolled-back');throw Error('rollback');}));assert.equal(log.report().activity.some(e=>e.event==='venue.updated'),false);
});
test('technical logs persist on restart and enforce both retention and volume limits',t=>{
 const dir=mkdtempSync(join(tmpdir(),'breja-health-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'db.sqlite');let now=new Date('2026-10-30T12:00:00Z');
 let s=new Store(file,()=>now),log=createTelemetry(s);log.record('system.started');s.db.close();
 s=new Store(file,()=>now);t.after(()=>s.db.close());log=createTelemetry(s);assert.equal(log.report().activity[0].event,'system.started');
 for(let i=1;i<=2005;i++){now=new Date(now.getTime()+60000);log.record('access.denied',{scope:'access'});}
 assert.equal(s.get('SELECT COUNT(*) n FROM technical_events').n,2000);assert.equal(log.report().activity.length,100);assert.equal(s.get("SELECT id FROM technical_events WHERE event='system.started'"),undefined);
 now=new Date(now.getTime()+31*86400000);assert.deepEqual(log.report(),{activity:[],errors:[],errors24h:0});
});
test('email delivery failures retain useful status without provider payloads or recipient data',async t=>{
 const s=new Store(':memory:');t.after(()=>s.db.close());const log=createTelemetry(s),admin=s.addUser({email:'private@example.test',name:'Private Owner'},'admin');
 s.enqueue(admin,'membership','test','Private subject',sensitive);
 const worker=createMailer(s,{enabled:true,telemetry:log,config:{emailDaily:90,emailMonthly:2500},limiter:new PersistentLimiter(s,'local-test-secret'),origin:'https://example.test',apiKey:sensitive,from:admin.email,sleep:async()=>{},fetchImpl:async()=>({ok:false,status:403,body:sensitive})});
 await worker.drain();assert.equal(log.report().errors[0].event,'mail.failed');assert.equal(log.report().errors[0].code,'email_provider_403');assert.equal(log.report().errors[0].status,403);assert.doesNotMatch(JSON.stringify(log.report()),/private@|secret-token|Private subject|payment-987/);
});

process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
const call=(path,cookie='',method='GET',body)=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});
function login(role,status='approved'){
 const u=store.addUser({name:'Private '+role,email:`${role}-${status}@example.test`},role,status==='pending'?'onboarding':status),token=`local-${role}-${status}`;
 if(status==='pending')store.run("UPDATE users SET membership_status='pending' WHERE id=?",u.id);
 store.run('INSERT INTO sessions VALUES (?,?,?)',createHash('sha256').update(token).digest('hex'),u.id,'2099-01-01T00:00:00Z');return {u,cookie:'breja_session='+token};
}
test('Health is strictly dev-only, reflects current roles and returns no private financial or mail contents',async()=>{
 const dev=login('dev'),admin=login('admin'),member=login('member'),pending=login('dev','pending');
 assert.equal((await call('/dev/health')).status,401);
 for(const session of [admin,member,pending])assert.equal((await call('/dev/health',session.cookie)).status,403);
 store.enqueue(admin.u,'membership','private','Private subject',sensitive);store.audit(admin.u.id,'payment.record',sensitive,{secret:sensitive});
 const response=await call('/dev/health',dev.cookie);assert.equal(response.status,200);const h=response.json();
 assert.equal(h.runtime.database,true);assert.equal(h.mail.queued>=1,true);assert.ok(h.activity.some(e=>e.event==='access.denied'&&e.scope==='health'&&e.role==='admin'));
 assert.doesNotMatch(JSON.stringify(h),/private@|Private subject|secret-token|payment-987|@example|recipient|actor_id|token_hash|apiKey/);
 assert.equal((await call('/dev/health',dev.cookie,'POST',{})).status,404);
 assert.equal((await call('/admin',admin.cookie)).json().security,undefined);
 store.run("UPDATE users SET role='member' WHERE id=?",dev.u.id);assert.equal((await call('/dev/health',dev.cookie)).status,403);
 store.run("UPDATE users SET role='dev',deleted_at=? WHERE id=?",store.now(),dev.u.id);assert.equal((await call('/dev/health',dev.cookie)).status,401);
});
test('API failures record verification, limits and internal errors without leaking raw errors',async()=>{
 await call('/auth/verify','','POST',{email:'nobody@example.test',code:'123456'});
 for(let i=0;i<12;i++)await call('/auth/request','','POST',{email:'rate@example.test',name:'Private rate'});
 assert.ok(store.get("SELECT id FROM technical_events WHERE event='access.verification_failed'"));assert.ok(store.get("SELECT id FROM technical_events WHERE event='access.limited'"));
 const original=store.settings;store.settings=()=>{throw Error(sensitive);};
 try{await assert.rejects(()=>call('/bootstrap'),{message:sensitive});}finally{store.settings=original;}
 const error=store.get("SELECT * FROM technical_events WHERE event='system.request_failed'");assert.equal(error.code,'internal_error');assert.doesNotMatch(JSON.stringify(error),/private@|secret-token|payment-987/);
});
test.after(()=>store.db.close());
