import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes } from 'node:crypto';

export class AppError extends Error {
  constructor(code, status = 400, details = {}) { super(code); this.code = code; this.status = status; this.details = details; }
}
export const fail = (condition, code, status = 400, details) => { if (!condition) throw new AppError(code, status, details); };
export const id = () => randomUUID();
export const nowISO = () => new Date().toISOString();
export function text(value, max = 160, required = true) {
  fail(typeof value === 'string' && value.trim().length <= max && (!required || value.trim().length > 0), 'invalid_input');
  return value.trim();
}
export function cents(value) { const n = Number(value); fail(Number.isSafeInteger(n) && n >= 0 && n <= 1000000, 'invalid_amount'); return n; }
export function mapURL(value='') {
  const raw=text(value,2000,false);if(!raw)return '';
  let url;try{url=new URL(raw);}catch{throw new AppError('invalid_map_url');}
  fail(url.protocol==='https:'&&!url.username&&!url.password,'invalid_map_url');return url.href;
}

export class Store {
  constructor(path = ':memory:', clock = () => new Date()) {
    this.db = new DatabaseSync(path); this.clock = clock;
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', map_url TEXT NOT NULL DEFAULT '',
        timezone TEXT NOT NULL, season TEXT NOT NULL DEFAULT 'all', archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT NOT NULL, display_name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'en', role TEXT NOT NULL DEFAULT 'member', phone TEXT NOT NULL DEFAULT '',
        birthday TEXT NOT NULL DEFAULT '', position TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS login_codes (email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, profile TEXT NOT NULL, requested_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, share_token TEXT UNIQUE NOT NULL, title TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        timezone TEXT NOT NULL, venue TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', capacity INTEGER NOT NULL CHECK(capacity>0),
        price_cents INTEGER NOT NULL CHECK(price_cents>=0), cancel_hours INTEGER NOT NULL DEFAULT 24,
        status TEXT NOT NULL DEFAULT 'open', created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS registrations (
        id TEXT PRIMARY KEY, match_id TEXT NOT NULL REFERENCES matches(id), user_id TEXT REFERENCES users(id),
        responsible_id TEXT NOT NULL REFERENCES users(id), guest_name TEXT, status TEXT NOT NULL,
        attendance TEXT, joined_at TEXT NOT NULL, cancelled_at TEXT, offer_until TEXT,
        UNIQUE(match_id,user_id));
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), match_id TEXT REFERENCES matches(id),
        registration_id TEXT REFERENCES registrations(id), kind TEXT NOT NULL,
        amount_cents INTEGER NOT NULL, description TEXT NOT NULL, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id), method TEXT, payer_name TEXT, request_key TEXT UNIQUE,
        reverses_id TEXT UNIQUE REFERENCES ledger(id));
      CREATE UNIQUE INDEX IF NOT EXISTS unique_registration_charge ON ledger(registration_id) WHERE kind='charge';
      CREATE TABLE IF NOT EXISTS payment_reports (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        method TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS statements (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), month TEXT NOT NULL, snapshot TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(user_id,month));
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), recipient TEXT NOT NULL, subject TEXT NOT NULL,
        body TEXT NOT NULL, kind TEXT NOT NULL, dedupe_key TEXT UNIQUE NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
        error TEXT, created_at TEXT NOT NULL, sent_at TEXT);
      CREATE TABLE IF NOT EXISTS news (
        id TEXT PRIMARY KEY, title_en TEXT NOT NULL, title_de TEXT NOT NULL, body_en TEXT NOT NULL, body_de TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS registrations_match ON registrations(match_id,status);
      CREATE INDEX IF NOT EXISTS ledger_user_date ON ledger(user_id,occurred_at);
    `);
    for (const [key,value] of Object.entries({price_cents:500,capacity:14,cancel_hours:24,timezone:'Europe/Vienna',venue:'USI',address:'',payment_instructions_es:'Contacta con el organizador para consultar cómo pagar.',payment_instructions_en:'Please contact the organiser for payment details.',payment_instructions_de:'Bitte kontaktiere den Organisator für die Zahlungsdetails.'})) {
      this.run('INSERT OR IGNORE INTO settings VALUES (?,?)',key,JSON.stringify(value));
    }
    // Retire the imported Excel directory; registered accounts and their history stay intact.
    this.db.exec('DROP TABLE IF EXISTS roster');
    this.db.exec("CREATE TABLE IF NOT EXISTS profile_photos (user_id TEXT PRIMARY KEY REFERENCES users(id), image_data TEXT NOT NULL, version TEXT NOT NULL)");
    if(!this.all('PRAGMA table_info(users)').some(c=>c.name==='firebase_uid'))this.db.exec('ALTER TABLE users ADD COLUMN firebase_uid TEXT');
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid ON users(firebase_uid) WHERE firebase_uid IS NOT NULL');
    const newsColumns=this.all('PRAGMA table_info(news)').map(c=>c.name);
    for(const column of ['title_es','body_es','image_data'])if(!newsColumns.includes(column))this.db.exec(`ALTER TABLE news ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    // Additive migration: existing match locations remain historical snapshots.
    const columns=this.all('PRAGMA table_info(matches)').map(c=>c.name);
    if(!columns.includes('venue_id'))this.db.exec('ALTER TABLE matches ADD COLUMN venue_id TEXT REFERENCES venues(id)');
    if(!columns.includes('map_url'))this.db.exec("ALTER TABLE matches ADD COLUMN map_url TEXT NOT NULL DEFAULT ''");
    this.run("INSERT OR IGNORE INTO settings VALUES ('default_venue_id','\"\"')");
    if(!this.get("SELECT key FROM settings WHERE key='venues_migrated'"))this.transaction(()=>{
      const settings=this.settings();
      if(settings.venue){const vid=id();this.run('INSERT INTO venues (id,name,address,timezone,created_at) VALUES (?,?,?,?,?)',vid,settings.venue,settings.address||'',settings.timezone,this.now());this.run("UPDATE settings SET value=? WHERE key='default_venue_id'",JSON.stringify(vid));}
      this.run("INSERT INTO settings VALUES ('venues_migrated','true')");
    });
  }
  get(sql,...args) { return this.db.prepare(sql).get(...args); }
  all(sql,...args) { return this.db.prepare(sql).all(...args); }
  run(sql,...args) { return this.db.prepare(sql).run(...args); }
  now() { return this.clock().toISOString(); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn(); this.db.exec('COMMIT'); return result; } catch(e) { this.db.exec('ROLLBACK'); throw e; } }
  audit(actor,action,entity,detail={}) { this.run('INSERT INTO audit VALUES (?,?,?,?,?,?)',id(),actor,action,entity,JSON.stringify(detail),this.now()); }
  settings() { return Object.fromEntries(this.all('SELECT * FROM settings').map(r=>[r.key,JSON.parse(r.value)])); }
  addUser(profile,role='member') {
    fail(['member','admin','dev'].includes(role),'invalid_role');
    const email=text(profile.email,254).toLowerCase();fail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'invalid_email');fail(!this.get('SELECT id FROM users WHERE email=?',email),'email_exists',409);
    const uid=id();
    this.run('INSERT INTO users (id,email,name,display_name,language,role,created_at) VALUES (?,?,?,?,?,?,?)',uid,email,text(profile.name,100),text(profile.display_name||profile.name,60),['en','de','es'].includes(profile.language)?profile.language:'en',role,this.now());
    return this.get('SELECT * FROM users WHERE id=?',uid);
  }
  publicUser(user) {const {firebase_uid,...profile}=user;return {...profile,google_linked:!!firebase_uid};}
  setRole(actor,uid,role) {
    fail(['member','admin','dev'].includes(role),'invalid_role');
    return this.transaction(()=>{
      const user=this.get('SELECT * FROM users WHERE id=?',uid);fail(user,'not_found',404);
      if(user.role==='admin'&&role!=='admin')fail(this.get("SELECT COUNT(*) n FROM users WHERE role='admin'").n>1,'last_admin',409);
      this.run('UPDATE users SET role=? WHERE id=?',role,uid);
      this.audit(actor,'member.role',uid,{from:user.role,to:role});
      return this.publicUser(this.get('SELECT * FROM users WHERE id=?',uid));
    });
  }
  leaderboard() {
    const rows=this.all(`SELECT u.id,u.display_name,COUNT(*) appearances FROM registrations r JOIN matches m ON m.id=r.match_id JOIN users u ON u.id=r.user_id WHERE m.status='closed' AND r.attendance='played' AND r.guest_name IS NULL AND r.status='confirmed' GROUP BY u.id ORDER BY appearances DESC,u.display_name COLLATE NOCASE,u.id LIMIT 5`);
    let previous=-1,rank=0;return rows.map((row,index)=>{if(row.appearances!==previous)rank=index+1;previous=row.appearances;return {...row,rank};});
  }
  match(mid) { const m=this.get('SELECT * FROM matches WHERE id=?',mid); fail(m,'not_found',404); return m; }
  saveVenue(actor,input,vid=null) {
    const current=vid?this.get('SELECT * FROM venues WHERE id=?',vid):null;fail(!vid||current,'not_found',404);
    const name=text(input.name,120),address=text(input.address||'',300,false),url=mapURL(input.map_url||'');
    fail(address||url,'venue_location_required');fail(['all','summer','winter'].includes(input.season),'invalid_input');
    const timezone=this.settings().timezone;
    const venueId=vid||id();
    if(current)this.run('UPDATE venues SET name=?,address=?,map_url=?,timezone=?,season=? WHERE id=?',name,address,url,timezone,input.season,venueId);
    else this.run('INSERT INTO venues (id,name,address,map_url,timezone,season,created_at) VALUES (?,?,?,?,?,?,?)',venueId,name,address,url,timezone,input.season,this.now());
    this.audit(actor,current?'venue.update':'venue.create',venueId);return this.get('SELECT * FROM venues WHERE id=?',venueId);
  }
  archiveVenue(actor,vid,archived) {
    fail(this.get('SELECT id FROM venues WHERE id=?',vid),'not_found',404);fail(typeof archived==='boolean','invalid_input');
    this.transaction(()=>{this.run('UPDATE venues SET archived=? WHERE id=?',archived?1:0,vid);if(archived&&this.settings().default_venue_id===vid)this.run("UPDATE settings SET value='\"\"' WHERE key='default_venue_id'");this.audit(actor,archived?'venue.archive':'venue.restore',vid);});
  }
  createMatch(actor,input) {
    input={...input,timezone:this.settings().timezone};
    if(input.venue_id){const venue=this.get('SELECT * FROM venues WHERE id=? AND archived=0',text(input.venue_id,100));fail(venue,'venue_unavailable');input={...input,venue:venue.name,address:venue.address,map_url:venue.map_url};}
    const start=new Date(input.starts_at),end=new Date(input.ends_at); const capacity=Number(input.capacity),hours=Number(input.cancel_hours);
    fail(Number.isFinite(start.getTime()) && Number.isFinite(end.getTime()) && end>start && start>this.clock(),'invalid_date');
    fail(Number.isInteger(capacity)&&capacity>=2&&capacity<=100 && Number.isInteger(hours)&&hours>=0&&hours<=168,'invalid_input');
    try { new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format(start); } catch { throw new AppError('invalid_timezone'); }
    const mid=id();this.run(`INSERT INTO matches (id,share_token,title,starts_at,ends_at,timezone,venue,address,capacity,price_cents,cancel_hours,status,created_by,created_at,venue_id,map_url) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,mid,randomBytes(18).toString('base64url'),text(input.title,100),start.toISOString(),end.toISOString(),input.timezone,text(input.venue,120),text(input.address||'',300,false),capacity,cents(input.price_cents),hours,input.status==='draft'?'draft':'open',actor,this.now(),input.venue_id||null,mapURL(input.map_url||''));
    this.audit(actor,'match.create',mid);return this.match(mid);
  }
  occupancy(mid) { return this.get("SELECT COUNT(*) n FROM registrations WHERE match_id=? AND status IN ('confirmed','offered')",mid).n; }
  promote(mid) {
    const m=this.match(mid); if(m.status!=='open'||m.starts_at<=this.now())return;
    this.run("UPDATE registrations SET status='expired',offer_until=NULL WHERE match_id=? AND status='offered' AND offer_until<=?",mid,this.now());
    while(this.occupancy(mid)<m.capacity) {
      const r=this.get("SELECT * FROM registrations WHERE match_id=? AND status='waitlist' ORDER BY joined_at,rowid LIMIT 1",mid);if(!r)break;
      const until=new Date(Math.min(this.clock().getTime()+2*3600000,new Date(m.starts_at).getTime())).toISOString();
      this.run("UPDATE registrations SET status='offered',offer_until=? WHERE id=?",until,r.id);
      const u=this.get('SELECT * FROM users WHERE id=?',r.responsible_id);
      this.enqueue(u,'offer',`offer:${r.id}:${until}`,u.language==='es'?'¡Hay una plaza disponible!':u.language==='de'?'Ein Platz ist frei!':'A spot is yours!',u.language==='es'?`Hay una plaza para ${m.title}. Acéptala en la app antes del ${new Date(until).toLocaleString('es-ES',{timeZone:m.timezone})}.`:u.language==='de'?`Ein Platz für ${m.title} ist frei. Bestätige ihn bis ${until} in der App.`:`A spot for ${m.title} is available. Accept it in the app before ${until}.`);
    }
  }
  join(actor,mid,guestName=null) {
    return this.transaction(()=>{
      const m=this.match(mid);fail(m.status==='open'&&m.starts_at>this.now(),'registration_closed');this.promote(mid);
      const existing=guestName?null:this.get('SELECT * FROM registrations WHERE match_id=? AND user_id=?',mid,actor);
      fail(!existing||['cancelled','expired'].includes(existing.status),'already_registered',409);
      if(guestName){guestName=text(guestName,80);fail(!this.get("SELECT id FROM registrations WHERE match_id=? AND responsible_id=? AND lower(guest_name)=lower(?) AND status NOT IN ('cancelled','expired')",mid,actor,guestName),'already_registered',409);}
      const rid=existing?.id||id(),status=this.occupancy(mid)<m.capacity?'confirmed':'waitlist';
      if(existing)this.run('UPDATE registrations SET status=?,joined_at=?,cancelled_at=NULL,offer_until=NULL WHERE id=?',status,this.now(),rid);
      else this.run('INSERT INTO registrations (id,match_id,user_id,responsible_id,guest_name,status,joined_at) VALUES (?,?,?,?,?,?,?)',rid,mid,guestName?null:actor,actor,guestName,status,this.now());
      this.audit(actor,'registration.join',rid,{status});return this.get('SELECT * FROM registrations WHERE id=?',rid);
    });
  }
  accept(actor,rid) {
    return this.transaction(()=>{const r=this.get('SELECT * FROM registrations WHERE id=?',rid);fail(r&&r.responsible_id===actor,'not_found',404);const m=this.match(r.match_id);fail(m.status==='open'&&m.starts_at>this.now()&&r.status==='offered'&&r.offer_until>this.now(),'offer_expired');this.run("UPDATE registrations SET status='confirmed',offer_until=NULL WHERE id=?",rid);this.audit(actor,'registration.accept',rid);});
  }
  cancelRegistration(actor,rid,acceptFee=false) {
    return this.transaction(()=>{
      const r=this.get('SELECT * FROM registrations WHERE id=?',rid);fail(r&&r.responsible_id===actor,'not_found',404);const m=this.match(r.match_id);
      fail(m.status==='open'&&m.starts_at>this.now(),'registration_closed');fail(['confirmed','waitlist','offered'].includes(r.status),'invalid_state');
      const late=r.status==='confirmed'&&new Date(m.starts_at).getTime()-this.clock().getTime()<m.cancel_hours*3600000;
      fail(!late||acceptFee,'fee_confirmation_required',409,{fee:m.price_cents});
      this.run('UPDATE registrations SET status=?,cancelled_at=?,offer_until=NULL WHERE id=?',late?'late_cancelled':'cancelled',this.now(),rid);
      this.promote(m.id);this.audit(actor,'registration.cancel',rid,{late});return {late,fee:late?m.price_cents:0};
    });
  }
  closeMatch(actor,mid,attendance) {
    return this.transaction(()=>{
      const m=this.match(mid); if(m.status==='closed')return {alreadyClosed:true};
      fail(m.status==='open'&&m.ends_at<=this.now(),'cannot_close_match');
      const regs=this.all('SELECT * FROM registrations WHERE match_id=?',mid);
      for(const r of regs){
        let reason=null;
        if(r.status==='confirmed') { const value=attendance[r.id];fail(['played','absent','excused'].includes(value),'attendance_required');this.run('UPDATE registrations SET attendance=? WHERE id=?',value,r.id);if(value!=='excused')reason=value; }
        if(r.status==='late_cancelled')reason='late_cancelled';
        if(reason)this.run(`INSERT OR IGNORE INTO ledger (id,user_id,match_id,registration_id,kind,amount_cents,description,occurred_at,created_at,created_by) VALUES (?,?,?,?,'charge',?,?,?,?,?)`,id(),r.responsible_id,mid,r.id,m.price_cents,JSON.stringify({reason,guest:r.guest_name,title:m.title}),m.starts_at,this.now(),actor);
      }
      this.run("UPDATE registrations SET status='expired',offer_until=NULL WHERE match_id=? AND status IN ('waitlist','offered')",mid);
      this.run("UPDATE matches SET status='closed' WHERE id=?",mid);this.audit(actor,'match.close',mid,attendance);return {alreadyClosed:false};
    });
  }
  cancelMatch(actor,mid) {
    return this.transaction(()=>{const m=this.match(mid);if(m.status==='cancelled')return;
      for(const l of this.all("SELECT * FROM ledger WHERE match_id=? AND kind='charge'",mid))if(!this.get('SELECT id FROM ledger WHERE reverses_id=?',l.id))this.reverse(actor,l.id,'Match cancelled');
      this.run("UPDATE matches SET status='cancelled' WHERE id=?",mid);this.run("UPDATE registrations SET status='cancelled',offer_until=NULL WHERE match_id=?",mid);this.audit(actor,'match.cancel',mid);
    });
  }
  payment(actor,input) {
    const amount=cents(input.amount_cents);fail(amount>0,'invalid_amount');fail(this.get('SELECT id FROM users WHERE id=?',input.user_id),'not_found',404);
    fail(['cash','transfer','other'].includes(input.method),'invalid_input');const received=new Date(input.occurred_at||this.now());fail(Number.isFinite(received.getTime())&&received<=this.clock(),'invalid_date');
    let matchId=null;
    if(input.registration_id){const r=this.get('SELECT * FROM registrations WHERE id=?',input.registration_id);fail(r&&r.responsible_id===input.user_id,'invalid_input');matchId=r.match_id;}
    const key=text(input.request_key,100);const existing=this.get('SELECT * FROM ledger WHERE request_key=?',key);if(existing)return existing;
    const lid=id();this.run(`INSERT INTO ledger (id,user_id,match_id,registration_id,kind,amount_cents,description,occurred_at,created_at,created_by,method,payer_name,request_key) VALUES (?,?,?,?,'payment',?,?,?,?,?,?,?,?)`,lid,input.user_id,matchId,input.registration_id||null,-amount,text(input.note||'Payment',300),received.toISOString(),this.now(),actor,input.method,text(input.payer_name||'',100,false),key);
    this.audit(actor,'payment.record',lid,{amount});return this.get('SELECT * FROM ledger WHERE id=?',lid);
  }
  reverse(actor,lid,reason) {
    const l=this.get('SELECT * FROM ledger WHERE id=?',lid);fail(l&&l.kind!=='reversal','invalid_input');fail(!this.get('SELECT id FROM ledger WHERE reverses_id=?',lid),'already_reversed',409);
    this.run(`INSERT INTO ledger (id,user_id,match_id,registration_id,kind,amount_cents,description,occurred_at,created_at,created_by,reverses_id) VALUES (?,?,?,?,'reversal',?,?,?,?,?,?)`,id(),l.user_id,l.match_id,l.registration_id,-l.amount_cents,text(reason,300),this.now(),this.now(),actor,l.id);this.audit(actor,'ledger.reverse',lid,{reason});
  }
  balance(uid,until=null) { return this.get('SELECT COALESCE(SUM(amount_cents),0) balance FROM ledger WHERE user_id=?'+(until?' AND occurred_at<?':''),... (until?[uid,until]:[uid])).balance; }
  enqueue(user,kind,key,subject,body) { if(!user?.email)return;this.run('INSERT OR IGNORE INTO outbox (id,user_id,recipient,subject,body,kind,dedupe_key,created_at) VALUES (?,?,?,?,?,?,?,?)',id(),user.id,user.email,subject,body,kind,key,this.now()); }
  statementPreview(month) {
    fail(/^20\d{2}-(0[1-9]|1[0-2])$/.test(month),'invalid_date');const tz=this.settings().timezone;
    // Match dates and payments are grouped by the club's local calendar month.
    const monthOf=date=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:tz,year:'numeric',month:'2-digit'}).formatToParts(new Date(date)).map(p=>[p.type,p.value]));return p.year+'-'+p.month;};
    const current=monthOf(this.now());fail(month<current,'month_not_finished');
    const unfinished=this.all("SELECT * FROM matches WHERE status='open'").filter(m=>monthOf(m.starts_at)===month);fail(!unfinished.length,'unclosed_matches',409,{count:unfinished.length});
    return this.all('SELECT * FROM users').map(u=>{
      const all=this.all('SELECT * FROM ledger WHERE user_id=? ORDER BY occurred_at,created_at',u.id);
      const opening=all.filter(l=>monthOf(l.occurred_at)<month).reduce((s,l)=>s+l.amount_cents,0),entries=all.filter(l=>monthOf(l.occurred_at)===month);
      return {user:this.publicUser(u),month,opening,entries,closing:opening+entries.reduce((s,l)=>s+l.amount_cents,0),current:this.balance(u.id)};
    }).filter(s=>s.entries.length||s.opening!==0);
  }
  generateStatements(actor,month) {
    const previews=this.statementPreview(month);
    return this.transaction(()=>{for(const s of previews){
      if(this.get('SELECT id FROM statements WHERE user_id=? AND month=?',s.user.id,month))continue;
      const sid=id();this.run('INSERT INTO statements VALUES (?,?,?,?,?)',sid,s.user.id,month,JSON.stringify(s),this.now());
      this.enqueue(s.user,'statement',`statement:${s.user.id}:${month}`,`Breja FC · ${month}`,this.statementText(s));
    }this.audit(actor,'statements.generate',month,{count:previews.length});return {count:previews.length};});
  }
  statementText(s) {
    const es=s.user.language==='es',de=s.user.language==='de',fmt=n=>new Intl.NumberFormat(es?'es-ES':de?'de-AT':'en-IE',{style:'currency',currency:'EUR'}).format(n/100);
    const labels=es?{played:'Jugó',absent:'No asistió',late_cancelled:'Cancelación tardía',guest:'Invitado'}:de?{played:'Gespielt',absent:'Nicht erschienen',late_cancelled:'Späte Absage',guest:'Gast'}:{played:'Played',absent:'No-show',late_cancelled:'Late cancellation',guest:'Guest'};
    const lines=s.entries.map(e=>{let label=es?({payment:'Pago',opening:'Saldo inicial',reversal:'Anulación'}[e.kind]||e.description):e.description;if(e.kind==='charge'){const d=JSON.parse(e.description);label=`${d.title} · ${labels[d.reason]}${d.guest?' · '+labels.guest+': '+d.guest:''}`;}return `${new Date(e.occurred_at).toLocaleDateString(es?'es-ES':de?'de-AT':'en-GB',{timeZone:this.settings().timezone})} · ${label} · ${fmt(e.amount_cents)}`;});
    return `${es?'Hola':de?'Hallo':'Hi'} ${s.user.display_name},\n\nBreja FC · ${s.month}\n${es?'Saldo anterior':de?'Vorheriger Saldo':'Previous balance'}: ${fmt(s.opening)}\n${lines.join('\n')}\n${es?'Saldo al cierre del mes':de?'Saldo zum Monatsende':'Month-end balance'}: ${fmt(s.closing)}\n${es?'Saldo actual':de?'Aktueller Saldo':'Current balance'}: ${fmt(this.balance(s.user.id))}\n\n${this.settings()[es?'payment_instructions_es':de?'payment_instructions_de':'payment_instructions_en']}\n${es?'Consulta tu cuenta en la app para ver el saldo actualizado.':de?'Deinen aktuellen Kontostand findest du in der App.':'Check your account in the app for the latest balance.'}`;
  }
}
