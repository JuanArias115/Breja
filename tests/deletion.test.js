import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { Store, id } from '../server/store.js';
import { linkGoogleUser } from '../server/firebase.js';
import { dispatch } from './dispatch.js';

const facts=entries=>entries.map(({description,payer_name,...financial})=>({...financial}));
const claims=email=>({uid:'google-'+email,email,name:'Private Person',email_verified:true,firebase:{sign_in_provider:'google.com'}});
function fixture(t){
 let now=new Date('2026-10-01T10:00:00Z');const s=new Store(':memory:',()=>now);t.after(()=>s.db.close());
 const admin=s.addUser({name:'Owner',email:'owner@example.test'},'admin');
 const member=s.addUser({name:'Private Person',display_name:'Private Nick',email:'private@example.test'});
 const other=s.addUser({name:'Other',email:'other@example.test'});
 const create=(date='2026-10-03',capacity=2)=>s.createMatch(admin.id,{title:'Club match',starts_at:date+'T10:00:00Z',ends_at:date+'T11:30:00Z',timezone:'Europe/Vienna',venue:'USI',capacity,price_cents:500,allow_guests:true,cancel_hours:24});
 return {s,admin,member,other,create,clock:date=>{now=new Date(date);}};
}

test('anonymization retains financial facts, balances and statement totals while removing linked personal copies',t=>{
 const {s,admin,member,other,create,clock}=fixture(t);
 s.run("UPDATE users SET firebase_uid='private-firebase',phone='private-phone',birthday='1990-01-01',position='winger',position_secondary='striker' WHERE id=?",member.id);
 s.run('INSERT INTO sessions VALUES (?,?,?)','private-session',member.id,'2099-01-01');
 s.run('INSERT INTO profile_photos VALUES (?,?,?)',member.id,'private-photo','v1');
 s.run('INSERT INTO login_codes VALUES (?,?,?,0,?,?)',member.email,'hash','2099-01-01',JSON.stringify(member),s.now());
 const match=create(),own=s.join(member.id,match.id),guest=s.join(member.id,match.id,'Private Guest');
 clock('2026-10-03T12:00:00Z');s.closeMatch(admin.id,match.id,{[own.id]:'played',[guest.id]:'played'});
 const payment=s.payment(admin.id,{user_id:member.id,amount_cents:300,method:'cash',payer_name:member.name,note:member.email,request_key:'payment-one'});
 s.reverse(admin.id,payment.id,'Correction for '+member.email);
 s.payment(admin.id,{user_id:member.id,amount_cents:200,method:'transfer',request_key:'payment-two',note:member.name});
 s.payment(admin.id,{user_id:other.id,amount_cents:400,method:'cash',request_key:'other-payment',note:'Unchanged note'});
 s.run('INSERT INTO payment_reports VALUES (?,?,?,?,?,?,?)',id(),member.id,200,'cash',member.email,'pending',s.now());
 s.audit(admin.id,'member.update',member.id,{email:member.email});
 s.enqueue(member,'login','login-private',member.name,member.email);
 s.enqueue({id:null,email:member.email},'login','login-null',member.name,member.email);
 clock('2026-11-02T12:00:00Z');s.generateStatements(admin.id,'2026-10');
 const ledger=s.all('SELECT * FROM ledger ORDER BY id'),before=s.balance(member.id);
 const snapshot=JSON.parse(s.get('SELECT snapshot FROM statements WHERE user_id=?',member.id).snapshot);
 assert.ok(s.leaderboard().some(u=>u.id===member.id));
 const result=s.anonymizeMember(admin.id,member.id),deleted=s.get('SELECT * FROM users WHERE id=?',member.id);
 assert.equal(deleted.deleted_at,result.deleted_at);assert.equal(deleted.deleted_by,admin.id);
 for(const field of ['email','firebase_uid'])assert.equal(deleted[field],null);
 for(const field of ['phone','birthday','position','position_secondary'])assert.equal(deleted[field],'');
 assert.match(deleted.display_name,/^Deleted member/);assert.equal(deleted.name,deleted.display_name);
 assert.equal(s.balance(member.id),before);assert.equal(before,800);
 assert.deepEqual(facts(s.all('SELECT * FROM ledger ORDER BY id')),facts(ledger));
 assert.deepEqual(s.get('SELECT * FROM ledger WHERE user_id=?',other.id),ledger.find(l=>l.user_id===other.id));
 const clean=JSON.parse(s.get('SELECT snapshot FROM statements WHERE user_id=?',member.id).snapshot);
 assert.deepEqual([clean.opening,clean.closing,clean.current],[snapshot.opening,snapshot.closing,snapshot.current]);
 assert.deepEqual(facts(clean.entries),facts(snapshot.entries));assert.equal(clean.user.id,member.id);
 for(const table of ['users','ledger','payment_reports','statements','outbox','audit','profile_photos','login_codes','registrations']){
  const serialized=JSON.stringify(s.all('SELECT * FROM '+table));
  for(const value of ['Private Person','Private Nick','Private Guest','private@example.test','private-phone','private-firebase','private-photo'])assert.equal(serialized.includes(value),false,table+': '+value);
 }
 assert.equal(s.get('SELECT COUNT(*) n FROM sessions WHERE user_id=?',member.id).n,0);
 assert.equal(s.leaderboard().some(u=>u.id===member.id),false);
 assert.deepEqual(s.all('PRAGMA foreign_key_check'),[]);
 assert.deepEqual(s.anonymizeMember(admin.id,member.id),result);
 assert.equal(s.get("SELECT COUNT(*) n FROM audit WHERE action='member.anonymize'").n,1);
 // Financial corrections and settlement still work without reintroducing personal free text.
 const paid=s.payment(admin.id,{user_id:member.id,amount_cents:800,method:'cash',request_key:'settle',payer_name:member.name,note:member.email});
 assert.equal(s.balance(member.id),0);assert.equal(paid.payer_name,'');assert.equal(paid.description,'Payment');
 s.reverse(admin.id,paid.id,member.email);assert.equal(s.balance(member.id),800);
 assert.equal(s.get('SELECT description FROM ledger WHERE reverses_id=?',paid.id).description,'Reversal');
 clock('2026-12-02T12:00:00Z');s.generateStatements(admin.id,'2026-11');
 assert.equal(s.get('SELECT COUNT(*) n FROM outbox WHERE user_id=?',member.id).n,0);
});

