import test from 'node:test';
import assert from 'node:assert/strict';
import { invitation, mapEmbed, newsText } from '../public/match-utils.js';
import { newsImage, newsInput } from '../server/news.js';

test('invitation is English and includes place, address, map and registration link',()=>{
 const match={title:'Partido del sábado',starts_at:'2026-10-24T09:00:00Z',ends_at:'2026-10-24T10:30:00Z',timezone:'Europe/Vienna',venue:'Test arena',address:'Test street 12',map_url:'https://maps.example.test/arena',price_cents:500,share_token:'invite123'};
 const message=invitation(match,'https://breja.example');
 for(const expected of ['Breja FC','Saturday','11:00','12:30','Where: Test arena','Test street 12','https://maps.example.test/arena','Price: €5.00 per player','https://breja.example/m/invite123'])assert.ok(message.includes(expected),expected);
 assert.doesNotMatch(message,/Partido|por jugador|⚽|�/);
 const map=new URL(mapEmbed(match));assert.equal(map.searchParams.get('q'),'Test street 12 Test arena');assert.equal(map.searchParams.get('output'),'embed');
 assert.equal(mapEmbed({venue:'Unknown pitch',address:'',map_url:'https://maps.app.goo.gl/example'}),'','a short map link is not treated as an address');
});

test('news can be Spanish only and uses one complete translation for fallback',()=>{
 const post=newsInput({title_es:'Noticia',body_es:'Contenido',pinned:true});
 assert.equal(newsText(post,'title','en'),'Noticia');assert.equal(newsText(post,'body','de'),'Contenido');
 assert.throws(()=>newsInput({title_es:'Title only'}),{code:'news_translation_incomplete'});
 assert.throws(()=>newsInput({}),{code:'news_content_required'});
 assert.equal(newsText({...post,title_en:'Partial draft'},'title','en'),'Noticia');
});

test('images reject executable content, forged MIME types and oversized uploads',()=>{
 assert.equal(newsImage(''),null);
 for(const image of ['https://example.test/image.png','data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=','data:image/png;base64,PGh0bWw+bm90IGFuIGltYWdlPC9odG1sPg=='])assert.throws(()=>newsImage(image),{code:'invalid_image'});
 const oversized='data:image/jpeg;base64,'+Buffer.alloc(2*1024*1024+1).toString('base64');assert.throws(()=>newsImage(oversized),{code:'image_too_large'});
});
