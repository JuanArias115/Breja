import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';
import { linkGoogleUser } from '../server/firebase.js';
import { dispatch } from './dispatch.js';
import vm from 'node:vm';

process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
process.env.ADMIN_EMAIL='bootstrap-admin@example.test';
const {api,store}=await import('../server/index.js');
const call=(path,cookie='',method='GET',body)=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});
const application={name:'New Player',display_name:'New Player',birthday:'1996-02-29',position:'central_midfielder',position_secondary:'winger',language:'es'};
const cookieOf=response=>response.headers['set-cookie'].split(';')[0];
async function signup(email){
 const requested=await call('/auth/request','','POST',{email,name:'New Player',language:'es'});
 assert.equal(requested.status,200);
 const login=await call('/auth/verify','','POST',{email,code:requested.json().developmentCode});
 assert.equal(login.status,200);return cookieOf(login);
}
async function adminSession(){return cookieOf(await call('/auth/development','','POST',{role:'admin'}));}

test('new email signups complete an application and gain access only after an administrator accepts it',async()=>{
 const cookie=await signup('application-accepted@example.test'),admin=await adminSession();
 let data=(await call('/bootstrap',cookie)).json();const uid=data.me.id;
 assert.equal(data.me.membership_status,'onboarding');
 assert.deepEqual(Object.keys(data).sort(),['config','me']);
 assert.equal((await call('/admin/applications/'+uid,admin,'PATCH',{decision:'approved'})).status,409);
 for(const [path,method,body] of [
  ['/admin','GET'],['/profile','PATCH',{...application,membership_status:'approved',role:'admin'}],
  ['/profile/photo','POST',{}],['/members/another/photo','GET'],['/news/another/image','GET'],
  ['/matches/anything/join','POST',{accept_policy:true}],['/registrations/anything/accept','POST',{accept_policy:true}],
  ['/payment-reports','POST',{amount_cents:500,method:'cash'}]
 ])assert.equal((await call(path,cookie,method,body)).status,403,path);
 const sent=await call('/membership/application',cookie,'POST',{...application,role:'admin',membership_status:'approved'});
 assert.equal(sent.status,200);assert.equal(sent.json().membership_status,'pending');assert.equal(sent.json().role,'member');
 assert.equal((await call('/membership/application',cookie,'POST',application)).status,409);
 data=(await call('/bootstrap',cookie)).json();assert.deepEqual(Object.keys(data).sort(),['config','me']);
 assert.equal(data.me.birthday,application.birthday);assert.equal(data.me.position_secondary,'winger');
 assert.equal((await call('/admin/applications/'+uid,cookie,'PATCH',{decision:'approved'})).status,403);
 assert.equal((await call('/admin/members/'+uid+'/role',admin,'PATCH',{role:'admin'})).status,403);
 let review=(await call('/admin',admin)).json();
 assert.ok(review.applications.some(u=>u.id===uid));assert.equal(review.members.some(u=>u.id===uid),false);
 assert.equal((await call('/admin/applications/'+uid,admin,'PATCH',{decision:'approved'})).status,200);
 assert.equal((await call('/admin/applications/'+uid,admin,'PATCH',{decision:'approved'})).status,200);
 assert.equal(store.get("SELECT count(*) n FROM audit WHERE entity_id=? AND action='membership.approved'",uid).n,1);
 data=(await call('/bootstrap',cookie)).json();assert.equal(data.me.membership_status,'approved');assert.ok(data.matches);assert.ok(data.account);
 assert.equal(data.me.role,'member');assert.ok(data.me.membership_reviewed_at);
 review=(await call('/admin',admin)).json();assert.ok(review.members.some(u=>u.id===uid));assert.equal(review.applications.some(u=>u.id===uid),false);
 // Acceptance applies to the existing session and the profile preserves both positions.
 const updated=await call('/profile',cookie,'PATCH',{...data.me,position_secondary:'striker'});assert.equal(updated.status,200);
 assert.equal((await call('/bootstrap',cookie)).json().me.position_secondary,'striker');
});