test('future personal and guest bookings are cancelled, waiting lists advance, and late fees remain collectible',t=>{
 const {s,admin,member,other,create,clock}=fixture(t);
 const late=create('2026-10-02',3),free=create('2026-10-04'),waiting=create('2026-10-05'),offered=create('2026-10-06');
 const lateOwn=s.join(member.id,late.id),lateGuest=s.join(member.id,late.id,'Guest name'),lateOther=s.join(other.id,late.id);
 const freeOwn=s.join(member.id,free.id);s.join(admin.id,free.id);const next=s.join(other.id,free.id);
 s.join(admin.id,waiting.id);s.join(other.id,waiting.id);const wait=s.join(member.id,waiting.id);
 s.join(admin.id,offered.id);const leave=s.join(other.id,offered.id),offer=s.join(member.id,offered.id);s.cancelRegistration(other.id,leave.id);
 clock('2026-10-02T09:00:00Z');s.anonymizeMember(admin.id,member.id);
 const status=r=>s.get('SELECT status FROM registrations WHERE id=?',r.id).status;
 assert.equal(status(lateOwn),'late_cancelled');assert.equal(status(lateGuest),'late_cancelled');
 for(const r of [freeOwn,wait,offer])assert.equal(status(r),'cancelled');
 assert.equal(status(next),'offered');assert.equal(s.balance(member.id),0);
 clock('2026-10-02T12:00:00Z');s.closeMatch(admin.id,late.id,{[lateOther.id]:'played'});
 assert.equal(s.balance(member.id),1000);s.closeMatch(admin.id,late.id,{});assert.equal(s.balance(member.id),1000);
 assert.equal(s.get('SELECT COUNT(*) n FROM outbox WHERE user_id=?',member.id).n,0);
});

