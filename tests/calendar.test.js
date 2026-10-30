import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, moveMonth, calendarDays, groupMatches } from '../public/calendar.js';
import { Store } from '../server/store.js';
import { populateDemoAccounts } from '../server/demo-accounts.js';

test('calendar is Monday-first and handles leap years and year changes',()=>{
 const days=calendarDays('2024-02');assert.equal(days.length,42);assert.equal(days[0],'2024-01-29');assert.ok(days.includes('2024-02-29'));assert.equal(new Set(days).size,42);
 assert.equal(moveMonth('2026-12',1),'2027-01');assert.equal(moveMonth('2026-01',-1),'2025-12');
 assert.equal(dayKey('2026-10-23T23:30:00Z','Europe/Madrid'),'2026-10-24');
 const grouped=groupMatches([{id:'late',starts_at:'2026-10-23T23:30:00Z'},{id:'early',starts_at:'2026-10-23T22:30:00Z'}],'Europe/Madrid');assert.deepEqual(grouped['2026-10-24'].map(m=>m.id),['early','late']);
});

test('demo accounts provide linked charges, guest debt and varied payments without duplicates',t=>{
 const s=new Store(':memory:',()=>new Date('2026-10-23T12:00:00Z'));t.after(()=>s.db.close());
 for(const name of ['alex','sam','leo','max','robin','chris'])s.addUser({email:name+'@example.test',name},name==='alex'?'admin':'member');
 const result=populateDemoAccounts(s);assert.equal(result.matches,6);assert.equal(result.charges,38);assert.equal(result.payments,22);
 assert.equal(s.get("SELECT COUNT(*) n FROM ledger WHERE kind='charge' AND match_id IS NOT NULL AND registration_id IS NOT NULL").n,38);
 const balance=name=>s.balance(s.get('SELECT id FROM users WHERE email=?',name+'@example.test').id);
 assert.equal(balance('leo'),0);assert.equal(balance('max'),1800);assert.equal(balance('robin'),-1200);assert.equal(balance('sam'),3500);
 assert.deepEqual(populateDemoAccounts(s),{created:false});assert.equal(s.all('SELECT * FROM matches').length,6);
});
