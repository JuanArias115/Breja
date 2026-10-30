// Real HTTP, production isolation, persistent SQLite and graceful Docker shutdown.
// Uses disposable test credentials and never requests or sends email.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { setTimeout } from 'node:timers/promises';

const image=process.argv[2]||'breja:ci';
const name=`breja-smoke-${randomUUID()}`,volume=`${name}-data`;
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8'}).trim();
const origin='https://breja.juanariasdev.com';
let endpoint;
// http.request preserves Host, as the production reverse proxy must do.
function request(path,options={}){
  return new Promise((resolve,reject)=>{
    const req=httpRequest(`${endpoint}${path}`,options,res=>{
      let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,json:()=>JSON.parse(body)}));
    });
    req.on('error',reject);
    req.setTimeout(2000,()=>req.destroy(new Error('HTTP timeout')));
    req.end(options.body);
  });
}
async function ready(){
  const mapping=docker('port',name,'4173/tcp');
  endpoint=`http://${mapping}`;
  for(let i=0;i<40;i++){
    try{
      const response=await request('/api/bootstrap',{headers:{Host:'breja.juanariasdev.com'}});
      if(response.status===200)return response.json();
    }catch{}
    await setTimeout(250);
  }
  throw new Error('Container did not become ready');
}
try{
  docker('volume','create',volume);
  docker('run','-d','--name',name,'-p','127.0.0.1::4173',
    '-v',`${volume}:/app/.data`,
    '-e',`APP_ORIGIN=${origin}`,'-e','ADMIN_EMAIL=admin@example.test',
    '-e',`SESSION_SECRET=${randomUUID()}`,'-e','RESEND_API_KEY=test-unused',
    '-e','MAIL_FROM=Breja <test@example.test>',image);
  const bootstrap=await ready();
  assert.equal(bootstrap.me,null);
  assert.equal(bootstrap.config.development,false);
  assert.equal(bootstrap.developmentCode,undefined);
  assert.equal((await request('/api/bootstrap',{headers:{Host:'untrusted.example'}})).status,403);
  const demo=await request('/api/auth/development',{
    method:'POST',headers:{Host:'breja.juanariasdev.com',Origin:origin,'Content-Type':'application/json'},
    body:JSON.stringify({role:'admin'})
  });
  assert.equal(demo.status,404);
  docker('exec',name,'node','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync('/app/.data/breja.sqlite');
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n,0);
    db.exec("CREATE TABLE deployment_probe(value TEXT); INSERT INTO deployment_probe VALUES ('retained')");
    db.close();
  `);
  docker('stop','--time','10',name);
  assert.equal(docker('inspect','--format','{{.State.ExitCode}}',name),'0');
  docker('start',name);
  await ready();
  docker('exec',name,'node','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    const db=new DatabaseSync('/app/.data/breja.sqlite');
    assert.equal(db.prepare('SELECT value FROM deployment_probe').get().value,'retained');
    db.close();
  `);
  console.log('Container smoke test passed: HTTP, production isolation, SIGTERM and SQLite persistence.');
}finally{
  try{docker('rm','-f',name);}catch{}
  docker('volume','rm',volume);
}
