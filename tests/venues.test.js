import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../server/store.js';

const input={name:'Test winter hall',address:'Test street 1',map_url:'https://maps.example.test/winter',season:'winter'};
const matchInput={title:'Venue test',starts_at:'2099-10-03T10:00:00Z',ends_at:'2099-10-03T11:00:00Z',capacity:14,price_cents:500,cancel_hours:24};
function setup(t){const store=new Store();t.after(()=>store.db.close());const admin=store.addUser({name:'Admin',email:'admin@example.test'},'admin');return {store,admin};}

test('match uses saved venue and preserves its location after editing or archiving',t=>{
 const {store:s,admin:a}=setup(t),v=s.saveVenue(a.id,input);
 const match=s.createMatch(a.id,{...matchInput,venue_id:v.id,venue:'Wrong',address:'Wrong',map_url:'https://wrong.example',timezone:'UTC'});
 assert.equal(match.venue,input.name);assert.equal(match.address,input.address);assert.equal(match.map_url,input.map_url);assert.equal(match.timezone,s.settings().timezone);
 s.saveVenue(a.id,{...input,address:'New address',map_url:'https://maps.example.test/new'},v.id);
 assert.equal(s.match(match.id).address,input.address);assert.equal(s.match(match.id).map_url,input.map_url);
 s.run("UPDATE settings SET value=? WHERE key='default_venue_id'",JSON.stringify(v.id));s.archiveVenue(a.id,v.id,true);
 assert.equal(s.settings().default_venue_id,'');assert.equal(s.match(match.id).venue,input.name);
 assert.throws(()=>s.createMatch(a.id,{...matchInput,venue_id:v.id}),{code:'venue_unavailable'});
 s.archiveVenue(a.id,v.id,false);assert.equal(s.createMatch(a.id,{...matchInput,venue_id:v.id}).address,'New address');
});

test('venue needs a usable location and rejects unsafe URLs and invalid fields',t=>{
 const {store:s,admin:a}=setup(t);
 for(const map_url of ['javascript:alert(1)','http://maps.example.test','https://user:password@maps.example.test','not a link'])assert.throws(()=>s.saveVenue(a.id,{...input,map_url}),{code:'invalid_map_url'});
 assert.throws(()=>s.saveVenue(a.id,{...input,address:' ',map_url:''}),{code:'venue_location_required'});
 assert.throws(()=>s.saveVenue(a.id,{...input,season:'random'}),{code:'invalid_input'});
 assert.equal(s.saveVenue(a.id,{...input,address:''}).address,'');
 assert.equal(s.saveVenue(a.id,{...input,map_url:''}).map_url,'');
 assert.throws(()=>s.createMatch(a.id,{...matchInput,venue:'One-off',timezone:'Europe/Vienna',map_url:'javascript:alert(1)'}),{code:'invalid_map_url'});
});

test('club timezone applies to new matches regardless of venue or per-match overrides',t=>{
 const {store:s,admin:a}=setup(t),v=s.saveVenue(a.id,input);
 const old=s.createMatch(a.id,{...matchInput,venue_id:v.id});assert.equal(old.timezone,'Europe/Vienna');
 s.run("UPDATE settings SET value=? WHERE key='timezone'",JSON.stringify('Europe/London'));
 const next=s.createMatch(a.id,{...matchInput,venue_id:v.id,timezone:'Europe/Vienna'});
 assert.equal(next.timezone,'Europe/London');assert.equal(s.match(old.id).timezone,'Europe/Vienna');
 assert.equal(s.createMatch(a.id,{...matchInput,venue:'Custom pitch',timezone:'UTC'}).timezone,'Europe/London');
 assert.equal(s.saveVenue(a.id,{...input,timezone:'fake/zone'},v.id).timezone,'Europe/London');
});

test('old database migrates once and preserves match addresses and existing defaults',t=>{
 const dir=mkdtempSync(join(tmpdir(),'breja-venues-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'legacy.sqlite');
 const legacy=new DatabaseSync(path);
 legacy.exec(`CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT INTO settings VALUES('venue','"Old pitch"'),('address','"Old street 2"'),('timezone','"Europe/Berlin"');
 CREATE TABLE matches(id TEXT PRIMARY KEY,share_token TEXT UNIQUE NOT NULL,title TEXT NOT NULL,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,timezone TEXT NOT NULL,venue TEXT NOT NULL,address TEXT NOT NULL DEFAULT '',capacity INTEGER NOT NULL,price_cents INTEGER NOT NULL,cancel_hours INTEGER NOT NULL,status TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 INSERT INTO matches VALUES('old','share','Old match','2026-01-03T10:00:00Z','2026-01-03T11:00:00Z','Europe/Berlin','Historical pitch','Historical address',14,500,24,'closed','old-admin','2026-01-01T10:00:00Z');`);legacy.close();
 let s=new Store(path);const id=s.settings().default_venue_id;assert.equal(s.all('SELECT * FROM venues').length,1);assert.equal(s.get('SELECT name FROM venues WHERE id=?',id).name,'Old pitch');assert.equal(s.match('old').address,'Historical address');assert.equal(s.match('old').map_url,'');s.db.close();
 s=new Store(path);try{assert.equal(s.all('SELECT * FROM venues').length,1);assert.equal(s.settings().default_venue_id,id);assert.equal(s.settings().timezone,'Europe/Berlin');}finally{s.db.close();}
});
