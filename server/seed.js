import { id } from './store.js';

export function seedDevelopment(s) {
  const existing=s.get("SELECT id FROM users WHERE email='alex@example.test'");
  if(existing){
    if(!s.settings().neutral_demo_copy)s.transaction(()=>{
      s.run('UPDATE matches SET title=? WHERE created_by=? AND title=?','Football match',existing.id,'Saturday football');
      s.run('UPDATE news SET title_en=?,title_de=?,title_es=?,body_es=? WHERE title_en=? AND body_en=?','Welcome to Breja FC','Willkommen bei Breja FC','Bienvenido a Breja FC','Partidos, jugadores y cuentas del club, en un solo lugar.','A new home for our Saturdays.','Matchdays, your mates and the club account. Everything in one place. Welcome to Breja FC.');
      s.run("INSERT OR REPLACE INTO settings VALUES ('neutral_demo_copy','true')");
    });
    return;
  }
  const admin=s.addUser({email:'alex@example.test',name:'Alex Morgan',display_name:'Alex',language:'en'},'admin');
  const users=[admin,...[['sam','Sam Rivera','de'],['jamie','Jamie Collins','en'],['chris','Chris Weber','de'],['robin','Robin Meyer','en'],['leo','Leo Costa','en'],['max','Max Keller','de'],['noah','Noah Silva','en'],['luca','Luca Moretti','en'],['ben','Ben Fischer','de']].map(([email,name,language])=>s.addUser({email:email+'@example.test',name,display_name:name.split(' ')[0],language}))];
  const next=new Date();next.setUTCHours(9,0,0,0);next.setUTCDate(next.getUTCDate()+1);
  const make=(date,title,capacity=14)=>s.createMatch(admin.id,{title,starts_at:date.toISOString(),ends_at:new Date(date.getTime()+90*60000).toISOString(),timezone:'Europe/Vienna',venue:'USI',address:'Venue address to be confirmed',capacity,price_cents:500,allow_guests:true,cancel_hours:24});
  const match=make(next,'Football match');for(const user of users.slice(1))s.join(user.id,match.id);
  s.join(users[1].id,match.id,'Taylor');
  const following=new Date(next.getTime()+7*86400000);make(following,'Football match');
  const oldStart=new Date(next.getTime()-7*86400000),oldId=id();
  s.run('INSERT INTO matches (id,share_token,title,starts_at,ends_at,timezone,venue,address,capacity,price_cents,cancel_hours,status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',oldId,id(),'Football match',oldStart.toISOString(),new Date(oldStart.getTime()+5400000).toISOString(),'Europe/Vienna','USI','',14,500,24,'open',admin.id,s.now());
  for(const user of users.slice(0,5))s.run('INSERT INTO registrations (id,match_id,user_id,responsible_id,status,joined_at) VALUES (?,?,?,?,?,?)',id(),oldId,user.id,user.id,'confirmed',new Date(oldStart.getTime()-86400000*3).toISOString());
  // Sample ledger is deliberately isolated to development.sqlite.
  const previous=new Date();previous.setUTCMonth(previous.getUTCMonth()-1,5);previous.setUTCHours(10,0,0,0);
  const charge=(uid,amount,description)=>s.run('INSERT INTO ledger (id,user_id,kind,amount_cents,description,occurred_at,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)',id(),uid,'opening',amount,description,previous.toISOString(),s.now(),admin.id);
  charge(admin.id,1500,'Sample opening balance');charge(users[1].id,2000,'Sample opening balance');charge(users[2].id,1000,'Sample opening balance');
  s.payment(admin.id,{user_id:users[1].id,amount_cents:500,method:'cash',note:'Sample payment',request_key:'seed-payment',occurred_at:previous.toISOString()});
  s.run('INSERT INTO news (id,title_en,title_de,body_en,body_de,pinned,created_at,title_es,body_es) VALUES (?,?,?,?,?,?,?,?,?)',id(),'Welcome to Breja FC','Willkommen bei Breja FC','Matchdays, your mates and the club account. Everything in one place. Welcome to Breja FC.','Spieltage, deine Mitspieler und das Vereinskonto. Alles an einem Ort. Willkommen bei Breja FC.',1,s.now(),'Bienvenido a Breja FC','Partidos, jugadores y cuentas del club, en un solo lugar.');
}