test('Google re-registration starts fresh, including a deleted bootstrap admin; self-deletion and restoration are blocked',t=>{
 const {s,admin,member}=fixture(t);
 const initial=linkGoogleUser(s,claims('initial@example.test'),'es','initial@example.test');
 assert.equal(initial.role,'member'); // An administrator already exists.
 s.submitApplication(initial.id,{name:initial.name,birthday:'1990-01-01',position:'winger',language:'es'});
 s.reviewApplication(admin.id,initial.id,'approved');s.setRole(admin.id,initial.id,'admin');
 assert.throws(()=>s.anonymizeMember(admin.id,admin.id),{code:'cannot_delete_self'});
 assert.throws(()=>s.anonymizeMember(member.id,initial.id),{code:'forbidden'});
 s.anonymizeMember(admin.id,initial.id);
 const again=linkGoogleUser(s,claims('initial@example.test'),'es','initial@example.test');
 assert.notEqual(again.id,initial.id);assert.equal(again.role,'member');assert.equal(again.membership_status,'onboarding');
 assert.equal(s.balance(again.id),0);
 assert.throws(()=>s.setRole(admin.id,initial.id,'admin'),{code:'membership_required'});
 assert.throws(()=>s.reviewApplication(admin.id,initial.id,'approved'),{code:'not_found'});
 assert.throws(()=>s.anonymizeMember(initial.id,member.id),{code:'forbidden'});
});

test('additive deletion migration preserves existing financial rows and persists tombstones across restarts',t=>{
 const dir=mkdtempSync(join(tmpdir(),'breja-delete-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite');
 let s=new Store(path);const admin=s.addUser({name:'Owner',email:'owner@example.test'},'admin'),u=s.addUser({name:'Member',email:'member@example.test'});
 s.payment(admin.id,{user_id:u.id,amount_cents:100,method:'cash',request_key:'persistent'});const rows=s.all('SELECT * FROM ledger');s.db.close();
 const legacy=new DatabaseSync(path);legacy.exec('ALTER TABLE users DROP COLUMN deleted_at; ALTER TABLE users DROP COLUMN deleted_by');legacy.close();
 s=new Store(path);assert.equal(s.get('SELECT deleted_at FROM users WHERE id=?',u.id).deleted_at,null);assert.deepEqual(s.all('SELECT * FROM ledger'),rows);
 s.anonymizeMember(admin.id,u.id);s.db.close();s=new Store(path);
 assert.ok(s.get('SELECT deleted_at FROM users WHERE id=?',u.id).deleted_at);assert.equal(s.balance(u.id),-100);assert.deepEqual(s.all('PRAGMA foreign_key_check'),[]);s.db.close();
});

test('a failed cleanup rolls back identity, sessions and financial metadata together',t=>{
 const {s,admin,member}=fixture(t);s.run('INSERT INTO sessions VALUES (?,?,?)','active',member.id,'2099-01-01');
 s.run('INSERT INTO statements VALUES (?,?,?,?,?)',id(),member.id,'2026-09','invalid-json',s.now());
 assert.throws(()=>s.anonymizeMember(admin.id,member.id),SyntaxError);
 assert.equal(s.get('SELECT email FROM users WHERE id=?',member.id).email,member.email);
 assert.ok(s.get("SELECT * FROM sessions WHERE token_hash='active'"));
 assert.equal(s.get("SELECT COUNT(*) n FROM audit WHERE action='member.anonymize'").n,0);
});

process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
const call=(path,cookie='',method='GET',body)=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});
const cookieOf=r=>r.headers['set-cookie'].split(';')[0];