test('rejected requests stay blocked after logging in again and cannot self-resubmit or change role',async()=>{
 const cookie=await signup('application-rejected@example.test'),admin=await adminSession();
 const uid=(await call('/bootstrap',cookie)).json().me.id;
 assert.equal((await call('/membership/application',cookie,'POST',application)).status,200);
 assert.equal((await call('/admin/applications/'+uid,admin,'PATCH',{decision:'rejected'})).status,200);
 assert.equal((await call('/admin/applications/'+uid,admin,'PATCH',{decision:'approved'})).status,409);
 assert.equal((await call('/membership/application',cookie,'POST',application)).status,409);
 assert.equal((await call('/profile',cookie,'PATCH',{...application,membership_status:'approved'})).status,403);
 assert.equal((await call('/auth/logout',cookie,'POST',{})).status,200);
 assert.equal((await call('/bootstrap',cookie)).json().me,null);
 const again=await signup('application-rejected@example.test');const state=(await call('/bootstrap',again)).json();
 assert.equal(state.me.membership_status,'rejected');assert.deepEqual(Object.keys(state).sort(),['config','me']);
 const claims={uid:'rejected-google',email:'application-rejected@example.test',email_verified:true,firebase:{sign_in_provider:'google.com'}};
 assert.equal(linkGoogleUser(store,claims,'en',process.env.ADMIN_EMAIL).membership_status,'rejected');
});

test('applications validate real birthdays and one or two distinct football positions without partial writes',async()=>{
 const cookie=await signup('application-validation@example.test');const uid=(await call('/bootstrap',cookie)).json().me.id;
 for(const birthday of ['', '1995-02-29','2026-02-30','2099-01-01','not-a-date']){
  const result=await call('/membership/application',cookie,'POST',{...application,birthday});assert.equal(result.status,400,birthday);
 }
 for(const positions of [{position:''},{position:'unknown'},{position_secondary:'unknown'},{position_secondary:application.position}]){
  assert.equal((await call('/membership/application',cookie,'POST',{...application,...positions})).status,400);
 }
 assert.equal(store.get('SELECT membership_status,birthday FROM users WHERE id=?',uid).birthday,'');
 const crossOrigin=await dispatch(api,'/api/membership/application',{method:'POST',body:application,headers:{cookie,origin:'https://untrusted.test'}});
 assert.equal(crossOrigin.status,403);
 assert.equal((await call('/membership/application',cookie,'POST',{...application,position_secondary:''})).status,200);
 assert.equal(store.get('SELECT position_secondary FROM users WHERE id=?',uid).position_secondary,'');
});

test('Google uses the same admission flow, retains manual approvals, and exempts the initial administrator',()=>{
 const db=new Store();try{
  const claims=email=>({uid:email,email,name:'Google Player',email_verified:true,firebase:{sign_in_provider:'google.com'}});
  const initial=linkGoogleUser(db,claims('owner@example.test'),'en','owner@example.test');
  assert.equal(initial.role,'admin');assert.equal(initial.membership_status,'approved');
  const player=linkGoogleUser(db,claims('new@example.test'),'en','owner@example.test');
  assert.equal(player.membership_status,'onboarding');assert.equal(player.role,'member');
  db.submitApplication(player.id,application);
  assert.equal(linkGoogleUser(db,claims('new@example.test'),'de','owner@example.test').membership_status,'pending');
  const manual=db.addUser({name:'Invited',email:'manual@example.test'});
  assert.equal(linkGoogleUser(db,claims(manual.email),'en','owner@example.test').membership_status,'approved');
  const dev=db.addUser({name:'Dev',email:'dev@example.test'},'dev');
  assert.throws(()=>db.reviewApplication(dev.id,player.id,'approved'),{code:'forbidden'});
  assert.throws(()=>db.reviewApplication(player.id,player.id,'approved'),{code:'forbidden'});
 }finally{db.db.close();}
});

test('configured bootstrap email cannot bypass admission when an administrator already exists',async()=>{
 const cookie=await signup('bootstrap-admin@example.test'),data=(await call('/bootstrap',cookie)).json();
 assert.equal(data.me.role,'member');assert.equal(data.me.membership_status,'onboarding');assert.equal(data.matches,undefined);
 assert.equal((await call('/admin',cookie)).status,403);
});

