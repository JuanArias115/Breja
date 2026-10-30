import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Store } from '../server/store.js';
import { dispatch } from './dispatch.js';
import * as matchUtils from '../public/match-utils.js';
import * as calendar from '../public/calendar.js';

process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
const call=(path,options={})=>dispatch(api,path,options);
const adminLogin=await call('/api/auth/development',{method:'POST',body:{role:'admin'}});
const adminCookie=adminLogin.headers['set-cookie'].split(';')[0];
const admin=store.get("SELECT * FROM users WHERE email='alex@example.test'");
const dev=store.addUser({name:'Developer',email:'developer@example.test'},'dev');
const code=(await call('/api/auth/request',{method:'POST',body:{email:dev.email,name:dev.name}})).json().developmentCode;
const devLogin=await call('/api/auth/verify',{method:'POST',body:{email:dev.email,code}});
const devCookie=devLogin.headers['set-cookie'].split(';')[0];

test('developer receives no financial data and cannot reach financial or member-management actions',async()=>{
 store.payment(admin.id,{user_id:dev.id,amount_cents:500,method:'cash',request_key:'dev-privacy'});
 const state=(await call('/api/bootstrap',{headers:{cookie:devCookie}})).json();
 for(const key of ['account','statements','members','ledger','reports','outbox','audit'])assert.equal(state[key],undefined,key);
 assert.deepEqual(Object.keys(state.settings).sort(),['cancel_hours','capacity','price_cents','timezone']);
 assert.ok(state.matches.length);assert.equal(state.me.role,'dev');
 for(const match of state.matches)for(const r of match.registrations)for(const key of ['email','phone','balance','responsible_id'])assert.equal(r[key],undefined,key);
 const before=store.all('SELECT * FROM ledger');
 for(const [path,method] of [['/api/admin','GET'],['/api/admin/export','GET'],['/api/admin/payments','POST'],['/api/admin/statements/preview','POST'],['/api/admin/statements/generate','POST'],['/api/admin/ledger/x/reverse','POST'],['/api/admin/reports/x','POST'],['/api/admin/matches/x/close','POST'],['/api/admin/matches/x/cancel','POST'],['/api/admin/members','POST'],['/api/admin/members/'+dev.id+'/role','PATCH'],['/api/payment-reports','POST'],['/api/matches/x/join','POST'],['/api/registrations/x/cancel','POST'],['/api/registrations/x/accept','POST']]){
  assert.equal((await call(path,{method,headers:{cookie:devCookie},...(method==='GET'?{}:{body:{role:'admin',accept_fee:true,accept_policy:true}})})).status,403,path);
 }
 assert.deepEqual(store.all('SELECT * FROM ledger'),before);
});

test('developer manages venues, drafts and general settings without changing payment details',async()=>{
 const request=(path,method,body)=>call(path,{method,body,headers:{cookie:devCookie}});
 const venue=await request('/api/admin/venues','POST',{name:'Technical test pitch',address:'Pitch street 1',season:'summer'});assert.equal(venue.status,201);
 const v=venue.json();assert.equal((await request('/api/admin/venues/'+v.id,'PATCH',{...v,address:'Pitch street 2'})).status,200);
 const result=await request('/api/admin/matches','POST',{title:'Developer match',venue_id:v.id,starts_at:'2099-11-03T10:00:00Z',ends_at:'2099-11-03T11:00:00Z',price_cents:500,capacity:14,cancel_hours:24,status:'draft'});assert.equal(result.status,201);
 const mid=result.json().id;assert.equal((await request('/api/admin/matches/'+mid+'/publish','POST',{})).status,200);
 const settings=store.settings();assert.equal((await request('/api/admin/settings','PATCH',{...settings,capacity:16,payment_instructions_en:'Unauthorised change'})).status,200);
 assert.equal(store.settings().capacity,16);assert.equal(store.settings().payment_instructions_en,settings.payment_instructions_en);
 assert.equal((await request('/api/admin/venues/'+v.id+'/archive','PATCH',{archived:true})).status,200);
 assert.ok((await call('/api/bootstrap',{headers:{cookie:devCookie}})).json().venues.some(venue=>venue.id===v.id&&venue.archived));
});

