import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { dispatch } from './dispatch.js';
test('guest permission defaults off, can change repeatedly, preserves registrations and only admins can change it',t=>{
 const s=new Store(':memory:');t.after(()=>s.db.close());const admin=s.addUser({email:'admin@example.test',name:'Admin'},'admin'),member=s.addUser({email:'member@example.test',name:'Member'}),dev=s.addUser({email:'dev@example.test',name:'Dev'},'dev');
 const m=s.createMatch(admin.id,{title:'Match',venue:'Pitch',starts_at:'2099-01-01T10:00:00Z',ends_at:'2099-01-01T11:00:00Z',capacity:14,price_cents:500,cancel_hours:24});
 assert.equal(m.allow_guests,0);s.join(member.id,m.id);assert.throws(()=>s.join(member.id,m.id,'Guest'),{code:'guests_disabled'});
 for(const u of [member,dev])assert.throws(()=>s.setGuestPermission(u.id,m.id,true),{code:'forbidden'});
 assert.throws(()=>s.setGuestPermission(admin.id,m.id,'false'),{code:'invalid_input'});
 s.setGuestPermission(admin.id,m.id,true);s.join(member.id,m.id,'Guest');const before=s.all('SELECT * FROM registrations');const ledger=s.all('SELECT * FROM ledger');
 s.setGuestPermission(admin.id,m.id,false);assert.deepEqual(s.all('SELECT * FROM registrations'),before);assert.deepEqual(s.all('SELECT * FROM ledger'),ledger);assert.throws(()=>s.join(member.id,m.id,'Another'),{code:'guests_disabled'});
 s.setGuestPermission(admin.id,m.id,true);s.join(member.id,m.id,'Another');assert.equal(s.occupancy(m.id),3);
});
process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
test('real API restricts the guest switch and rejects stale guest submissions',async()=>{
 const call=(path,method='GET',body,cookie='')=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});
 const cookie=async role=>(await call('/auth/development','POST',{role})).headers['set-cookie'].split(';')[0];
 const admin=await cookie('admin'),member=await cookie('member'),mid=store.get("SELECT id FROM matches WHERE status='open' ORDER BY starts_at DESC").id;
 assert.equal((await call(`/admin/matches/${mid}/guests`,'PATCH',{allow_guests:false},member)).status,403);
 assert.equal((await call(`/admin/matches/${mid}/guests`,'PATCH',{allow_guests:false},admin)).status,200);
 assert.equal((await call(`/matches/${mid}/join`,'POST',{accept_policy:true,guest_name:'Blocked guest'},member)).json().error,'guests_disabled');
 assert.equal((await call(`/admin/matches/${mid}/guests`,'PATCH',{allow_guests:true},admin)).status,200);
 assert.equal((await call(`/matches/${mid}/join`,'POST',{accept_policy:true,guest_name:'Allowed guest'},member)).status,200);
});
test.after(()=>store.db.close());
