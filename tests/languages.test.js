import test from 'node:test';import assert from 'node:assert/strict';import { Store } from '../server/store.js';import { newsInput } from '../server/news.js';import { statementHtml } from '../server/email-template.js';import { dispatch } from './dispatch.js';
globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.document={documentElement:{}};
const {messages,setLanguage,t,date,money}=await import('../public/i18n.js');
test('Portuguese and Arabic cover every key and preserve placeholders and reading direction',()=>{
 for(const [k,v] of Object.entries(messages))for(const i of [3,4]){assert.equal(typeof v[i],'string',k);assert.deepEqual((v[i].match(/\{\w+\}/g)||[]).sort(),(v[0].match(/\{\w+\}/g)||[]).sort(),k);}
 setLanguage('ar');assert.equal(document.documentElement.dir,'rtl');assert.equal(t('home'),'الرئيسية');assert.ok(date('2026-10-30'));assert.ok(money(500));setLanguage('pt');assert.equal(document.documentElement.dir,'ltr');assert.equal(t('home'),'Início');
});
test('new languages persist in accounts, applications, news and formatted statements; new club capacity is 18',()=>{
 const s=new Store(':memory:');try{assert.equal(s.settings().capacity,18);for(const language of ['pt','ar']){const u=s.addUser({name:'Test',email:language+'@example.test',language},'member','onboarding');assert.equal(u.language,language);s.submitApplication(u.id,{name:'Test',birthday:'1990-01-01',position:'goalkeeper',language});assert.equal(s.get('SELECT language FROM users WHERE id=?',u.id).language,language);assert.ok(newsInput({['title_'+language]:'Title',['body_'+language]:'Text'})['title_'+language]);const body=s.statementText({user:u,month:'2026-09',opening:0,closing:0,entries:[]});assert.match(body,language==='ar'?/رصيد نهاية الشهر/:/Saldo no fim do mês/);assert.match(statementHtml(body,'https://example.test'),language==='ar'?/dir="rtl"/:/O seu resumo mensal/);}}finally{s.db.close();}
});
process.env.APP_ORIGIN='http://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';const {api,store}=await import('../server/index.js');
test('API stores and returns Portuguese and Arabic news and profile preferences',async()=>{
 const call=(path,method='GET',body,cookie='')=>dispatch(api,'/api'+path,{method,body,headers:{cookie}});const login=await call('/auth/development','POST',{role:'admin'}),cookie=login.headers['set-cookie'].split(';')[0];
 for(const language of ['pt','ar']){assert.equal((await call('/admin/news','POST',{['title_'+language]:'Title '+language,['body_'+language]:'Body '+language},cookie)).status,201);const b=(await call('/bootstrap','GET',undefined,cookie)).json();assert.ok(b.news.some(n=>n['title_'+language]==='Title '+language));assert.equal((await call('/profile','PATCH',{...b.me,language},cookie)).status,200);assert.equal((await call('/bootstrap','GET',undefined,cookie)).json().me.language,language);}
});test.after(()=>store.db.close());
