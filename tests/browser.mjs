import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { dispatch } from './dispatch.js';
process.env.APP_ORIGIN='https://breja.test';process.env.DATABASE_PATH=':memory:';process.env.NODE_ENV='development';
const {api,store}=await import('../server/index.js');
const playwright=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright');
const browser=await playwright.chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{})});
const errors=[];mkdirSync('test-results',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!=='https://breja.test')return route.abort();
  if(url.pathname.startsWith('/api/')){
   const result=await dispatch(api,url.pathname,{method:request.method(),body:request.postData()||undefined,headers:await request.allHeaders(),origin:'https://breja.test'});
   return route.fulfill({status:result.status,headers:result.headers,body:result.body});
  }
  const file=url.pathname.includes('.')?url.pathname:'/index.html';
  const type=file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html';
  return route.fulfill({status:200,contentType:type,body:readFileSync(resolve('public','.'+file))});
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('https://breja.test');await page.getByRole('button',{name:'Explore as organiser',exact:true}).click();
 await page.getByRole('heading',{name:'Hi, Alex.',exact:true}).waitFor();
 await page.screenshot({path:'test-results/home-desktop.png',fullPage:true});
 // Create a match through the real form and API handler.
 await page.getByRole('button',{name:'Create match',exact:true}).click();
 await page.locator('dialog [name="title"]').fill('QA Saturday');
 await page.locator('dialog [name="date"]').fill('2027-06-05');
 await page.locator('dialog [name="venue_id"]').selectOption('custom');
 await page.locator('dialog [name="venue"]').fill('QA pitch');
 await page.locator('dialog [name="address"]').fill('Test pitch address');
 await page.locator('dialog').getByRole('button',{name:'Create match',exact:true}).click();
 await page.locator('dialog').waitFor({state:'hidden'});
 await page.getByRole('heading',{name:'QA Saturday',exact:true,level:1}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'QA Saturday',exact:true,level:1}).waitFor();
 // Sign up, add a guest, and see persistent registrations.
 await page.getByRole('button',{name:'Count me in',exact:true}).last().click();
 await page.locator('dialog input[type="checkbox"]').check();await page.locator('dialog button[type="submit"]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Bring a guest',exact:true}).click();
 await page.locator('dialog [name="guest_name"]').fill('QA Guest');for(const c of await page.locator('dialog input[type="checkbox"]').all())await c.check();
 await page.locator('dialog button[type="submit"]').click();await page.locator('dialog').waitFor({state:'hidden'});
 await page.getByText('QA Guest',{exact:true}).waitFor();
 // Payment recording updates the real ledger, and persists after reload.
 await page.locator('[data-nav="/payments"]').first().click();await page.getByRole('button',{name:'Record payment',exact:true}).click();
 await page.locator('dialog [name="amount"]').fill('5');await page.locator('dialog button[type="submit"]').click();await page.locator('dialog').waitFor({state:'hidden'});
 const alex=store.get("SELECT id FROM users WHERE email='alex@example.test'");assert.equal(store.balance(alex.id),1000);
 // Close the previously seeded match with individual attendance choices.
 await page.locator('[data-nav="/matches"]').first().click();await page.getByRole('button',{name:'Past matchdays',exact:true}).click();
 await page.getByRole('link',{name:'View match',exact:true}).first().click();await page.getByRole('button',{name:'Review attendance',exact:true}).click();
 for(const select of await page.locator('dialog select').all())await select.selectOption('played');
 await page.locator('dialog button[type="submit"]').click();await page.locator('dialog').waitFor({state:'hidden'});
 assert.equal(store.balance(alex.id),1500);
 // Local statements must be previewed, generated and readable.
 await page.locator('[data-nav="/statements"]').first().click();await page.getByRole('button',{name:'Review statements',exact:true}).click();
 await page.getByRole('button',{name:'Create monthly statements',exact:true}).click();await page.locator('dialog button[type="submit"]').click();await page.locator('dialog').waitFor({state:'hidden'});
 assert.ok(store.all('SELECT * FROM statements').length>0);assert.equal(store.all("SELECT * FROM outbox WHERE status='sent'").length,0);
 // All routes must fit desktop and small mobile, in all three languages.
 for(const language of ['en','de','es']){
  await page.locator('[data-language]').selectOption(language);
  for(const width of [1440,360,320]){
   await page.setViewportSize({width,height:1000});
   for(const path of ['/','/matches','/account','/members','/payments','/statements','/news','/profile','/venues','/settings']){
    await page.goto('https://breja.test'+path);await page.locator('.page').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow: ${language} ${width} ${path}`);
   }
  }
 }
 await page.setViewportSize({width:390,height:1000});await page.goto('https://breja.test');await page.locator('.page').waitFor();await page.screenshot({path:'test-results/home-mobile-de.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS: offline browser integration using real API handlers, creation, reload, signup, guest, payment, attendance, statements, EN/DE/ES and 320/360/1440px layouts.');
}finally{await browser.close();store.db.close();}