test('only administrators assign roles, changes affect existing sessions and the last admin is protected',async()=>{
 const change=(uid,role,cookie=adminCookie)=>call('/api/admin/members/'+uid+'/role',{method:'PATCH',body:{role},headers:{cookie}});
 assert.equal((await change(admin.id,'dev')).json().error,'last_admin');
 assert.equal((await change(dev.id,'owner')).json().error,'invalid_role');
 assert.equal((await change('missing','member')).status,404);
 assert.equal((await change(dev.id,'admin')).status,200);
 assert.equal((await call('/api/admin',{headers:{cookie:devCookie}})).status,200);
 assert.equal((await change(dev.id,'dev')).status,200);
 assert.equal((await call('/api/admin',{headers:{cookie:devCookie}})).status,403);
 assert.equal((await call('/api/admin',{headers:{cookie:adminCookie}})).json().roster,undefined);
 assert.equal((await call('/api/admin/roster/old',{method:'PATCH',body:{user_id:dev.id},headers:{cookie:adminCookie}})).status,404);
});

test('retiring the Excel directory preserves registered accounts, sessions and balances across restarts',()=>{
 const directory=mkdtempSync(join(tmpdir(),'breja-roster-')),path=join(directory,'test.sqlite');
 let s;
 try{
  s=new Store(path);const u=s.addUser({name:'Registered',email:'registered@example.test'},'admin');
  s.payment(u.id,{user_id:u.id,amount_cents:500,method:'cash',request_key:'migration-payment'});
  s.run('INSERT INTO sessions VALUES (?,?,?)','test-session',u.id,'2099-01-01');
  s.db.exec('CREATE TABLE roster (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id))');s.run('INSERT INTO roster VALUES (?,?)','imported',u.id);s.db.close();s=null;
  for(let pass=0;pass<2;pass++){
   s=new Store(path);assert.equal(s.get("SELECT name FROM sqlite_master WHERE name='roster'"),undefined);
   assert.equal(s.get('SELECT name FROM users WHERE id=?',u.id).name,'Registered');assert.equal(s.balance(u.id),-500);assert.equal(s.get('SELECT user_id FROM sessions').user_id,u.id);s.db.close();s=null;
  }
 }finally{s?.db.close();for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))unlinkSync(path+suffix);rmdirSync(directory);}
});

test('role-aware pages render without financial payloads and protect direct navigation',async()=>{
 // Render actual UI functions as strings without a browser or network access.
 const app={innerHTML:'',addEventListener(){}};
 const document={getElementById:()=>app,addEventListener(){},documentElement:{}};
 const storage={getItem:()=>null,setItem(){}};
 globalThis.localStorage=storage;globalThis.document=document;
 const i18n=await import('../public/i18n.js');
 const context=vm.createContext({document,localStorage:storage,window:{addEventListener(){}},location:{pathname:'/'},...matchUtils,...calendar,...i18n});
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/boot\(\);\s*$/,'globalThis.ui={state,render,roleDialog};');
 vm.runInContext(source,context);
 context.ui.state.data=(await call('/api/bootstrap',{headers:{cookie:devCookie}})).json();
 for(const path of ['/','/matches','/settings','/venues','/profile','/matches/'+context.ui.state.data.matches[0].id]){
  context.ui.state.route=path;context.ui.render();assert.doesNotMatch(app.innerHTML,/href="\/(account|members|payments|statements)"|data-action="(record-payment|join|guest|close-match|cancel-match)"|name="payment_instructions/);
 }
 for(const path of ['/members','/account','/payments','/statements']){context.ui.state.route=path;context.ui.render();assert.ok(app.innerHTML.includes(i18n.t('not_found')));}
 context.ui.state.data=(await call('/api/bootstrap',{headers:{cookie:adminCookie}})).json();context.ui.state.admin=(await call('/api/admin',{headers:{cookie:adminCookie}})).json();
 context.ui.state.route='/members';context.ui.render();assert.match(app.innerHTML,/data-action="edit-role"/);assert.doesNotMatch(app.innerHTML,/link-roster|member-tab/);
 context.ui.state.route='/settings';context.ui.render();assert.match(app.innerHTML,/name="payment_instructions_en"/);
});

test.after(()=>store.db.close());