test('migration preserves existing members, sessions and balances, and application decisions survive restarts',t=>{
 const dir=mkdtempSync(join(tmpdir(),'breja-membership-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'db.sqlite');
 let db=new Store(path);const admin=db.addUser({name:'Owner',email:'owner@example.test'},'admin');
 const member=db.addUser({name:'Existing',email:'existing@example.test'});
 db.run('INSERT INTO sessions VALUES (?,?,?)','existing-session',member.id,'2099-01-01');
 db.payment(admin.id,{user_id:member.id,amount_cents:500,method:'cash',request_key:'migration-proof'});db.db.close();
 const legacy=new DatabaseSync(path);
 for(const column of ['membership_status','position_secondary','application_submitted_at','membership_reviewed_at','membership_reviewed_by'])legacy.exec('ALTER TABLE users DROP COLUMN '+column);
 legacy.close();db=new Store(path);
 assert.equal(db.get('SELECT membership_status FROM users WHERE id=?',member.id).membership_status,'approved');
 assert.equal(db.balance(member.id),-500);assert.ok(db.get('SELECT * FROM sessions WHERE token_hash=?','existing-session'));
 const applicant=db.addUser({name:'Applicant',email:'applicant@example.test'},'member','onboarding');db.submitApplication(applicant.id,application);db.db.close();
 db=new Store(path);assert.equal(db.get('SELECT membership_status FROM users WHERE id=?',applicant.id).membership_status,'pending');
 db.reviewApplication(admin.id,applicant.id,'approved');db.db.close();db=new Store(path);
 assert.equal(db.get('SELECT membership_status FROM users WHERE id=?',applicant.id).membership_status,'approved');assert.equal(db.balance(member.id),-500);db.db.close();
});

test('all admission screens render in three languages without private navigation, including direct URLs',async()=>{
 const cookie=await signup('render-application@example.test'),admin=await adminSession();
 const app={innerHTML:'',addEventListener(){}};
 const document={getElementById:()=>app,addEventListener(){},documentElement:{}};
 const storage=new Map();const localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
 globalThis.localStorage=localStorage;globalThis.document=document;
 const i18n=await import('../public/i18n.js');
 const context=vm.createContext({document,localStorage,window:{addEventListener(){}},location:{pathname:'/'},...i18n});
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/boot\(\);\s*$/,'globalThis.ui={state,render,applicationList};');
 vm.runInContext(source,context);
 const check=async(status)=>{
  context.ui.state.data=(await call('/bootstrap',cookie)).json();
  assert.equal(context.ui.state.data.me.membership_status,status);
  for(const language of ['en','de','es']){
   i18n.setLanguage(language);context.lang=language;
   for(const route of ['/','/matches','/members','/profile','/payments']){
    context.ui.state.route=route;context.ui.render();
    assert.doesNotMatch(app.innerHTML,/class="(?:sidebar|mobile-nav|workspace)"|data-action="(?:join|record-payment|edit-role)"/);
    assert.ok(app.innerHTML.includes(i18n.t(status==='onboarding'?'joinClub':status==='pending'?'applicationPending':'applicationRejected')));
    if(status==='onboarding'){
     assert.match(app.innerHTML,/name="birthday"[^>]*required/);assert.match(app.innerHTML,/select name="position" required/);
     assert.match(app.innerHTML,/select name="position_secondary"/);
    }else assert.doesNotMatch(app.innerHTML,/id="membership-form"/);
   }
  }
 };
 await check('onboarding');
 const uid=context.ui.state.data.me.id;
 await call('/membership/application',cookie,'POST',{...application,name:'<script>unsafe</script>'});await check('pending');
 context.ui.state.admin=(await call('/admin',admin)).json();
 const panel=context.ui.applicationList();assert.match(panel,/&lt;script&gt;unsafe&lt;\/script&gt;/);assert.doesNotMatch(panel,/<script>/);
 assert.match(panel,/data-action="approve-application"/);assert.match(panel,/data-action="reject-application"/);
 await call('/admin/applications/'+uid,admin,'PATCH',{decision:'rejected'});await check('rejected');
});
