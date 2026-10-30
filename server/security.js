import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { AppError, fail } from './store.js';

const normalizeIP=value=>typeof value==='string'&&value.startsWith('::ffff:')&&isIP(value.slice(7))===4?value.slice(7):value;
export function clientAddress(req,trustedProxies=[]){
 const peer=normalizeIP(req.socket.remoteAddress||'unknown');
 // Only an explicitly trusted proxy may supply the address. Never trust X-Forwarded-For from a visitor.
 const forwarded=normalizeIP(req.headers['x-real-ip']);
 return trustedProxies.includes(peer)&&isIP(forwarded||'')?forwarded:peer;
}
export function securityConfig(env=process.env){
 const positive=(name,fallback)=>{const n=Number(env[name]||fallback);if(!Number.isSafeInteger(n)||n<1||n>100000)throw Error('Invalid '+name);return n;};
 const siteKey=env.TURNSTILE_SITE_KEY||'',secretKey=env.TURNSTILE_SECRET_KEY||'';
 if(env.NODE_ENV==='production'&&[siteKey,secretKey].some(key=>/^[123]x0{10}/.test(key)))throw Error('Turnstile test keys are not allowed in production');
 if(env.NODE_ENV==='production'&&!siteKey)throw Error('Production requires Turnstile keys');
 if(!!siteKey!==!!secretKey)throw Error('Configure both Turnstile keys');
 if(siteKey&&!/^[a-zA-Z0-9_-]{10,200}$/.test(siteKey))throw Error('Invalid TURNSTILE_SITE_KEY');
 const trustedProxies=(env.TRUSTED_PROXY_IPS||'').split(',').map(s=>normalizeIP(s.trim())).filter(Boolean);
 if(trustedProxies.some(ip=>!isIP(ip)))throw Error('TRUSTED_PROXY_IPS must contain exact IP addresses');
 return {siteKey,secretKey,trustedProxies,emailDaily:positive('EMAIL_DAILY_LIMIT',90),emailMonthly:positive('EMAIL_MONTHLY_LIMIT',2500)};
}
export class PersistentLimiter {
 constructor(store,secret){this.store=store;this.secret=secret;}
 key(value){return createHmac('sha256',this.secret).update(value).digest('hex');}
 consume(rules){
  const s=this.store,now=s.clock().getTime();
  return s.transaction(()=>{
   s.run('DELETE FROM security_counters WHERE expires_at<=?',now);
   const rows=rules.map(rule=>({...rule,key:this.key(rule.key)})).map(rule=>({...rule,row:s.get('SELECT * FROM security_counters WHERE key=?',rule.key)}));
   const blocked=rows.filter(r=>r.row&&r.row.hits>=r.max);
   if(blocked.length)throw new AppError('rate_limited',429,{retry_after:Math.max(...blocked.map(r=>Math.ceil((r.row.expires_at-now)/1000)))});
   fail(s.get('SELECT COUNT(*) n FROM security_counters').n+rows.filter(r=>!r.row).length<=20000,'rate_limited',429,{retry_after:60});
   for(const r of rows){if(r.row)s.run('UPDATE security_counters SET hits=hits+1 WHERE key=?',r.key);else s.run('INSERT INTO security_counters VALUES (?,?,?)',r.key,1,now+r.window);}
  });
 }
 usage(key){const r=this.store.get('SELECT hits FROM security_counters WHERE key=? AND expires_at>?',this.key(key),this.store.clock().getTime());return r?.hits||0;}
}
export async function verifyTurnstile(token,action,config,origin,fetchImpl=fetch){
 if(!config.siteKey)return;
 fail(typeof token==='string'&&token.length>0&&token.length<=2048,'human_verification_required',400);
 let result;
 try{
  const response=await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:config.secretKey,response:token}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('provider_unavailable');result=await response.json();
 }catch{throw new AppError('human_verification_unavailable',503);}
 fail(result?.success===true&&result.hostname===new URL(origin).hostname&&result.action===action,'human_verification_required',400);
}
export const mailBudgetRules=config=>[
 {key:'mail:daily',max:config.emailDaily,window:86400000},
 {key:'mail:monthly',max:config.emailMonthly,window:30*86400000}
];
