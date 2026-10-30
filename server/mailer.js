import { setTimeout as delay } from 'node:timers/promises';
import { mailBudgetRules } from './security.js';

// One worker, persisted attempts and budget, bounded retries and provider idempotency.
export function createMailer(store,{enabled,config,limiter,telemetry,origin,apiKey,from,fetchImpl=fetch,sleep=delay}){
 let running=null,stopping=false;
 const cancel=(mail,reason)=>{store.run("UPDATE outbox SET status='cancelled',body='',error=? WHERE id=?",reason,mail.id);telemetry?.record('mail.cancelled',{scope:'mail',code:reason});};
 async function work(){
  const now=store.now();
  for(const queued of store.all("SELECT id FROM outbox WHERE status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY CASE kind WHEN 'login' THEN 0 ELSE 1 END,created_at LIMIT 10",now)){
   if(stopping)break;
   const mail=store.get("SELECT * FROM outbox WHERE id=? AND status='queued'",queued.id);if(!mail)continue;
   if(mail.kind==='login'&&new Date(mail.created_at).getTime()+600000<=store.clock().getTime()){cancel(mail,'expired');continue;}
   if(mail.user_id){
    const account=store.get('SELECT * FROM users WHERE id=?',mail.user_id);
    if(!account||account.deleted_at||account.email!==mail.recipient){cancel(mail,'recipient_unavailable');continue;}
    if(mail.kind==='membership'&&(account.role!=='admin'||account.membership_status!=='approved')){cancel(mail,'recipient_unavailable');continue;}
   }
   if(mail.attempts>=3){store.run("UPDATE outbox SET status='failed',error='retry_limit' WHERE id=?",mail.id);telemetry?.record('mail.failed',{scope:'mail',level:'error',code:'retry_limit'});continue;}
   try{limiter.consume(mailBudgetRules(config));}catch(e){if(e.code!=='rate_limited')throw e;store.run("UPDATE outbox SET error='mail_budget_exhausted' WHERE id=?",mail.id);if(mail.error!=='mail_budget_exhausted')telemetry?.record('mail.budget_exhausted',{scope:'mail',level:'warning',code:'mail_budget_exhausted'});break;}
   const attempt=mail.attempts+1;
   store.run('UPDATE outbox SET attempts=?,next_attempt_at=? WHERE id=?',attempt,new Date(store.clock().getTime()+60000).toISOString(),mail.id);
   let status=0,retryAfter=0;
   try{
    const path=mail.kind==='statement'?'/account':mail.kind==='membership'?'/members':'/';
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':mail.id},body:JSON.stringify({from,to:[mail.recipient],subject:mail.subject,text:mail.body+'\n\n'+origin+path}),signal:AbortSignal.timeout(15000)});
    status=response.status;retryAfter=Math.min(900,Math.max(0,Number(response.headers?.get('retry-after'))||0));
    if(!response.ok)throw Error('provider_error');
    store.run("UPDATE outbox SET status='sent',sent_at=?,error=NULL,next_attempt_at=NULL,body=CASE WHEN kind='login' THEN '' ELSE body END WHERE id=?",store.now(),mail.id);telemetry?.record('mail.sent',{scope:'mail',status});
   }catch{
    const retry=(status===0||status===429||status>=500)&&attempt<3;
    store.run("UPDATE outbox SET status=?,error=?,next_attempt_at=?,body=CASE WHEN kind='login' AND ?='failed' THEN '' ELSE body END WHERE id=?",retry?'queued':'failed',status?'email_provider_'+status:'email_network_error',retry?new Date(store.clock().getTime()+Math.max(retryAfter*1000,60000*5**(attempt-1))).toISOString():null,retry?'queued':'failed',mail.id);
    telemetry?.record(retry?'mail.retry':'mail.failed',{scope:'mail',level:retry?'warning':'error',code:status?'email_provider_'+status:'email_network_error',status});
   }
   if(!stopping)await sleep(1000);
  }
 }
 return {
  drain(){if(!enabled||stopping)return Promise.resolve();if(!running)running=work().catch(()=>{telemetry?.record('system.task_failed',{scope:'mail',level:'error',code:'internal_error'});console.error('Mail worker failed');}).finally(()=>{running=null;});return running;},
  async stop(){stopping=true;if(running)await running;}
 };
}
