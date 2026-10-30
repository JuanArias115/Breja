import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatch } from './dispatch.js';
process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
const call=(path,options={})=>dispatch(api,path,options);
let adminCookie='',memberCookie='';
test('development sessions and anonymous bootstrap do not expose member data',async()=>{
 const publicData=(await call('/api/bootstrap')).json();assert.equal(publicData.me,null);assert.equal(publicData.matches,undefined);
 const login=await call('/api/auth/development',{method:'POST',body:{role:'admin'}});adminCookie=login.headers['set-cookie'].split(';')[0];assert.match(login.headers['set-cookie'],/HttpOnly; SameSite=Lax/);
 const member=await call('/api/auth/development',{method:'POST',body:{role:'member'}});memberCookie=member.headers['set-cookie'].split(';')[0];
 assert.equal((await call('/api/admin',{headers:{cookie:memberCookie}})).status,403);
 assert.equal((await call('/api/admin')).status,401);
});
test('CSRF protection and public invitation privacy',async()=>{
 assert.equal((await call('/api/admin/matches',{method:'POST',headers:{cookie:adminCookie,origin:'https://wrong.example'},body:{}})).status,403);
 const state=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json();const match=state.matches.find(m=>m.status==='open');
 const publicMatch=(await call('/api/public/match/'+match.share_token)).json();assert.equal(publicMatch.registrations,undefined);assert.equal(publicMatch.created_by,undefined);assert.ok(publicMatch.title);
 assert.equal(state.matches.find(m=>m.registrations.length).registrations[0].responsible_id,undefined);
});
test('email codes are single-use and create a verified member; member cannot create a match',async()=>{
 const email='qa-person@example.test';const request=(await call('/api/auth/request',{method:'POST',body:{email,name:'QA Person',language:'de'}})).json();assert.match(request.developmentCode,/^\d{6}$/);
 assert.equal((await call('/api/auth/verify',{method:'POST',body:{email,code:'000000'}})).status,401);
 const verified=await call('/api/auth/verify',{method:'POST',body:{email,code:request.developmentCode}});assert.equal(verified.status,200);
 assert.equal((await call('/api/auth/verify',{method:'POST',body:{email,code:request.developmentCode}})).status,401);
 const cookie=verified.headers['set-cookie'].split(';')[0];const me=(await call('/api/bootstrap',{headers:{cookie}})).json().me;assert.equal(me.role,'member');assert.equal(me.language,'de');
 assert.equal((await call('/api/admin/matches',{method:'POST',body:{},headers:{cookie}})).status,403);
});
test('reported payments do not reduce debt until an administrator confirms once',async()=>{
 const before=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json().account.balance;
 assert.equal((await call('/api/payment-reports',{method:'POST',headers:{cookie:memberCookie},body:{amount_cents:500,method:'cash',note:'Test payment'}})).status,200);
 assert.equal((await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json().account.balance,before);
 const report=(await call('/api/admin',{headers:{cookie:adminCookie}})).json().reports[0];
 assert.equal((await call('/api/admin/reports/'+report.id,{method:'POST',headers:{cookie:memberCookie},body:{action:'confirm'}})).status,403);
 assert.equal((await call('/api/admin/reports/'+report.id,{method:'POST',headers:{cookie:adminCookie},body:{action:'confirm'}})).status,200);
 assert.equal((await call('/api/admin/reports/'+report.id,{method:'POST',headers:{cookie:adminCookie},body:{action:'confirm'}})).status,404);
 assert.equal((await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json().account.balance,before-500);
});
test('CSV keeps negative payment amounts and neutralises formulas without losing text',async()=>{
 const user=store.get("SELECT id FROM users WHERE email='alex@example.test'");store.run('UPDATE users SET name=? WHERE id=?','=SUM(A1)',user.id);
 store.payment(user.id,{user_id:user.id,amount_cents:1234,method:'cash',request_key:'csv-proof'});
 const result=await call('/api/admin/export',{headers:{cookie:adminCookie}});assert.match(result.body,/"-1234"/);assert.ok(result.body.includes('"\'=SUM(A1)"'));assert.equal(result.headers['content-type'],'text/csv; charset=utf-8');
});
test('admin manages seasonal venues; players and public invitations receive the match location',async()=>{
 const data={name:'QA summer pitch',address:'Test address 12',map_url:'https://maps.example.test/summer',season:'summer'};
 const request=(path,method,body,cookie=adminCookie)=>call('/api'+path,{method,body,headers:{cookie}});
 assert.equal((await request('/admin/venues','POST',data,memberCookie)).status,403);
 const created=await request('/admin/venues','POST',data);assert.equal(created.status,201);const v=created.json();
 const state=(await call('/api/bootstrap',{headers:{cookie:adminCookie}})).json();
 assert.equal((await request('/admin/settings','PATCH',{...state.settings,default_venue_id:v.id})).status,200);
 const match=(await request('/admin/matches','POST',{title:'Venue API test',venue_id:v.id,starts_at:'2099-10-03T10:00:00Z',ends_at:'2099-10-03T11:00:00Z',capacity:14,price_cents:500,cancel_hours:24})).json();
 assert.ok(match.id);
 const invitation=(await call('/api/public/match/'+match.share_token)).json();assert.equal(invitation.map_url,data.map_url);assert.equal(invitation.address,data.address);assert.equal(invitation.registrations,undefined);
 for(const suffix of ['', '/archive'])assert.equal((await request('/admin/venues/'+v.id+suffix,'PATCH',suffix?{archived:true}:data,memberCookie)).status,403);
 assert.equal((await request('/admin/venues/'+v.id,'PATCH',{...data,name:'Updated pitch'})).status,200);
 assert.equal((await request('/admin/venues/'+v.id+'/archive','PATCH',{archived:true})).status,200);
 const player=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json();assert.equal(player.venues.some(p=>p.id===v.id),false);assert.equal(player.settings.default_venue_id,'');assert.equal(player.matches.find(m=>m.id===match.id).venue,data.name);
 assert.equal((await request('/admin/settings','PATCH',{...state.settings,default_venue_id:v.id})).status,400);
 assert.equal((await request('/admin/venues/'+v.id+'/archive','PATCH',{archived:false})).status,200);
 assert.equal((await request('/admin/venues','POST',{...data,map_url:'javascript:alert(1)'})).status,400);
});

test('Spanish signup, profile, login messages and monthly statements retain the chosen language',async()=>{
 const email='spanish@example.test';const request=(await call('/api/auth/request',{method:'POST',body:{email,name:'Ana',language:'es'}})).json();
 const message=store.get("SELECT * FROM outbox WHERE recipient=? AND kind='login'",email);assert.match(message.subject,/código de acceso/);assert.match(message.body,/Caduca en 10 minutos/);
 const login=await call('/api/auth/verify',{method:'POST',body:{email,code:request.developmentCode}});assert.equal(login.status,200);const cookie=login.headers['set-cookie'].split(';')[0];
 let state=(await call('/api/bootstrap',{headers:{cookie}})).json();assert.equal(state.me.language,'es');
 assert.equal(state.me.membership_status,'onboarding');
 assert.equal((await call('/api/membership/application',{method:'POST',headers:{cookie},body:{name:'Ana',display_name:'Ana',birthday:'1995-02-28',position:'winger',position_secondary:'striker',language:'es'}})).status,200);
 assert.equal((await call('/api/admin/applications/'+state.me.id,{method:'PATCH',headers:{cookie:adminCookie},body:{decision:'approved'}})).status,200);
 state=(await call('/api/bootstrap',{headers:{cookie}})).json();
 assert.equal((await call('/api/profile',{method:'PATCH',headers:{cookie},body:{...state.me,display_name:'Ana ES',language:'es'}})).status,200);
 state=(await call('/api/bootstrap',{headers:{cookie}})).json();assert.equal(state.me.language,'es');
 const body=store.statementText({user:state.me,month:'2026-09',opening:500,closing:1000,entries:[{kind:'charge',amount_cents:500,occurred_at:'2026-09-20T12:00:00Z',description:JSON.stringify({title:'Partido',reason:'played',guest:'Luis'})}]});
 assert.match(body,/Hola Ana ES/);assert.match(body,/Saldo anterior/);assert.match(body,/Invitado: Luis/);assert.match(body,/Contacta con el organizador/);
 const news={title_en:'Test news',title_de:'Testnachricht',body_en:'News body',body_de:'Nachricht',title_es:'Noticia de prueba',body_es:'Contenido de prueba'};
 assert.equal((await call('/api/admin/news',{method:'POST',headers:{cookie:adminCookie},body:news})).status,201);
 assert.equal(store.get('SELECT body_es FROM news WHERE title_es=?',news.title_es).body_es,news.body_es);
});

test('news image persists, is served to members, and stays out of bootstrap payloads',async()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 const body={title_es:'Con imagen',body_es:'Una noticia en español',image_data:image};
 assert.equal((await call('/api/admin/news',{method:'POST',headers:{cookie:memberCookie},body})).status,403);
 const result=await call('/api/admin/news',{method:'POST',headers:{cookie:adminCookie},body});assert.equal(result.status,201);const id=result.json().id;
 const state=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json();const post=state.news.find(n=>n.id===id);
 assert.equal(post.title_es,body.title_es);assert.equal(post.image_data,undefined);assert.equal(post.image_url,'/api/news/'+id+'/image');
 const loaded=await call(post.image_url,{headers:{cookie:memberCookie}});assert.equal(loaded.status,200);assert.equal(loaded.headers['content-type'],'image/png');assert.deepEqual(loaded.body,Buffer.from(image.split(',')[1],'base64'));
 assert.equal((await call(post.image_url)).status,401);
 assert.equal((await call('/api/admin/news',{method:'POST',headers:{cookie:adminCookie},body:{...body,image_data:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='}})).status,400);
 assert.equal((await call('/api/admin/news',{method:'POST',headers:{cookie:adminCookie},body:{title_en:'Missing message'}})).status,400);
});

test('account charges retain the associated match for the detail link',async()=>{
 const member=store.get("SELECT id FROM users WHERE email='sam@example.test'"),admin=store.get("SELECT id FROM users WHERE email='alex@example.test'");
 const m=store.createMatch(admin.id,{title:'Account match',venue:'Test pitch',starts_at:'2099-10-03T10:00:00Z',ends_at:'2099-10-03T11:00:00Z',capacity:14,price_cents:500,cancel_hours:24});
 const r=store.join(member.id,m.id);store.run('UPDATE matches SET starts_at=?,ends_at=? WHERE id=?','2026-01-03T10:00:00Z','2026-01-03T11:00:00Z',m.id);store.closeMatch(admin.id,m.id,{[r.id]:'played'});
 const state=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json(),charge=state.account.ledger.find(e=>e.registration_id===r.id);
 assert.equal(charge.match_id,m.id);assert.equal(state.matches.find(match=>match.id===charge.match_id).venue,'Test pitch');
});

test('manual member creation is admin-only and always creates a member',async()=>{
 const body={name:'Manual user',display_name:'Manual',email:'manual-api@example.test',language:'es',role:'admin'};
 assert.equal((await call('/api/admin/members',{method:'POST',headers:{cookie:memberCookie},body})).status,403);
 const result=await call('/api/admin/members',{method:'POST',headers:{cookie:adminCookie},body});assert.equal(result.status,201);assert.equal(result.json().role,'member');assert.equal(result.json().firebase_uid,undefined);
 assert.equal((await call('/api/admin/members',{method:'POST',headers:{cookie:adminCookie},body})).status,409);
 const requested=(await call('/api/auth/request',{method:'POST',body:{email:body.email,name:'Ignored',language:'es'}})).json();
 const login=await call('/api/auth/verify',{method:'POST',body:{email:body.email,code:requested.developmentCode}});assert.equal(login.status,200);
 const state=(await call('/api/bootstrap',{headers:{cookie:login.headers['set-cookie'].split(';')[0]}})).json();assert.equal(state.me.id,result.json().id);assert.equal(state.me.name,body.name);
});

test('profile photo upload and deletion affect only the signed-in user and require authentication to view',async()=>{
 const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=';
 const admin=store.get("SELECT id FROM users WHERE email='alex@example.test'");
 assert.equal((await call('/api/profile/photo',{method:'POST',body:{image_data:image}})).status,401);
 assert.equal((await call('/api/profile/photo',{method:'POST',headers:{cookie:memberCookie},body:{image_data:image,user_id:admin.id}})).status,200);
 let state=(await call('/api/bootstrap',{headers:{cookie:memberCookie}})).json();const photo=state.photos.find(p=>p.user_id===state.me.id);assert.ok(photo);assert.equal(state.photos.some(p=>p.user_id===admin.id),false);
 assert.equal((await call(photo.url.split('?')[0],{headers:{cookie:adminCookie}})).status,200);assert.equal((await call(photo.url.split('?')[0])).status,401);
 assert.equal(state.me.image_data,undefined);assert.ok(Array.isArray(state.leaderboard));
 assert.equal((await call('/api/profile/photo',{method:'POST',headers:{cookie:memberCookie},body:{image_data:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
 assert.equal((await call('/api/profile/photo',{method:'DELETE',headers:{cookie:memberCookie},body:{}})).status,200);
 assert.equal((await call(photo.url.split('?')[0],{headers:{cookie:memberCookie}})).status,404);
});

test.after(()=>store.db.close());