test('deletion API requires an administrator, same origin and confirmation; old sessions and codes fail and accounts remain settleable',async()=>{
 const admin=cookieOf(await call('/auth/development','','POST',{role:'admin'}));
 const member=cookieOf(await call('/auth/development','','POST',{role:'member'}));
 const user=(await call('/bootstrap',member)).json().me;
 const path='/admin/members/'+user.id;
 const adminId=(await call('/bootstrap',admin)).json().me.id;
 const code=(await call('/auth/request','','POST',{email:user.email,name:user.name})).json().developmentCode;
 const before=store.balance(user.id),received=(await call('/admin',admin)).json().stats.received;
 assert.equal((await call(path,'','DELETE',{confirm:true})).status,401);
 assert.equal((await call(path,member,'DELETE',{confirm:true})).status,403);
 const dev=store.addUser({name:'Dev',email:'delete-dev@example.test'},'dev');
 store.run('INSERT INTO sessions VALUES (?,?,?)',(await import('node:crypto')).createHash('sha256').update('dev-token').digest('hex'),dev.id,'2099-01-01');
 assert.equal((await call(path,'breja_session=dev-token','DELETE',{confirm:true})).status,403);
 assert.equal((await call(path,admin,'DELETE',{})).status,400);
 assert.equal((await dispatch(api,'/api'+path,{method:'DELETE',body:{confirm:true},headers:{cookie:admin,origin:'https://other.test'}})).status,403);
 assert.equal((await call('/admin/members/'+adminId,admin,'DELETE',{confirm:true})).status,409);
 // A slow profile upload authenticated before deletion must not restore personal data afterwards.
 let release;const upload=new Promise(resolve=>{release=resolve;});
 const req=Readable.from((async function*(){await upload;yield JSON.stringify({...user,name:'Restored private data'});})());
 req.method='PATCH';req.headers={cookie:member,origin:'http://breja.test','content-type':'application/json'};req.socket={remoteAddress:'slow-upload'};
 const pending=api(req,{writeHead(){},end(){}},new URL('http://breja.test/api/profile')).then(()=>null,e=>e);
 assert.equal((await call(path,admin,'DELETE',{confirm:true})).status,200);
 release();assert.equal((await pending).code,'unauthorized');
 assert.equal((await call('/bootstrap',member)).json().me,null);
 assert.equal((await call('/profile',member,'PATCH',user)).status,401);
 assert.equal((await call('/auth/verify','','POST',{email:user.email,code})).status,401);
 const data=(await call('/admin',admin)).json();
 assert.equal(data.members.some(u=>u.id===user.id),false);assert.equal(data.applications.some(u=>u.id===user.id),false);
 assert.equal(data.archivedMembers.find(u=>u.id===user.id).balance,before);assert.equal(data.stats.received,received);
 assert.doesNotMatch((await call('/admin/export',admin)).body,new RegExp(user.email.replaceAll('.','\\.')));
 const request=await call('/auth/request','','POST',{email:user.email,name:'New application'});
 const login=await call('/auth/verify','','POST',{email:user.email,code:request.json().developmentCode});
 const fresh=(await call('/bootstrap',cookieOf(login))).json().me;
 assert.notEqual(fresh.id,user.id);assert.equal(fresh.membership_status,'onboarding');assert.equal(fresh.role,'member');
 assert.equal(store.balance(fresh.id),0);assert.equal(store.balance(user.id),before);
 assert.equal((await call('/admin/payments',admin,'POST',{user_id:user.id,amount_cents:100,method:'cash',request_key:'archived-settlement'})).status,201);
});

test('member management renders deletion and archived settlement controls in all languages, with archived balances included',async()=>{
 const admin=cookieOf(await call('/auth/development','','POST',{role:'admin'}));
 const app={innerHTML:'',addEventListener(){}};const document={getElementById:()=>app,addEventListener(){},documentElement:{}};
 const localStorage={getItem:()=>null,setItem(){}};globalThis.localStorage=localStorage;globalThis.document=document;
 const i18n=await import('../public/i18n.js');
 const context=vm.createContext({document,localStorage,window:{addEventListener(){}},location:{pathname:'/'},...i18n});
 vm.runInContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/boot\(\);\s*$/,'globalThis.ui={state,membersPage,paymentsPage,financialMembers};'),context);
 context.ui.state.data=(await call('/bootstrap',admin)).json();context.ui.state.admin=(await call('/admin',admin)).json();
 const archived=context.ui.state.admin.archivedMembers[0];assert.ok(archived);
 for(const language of ['en','de','es']){
  i18n.setLanguage(language);context.lang=language;
  const html=context.ui.membersPage();assert.ok(html.includes(i18n.t('archivedMembers')));assert.ok(html.includes(i18n.t('deleteProfile')));
  assert.ok(html.includes(archived.display_name));assert.match(html,new RegExp('data-action="member-payment" data-id="'+archived.id+'"'));
  assert.doesNotMatch(html,new RegExp('data-action="delete-member" data-id="'+context.ui.state.data.me.id+'"'));
  const due=context.ui.financialMembers().reduce((n,u)=>n+Math.max(0,u.balance),0);
  assert.ok(context.ui.paymentsPage().includes(i18n.money(due)));
 }
});
