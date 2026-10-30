import { id } from './store.js';

// Explicitly invoked for the local demo. Never imported by the production server.
export function populateDemoAccounts(store,reference=store.clock()){
 if(store.settings().demo_accounts_v1)return {created:false};
 const admin=store.get("SELECT * FROM users WHERE email='alex@example.test'");
 if(!admin)throw new Error('Demo administrator not found');
 const users=['alex','sam','leo','max','robin','chris'].map(name=>store.get('SELECT * FROM users WHERE email=?',name+'@example.test'));
 if(users.some(u=>!u))throw new Error('Demo members not found');
 const venues=store.all('SELECT * FROM venues WHERE archived=0 ORDER BY created_at');
 const anchor=new Date(reference);anchor.setUTCHours(9,0,0,0);
 let registrations=0,payments=0;
 return store.transaction(()=>{
  for(const [index,daysAgo] of [35,28,21,14,7,2].entries()){
   const start=new Date(anchor.getTime()-daysAgo*86400000),end=new Date(start.getTime()+90*60000),mid=id(),venue=venues[index%Math.max(1,venues.length)];
   const title='Demo · Football match',created=new Date(start.getTime()-3*86400000).toISOString();
   store.run('INSERT INTO matches (id,share_token,title,starts_at,ends_at,timezone,venue,address,capacity,price_cents,cancel_hours,status,created_by,created_at,venue_id,map_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',mid,id(),title,start.toISOString(),end.toISOString(),store.settings().timezone,venue?.name||'Demo pitch',venue?.address||'',14,500,24,'closed',admin.id,created,venue?.id||null,venue?.map_url||'');
   for(const [userIndex,user] of users.entries()){
    const rid=id(),reason=userIndex===5&&index===5?'absent':'played';
    store.run('INSERT INTO registrations (id,match_id,user_id,responsible_id,status,attendance,joined_at) VALUES (?,?,?,?,?,?,?)',rid,mid,user.id,user.id,'confirmed',reason,created);
    store.run("INSERT INTO ledger (id,user_id,match_id,registration_id,kind,amount_cents,description,occurred_at,created_at,created_by) VALUES (?,?,?,?,'charge',?,?,?,?,?)",id(),user.id,mid,rid,500,JSON.stringify({title,reason,guest:null}),start.toISOString(),end.toISOString(),admin.id);registrations++;
    // Leo pays in full; Max pays part; Robin pays extra; Alex pays alternate matches.
    const amount=userIndex===2?500:userIndex===3?200:userIndex===4?700:userIndex===0&&index%2===0?500:0;
    if(amount){store.payment(admin.id,{user_id:user.id,registration_id:rid,amount_cents:amount,method:index%2?'transfer':'cash',note:'Demo payment',request_key:`demo-accounts-v1-${index}-${userIndex}`,occurred_at:end.toISOString()});payments++;}
   }
   if(index===1||index===4){
    const rid=id(),sponsor=users[1];store.run("INSERT INTO registrations (id,match_id,responsible_id,guest_name,status,attendance,joined_at) VALUES (?,?,?,?,'confirmed','played',?)",rid,mid,sponsor.id,'Demo guest',created);
    store.run("INSERT INTO ledger (id,user_id,match_id,registration_id,kind,amount_cents,description,occurred_at,created_at,created_by) VALUES (?,?,?,?,'charge',?,?,?,?,?)",id(),sponsor.id,mid,rid,500,JSON.stringify({title,reason:'played',guest:'Demo guest'}),start.toISOString(),end.toISOString(),admin.id);registrations++;
    if(index===1){store.payment(admin.id,{user_id:sponsor.id,registration_id:rid,amount_cents:500,method:'cash',payer_name:'Demo guest',note:'Demo guest payment',request_key:'demo-accounts-v1-guest',occurred_at:end.toISOString()});payments++;}
   }
  }
  store.run("INSERT INTO settings VALUES ('demo_accounts_v1','true')");store.audit(admin.id,'demo.accounts.populate',null,{matches:6,charges:registrations,payments});
  return {created:true,matches:6,charges:registrations,payments};
 });
}
