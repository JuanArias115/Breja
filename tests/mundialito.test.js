import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {teams, editions, scorerRanking} from '../public/mundialito/data.js';
process.env.APP_ORIGIN='http://breja.test';
process.env.DATABASE_PATH=':memory:';
process.env.NODE_ENV='development';
const {server,store}=await import('../server/index.js');
server.listen(0,'127.0.0.1');
await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const get=(path,method='GET')=>new Promise((resolve,reject)=>{const req=http.request(base+path,{method,headers:{host:'breja.test'}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve({status:res.statusCode,headers:{get:key=>res.headers[key]},text:async()=>body,json:async()=>JSON.parse(body)}));});req.on('error',reject);req.end();});
after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close();});

test('public tournament routes and assets work without a session under the existing CSP',async()=>{
 for(const path of ['/mundialito','/mundialito/','/mundialito?edition=2027&section=teams']){
  const response=await get(path);assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/html/);
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  const html=await response.text();assert.match(html,/MUNDIALITO/);
  assert.match(html,/type="module" src="\/mundialito\/app.js"/);
  const optionYears=[...html.matchAll(/<option value="(\d{4})"/g)].map(match=>match[1]);assert.deepEqual(optionYears,['2026','2025','2024','2022']);
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/Propuesta visual|analysis\.html|data:image/);
 }
 for(const path of ['/mundialito/app.js','/mundialito/data.js','/mundialito/styles.css'])assert.equal((await get(path)).status,200);
 assert.equal((await get('/mundialito/missing')).status,404);
 assert.equal((await get('/mundialito','HEAD')).status,200);
 assert.equal((await get('/mundialito','POST')).status,404);
 assert.match(await (await get('/members')).text(),/app\.js/);
 const bootstrap=await (await get('/api/bootstrap')).json();assert.equal(bootstrap.me,null);assert.equal(bootstrap.matches,undefined);
});

test('historical results retain corrections, ties, absent records and shared goalkeepers',()=>{
 assert.deepEqual(teams.map(t=>t.name),['Schnitzelona','Galataspeckaray','Kasspress Rangers','Wurst Ham United']);
 assert.equal(teams.reduce((sum,t)=>sum+t.players.length,0),30);
 const ranking=scorerRanking();assert.equal(ranking[0].name,'Nuno');assert.equal(ranking[0].goals,7);
 assert.equal(ranking.find(p=>p.name==='Wisdom').goals,3);
 assert.equal(ranking.find(p=>p.name==='Wisdom').rank,ranking.find(p=>p.name==='Luís').rank);
 assert.equal(ranking.find(p=>p.name==='Eduardo'),undefined);
 assert.match(editions[2024].note,/André y Lucca/);
 assert.equal(editions[2023],undefined);
});
