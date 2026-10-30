import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, id } from '../server/store.js';

function fixture(){let clock=new Date('2026-10-01T10:00:00Z');const s=new Store(':memory:',()=>clock);const users=['Alex','Sam','Jamie','Robin'].map((name,i)=>s.addUser({email:`${name.toLowerCase()}@example.test`,name,language:i===1?'de':'en'},i===0?'admin':'member'));
 const create=(overrides={})=>s.createMatch(users[0].id,{title:'Saturday football',starts_at:'2026-10-03T10:00:00Z',ends_at:'2026-10-03T11:30:00Z',timezone:'Europe/Vienna',venue:'USI',address:'',capacity:2,price_cents:500,allow_guests:true,cancel_hours:24,...overrides});
 return {s,users,create,clock:value=>{clock=new Date(value);}};
}
test('capacity, duplicate protection, offer acceptance and expiry preserve the cap',()=>{
 const {s,users:u,create,clock}=fixture(),m=create();s.join(u[0].id,m.id);const second=s.join(u[1].id,m.id);const third=s.join(u[2].id,m.id);const fourth=s.join(u[3].id,m.id);
 assert.equal(third.status,'waitlist');assert.throws(()=>s.join(u[0].id,m.id),{code:'already_registered'});
 s.cancelRegistration(u[1].id,second.id);assert.equal(s.get('SELECT status FROM registrations WHERE id=?',third.id).status,'offered');assert.equal(s.occupancy(m.id),2);
 clock('2026-10-01T12:00:01Z');s.promote(m.id);assert.equal(s.get('SELECT status FROM registrations WHERE id=?',third.id).status,'expired');assert.equal(s.get('SELECT status FROM registrations WHERE id=?',fourth.id).status,'offered');
 assert.throws(()=>s.accept(u[2].id,third.id),{code:'offer_expired'});s.accept(u[3].id,fourth.id);assert.equal(s.occupancy(m.id),2);s.db.close();
});
test('exactly 24 hours is free; less than 24 hours requires explicit fee acknowledgement',()=>{
 const {s,users:u,create,clock}=fixture(),m=create();const first=s.join(u[0].id,m.id),second=s.join(u[1].id,m.id);
 clock('2026-10-02T10:00:00Z');assert.equal(s.cancelRegistration(u[0].id,first.id).fee,0);
 clock('2026-10-02T10:00:00.001Z');assert.throws(()=>s.cancelRegistration(u[1].id,second.id),{code:'fee_confirmation_required'});assert.equal(s.cancelRegistration(u[1].id,second.id,true).fee,500);s.db.close();
});
test('closing charges guests to their sponsor, charges late cancellations and does not duplicate',()=>{
 const {s,users:u,create,clock}=fixture(),m=create({capacity:4});const own=s.join(u[0].id,m.id),guest=s.join(u[0].id,m.id,'Guest Taylor'),late=s.join(u[1].id,m.id),excused=s.join(u[2].id,m.id);
 clock('2026-10-03T09:00:00Z');s.cancelRegistration(u[1].id,late.id,true);clock('2026-10-03T12:00:00Z');
 assert.throws(()=>s.closeMatch(u[0].id,m.id,{[own.id]:'played'}),{code:'attendance_required'});assert.equal(s.all('SELECT * FROM ledger').length,0,'transaction rolls back incomplete attendance');
 s.closeMatch(u[0].id,m.id,{[own.id]:'played',[guest.id]:'played',[excused.id]:'excused'});assert.equal(s.balance(u[0].id),1000);assert.equal(s.balance(u[1].id),500);assert.equal(s.balance(u[2].id),0);
 assert.equal(s.closeMatch(u[0].id,m.id,{}).alreadyClosed,true);assert.equal(s.all('SELECT * FROM ledger').length,3);s.db.close();
});
test('no-show charges and partial payments retain historical match prices',()=>{
 const {s,users:u,create,clock}=fixture(),m=create();const r=s.join(u[0].id,m.id);s.run("UPDATE settings SET value='700' WHERE key='price_cents'");clock('2026-10-03T12:00:00Z');s.closeMatch(u[0].id,m.id,{[r.id]:'absent'});assert.equal(s.balance(u[0].id),500);
 const payment={user_id:u[0].id,amount_cents:200,method:'cash',request_key:'partial-one'};s.payment(u[0].id,payment);s.payment(u[0].id,payment);assert.equal(s.balance(u[0].id),300);
 const p=s.payment(u[0].id,{...payment,amount_cents:500,request_key:'overpay'});assert.equal(s.balance(u[0].id),-200);s.reverse(u[0].id,p.id,'Correction');assert.equal(s.balance(u[0].id),300);assert.throws(()=>s.reverse(u[0].id,p.id,'Again'),{code:'already_reversed'});s.db.close();
});
test('cancelled matches reverse charges once and retain received money as credit',()=>{
 const {s,users:u,create,clock}=fixture(),m=create(),r=s.join(u[0].id,m.id);clock('2026-10-03T12:00:00Z');s.closeMatch(u[0].id,m.id,{[r.id]:'played'});s.payment(u[0].id,{user_id:u[0].id,amount_cents:500,method:'cash',request_key:'paid'});s.cancelMatch(u[0].id,m.id);s.cancelMatch(u[0].id,m.id);assert.equal(s.balance(u[0].id),-500);assert.equal(s.all("SELECT * FROM ledger WHERE kind='reversal'").length,1);s.db.close();
});
test('monthly statements carry balances, respect local month boundaries and do not duplicate',()=>{
 const {s,users:u,clock}=fixture();clock('2026-11-02T12:00:00Z');
 const entry=(amount,when)=>s.run('INSERT INTO ledger (id,user_id,kind,amount_cents,description,occurred_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)',id(),u[0].id,'opening',amount,'Reviewed opening balance',when,s.now(),u[0].id);
 entry(1000,'2026-09-15T12:00:00Z');entry(500,'2026-09-30T22:30:00Z'); // October 1 in Vienna.
 s.payment(u[0].id,{user_id:u[0].id,amount_cents:300,method:'cash',request_key:'oct-payment',occurred_at:'2026-10-15T12:00:00Z'});
 const preview=s.statementPreview('2026-10')[0];assert.equal(preview.opening,1000);assert.equal(preview.closing,1200);assert.equal(preview.entries.length,2);
 s.generateStatements(u[0].id,'2026-10');s.generateStatements(u[0].id,'2026-10');assert.equal(s.all('SELECT * FROM statements').length,1);assert.equal(s.all('SELECT * FROM outbox').length,1);
 assert.throws(()=>s.statementPreview('2026-11'),{code:'month_not_finished'});s.db.close();
});
test('unfinished matches block statements and a member cannot cancel another player',()=>{
 const {s,users:u,create,clock}=fixture(),m=create(),r=s.join(u[1].id,m.id);assert.throws(()=>s.cancelRegistration(u[0].id,r.id),{code:'not_found'});clock('2026-11-02T12:00:00Z');assert.throws(()=>s.generateStatements(u[0].id,'2026-10'),{code:'unclosed_matches'});assert.equal(s.all('SELECT * FROM outbox').length,0);s.db.close();
});
test('guest payments retain the guest participation and cannot be attached to another account',()=>{
 const {s,users:u,create}=fixture(),m=create(),guest=s.join(u[0].id,m.id,'Taylor');
 const payment=s.payment(u[0].id,{user_id:u[0].id,registration_id:guest.id,amount_cents:500,method:'cash',payer_name:'Taylor',request_key:'guest-payment'});
 assert.equal(payment.registration_id,guest.id);assert.equal(payment.match_id,m.id);assert.equal(payment.payer_name,'Taylor');assert.equal(s.balance(u[0].id),-500);
 assert.throws(()=>s.payment(u[0].id,{user_id:u[1].id,registration_id:guest.id,amount_cents:500,method:'cash',request_key:'wrong-account'}),{code:'invalid_input'});s.db.close();
});
