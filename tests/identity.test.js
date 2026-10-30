import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/store.js';
import { linkGoogleUser, firebaseConfig, verifyGoogleToken } from '../server/firebase.js';
import { populateDemoAccounts } from '../server/demo-accounts.js';

function fixture(t){const s=new Store(':memory:',()=>new Date('2026-10-23T12:00:00Z'));t.after(()=>s.db.close());return s;}
const claims={uid:'google-verified-uid',email:'member@example.test',name:'Google Name',email_verified:true,firebase:{sign_in_provider:'google.com'}};

test('Google links a verified identity to the existing manual member without changing role or balance',t=>{
 const s=fixture(t),u=s.addUser({email:claims.email,name:'Manual name',language:'es'});
 s.payment(u.id,{user_id:u.id,amount_cents:500,method:'cash',request_key:'initial'});
 const linked=linkGoogleUser(s,claims,'en',claims.email);assert.equal(linked.id,u.id);assert.equal(linked.role,'member');assert.equal(linked.name,'Manual name');assert.equal(linked.language,'es');assert.equal(s.balance(linked.id),-500);
 assert.equal(linkGoogleUser(s,claims).id,u.id);assert.equal(s.all('SELECT id FROM users').length,1);
 assert.equal(s.publicUser(linked).firebase_uid,undefined);assert.equal(s.publicUser(linked).google_linked,true);
 assert.throws(()=>linkGoogleUser(s,{...claims,uid:'another-uid'}),{code:'google_account_conflict'});
 assert.throws(()=>linkGoogleUser(s,{...claims,email:'changed@example.test'}),{code:'google_account_conflict'});
});

test('Google rejects unverified identities and only grants admin to the configured verified email',t=>{
 const s=fixture(t);
 assert.throws(()=>linkGoogleUser(s,{...claims,email_verified:false}),{code:'google_auth_failed'});
 assert.throws(()=>linkGoogleUser(s,{...claims,firebase:{sign_in_provider:'password'}}),{code:'google_auth_failed'});
 assert.equal(s.all('SELECT id FROM users').length,0);
 const u=linkGoogleUser(s,claims,'es',claims.email);assert.equal(u.role,'admin');assert.equal(u.language,'es');
 assert.throws(()=>s.addUser({name:'Duplicate',email:'MEMBER@example.test'}),{code:'email_exists'});
});

test('Firebase configuration exposes only web fields and cannot accept an unverified token',async()=>{
 assert.equal(firebaseConfig({}),null);
 const c=firebaseConfig({FIREBASE_CONFIG:JSON.stringify({apiKey:'public',authDomain:'demo.firebaseapp.com',projectId:'demo',appId:'demo-app',private_key:'never exposed'})});
 assert.equal(c.private_key,undefined);assert.throws(()=>firebaseConfig({FIREBASE_CONFIG:'not json'}));
 await assert.rejects(verifyGoogleToken('invalid',null),{code:'google_not_configured'});
 await assert.rejects(verifyGoogleToken('not-a-valid-token',c),{code:'google_auth_failed'});
});

test('leaderboard counts actual personal appearances, excludes guests and no-shows, and shares tie ranks',t=>{
 const s=fixture(t);for(const name of ['alex','sam','leo','max','robin','chris'])s.addUser({name,email:name+'@example.test'},name==='alex'?'admin':'member');populateDemoAccounts(s);
 const rows=s.leaderboard();assert.equal(rows.length,5);assert.ok(rows.every(r=>r.appearances===6));assert.ok(rows.every(r=>r.rank===1));assert.equal(rows.find(r=>r.display_name==='sam').appearances,6);
 assert.ok(rows.every(r=>r.email===undefined));
 const match=s.get('SELECT id FROM matches LIMIT 1');s.cancelMatch(rows[0].id,match.id);assert.ok(s.leaderboard().every(r=>r.appearances===5));
});
