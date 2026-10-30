import { fail, text } from './store.js';

export function newsImage(value=''){
 fail(typeof value==='string','invalid_image');
 if(!value)return null;
 const parts=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 fail(parts,'invalid_image');
 const buffer=Buffer.from(parts[2],'base64');
 fail(buffer.length<=2*1024*1024,'image_too_large',413);
 fail(buffer.length>=12&&buffer.toString('base64')===parts[2],'invalid_image');
 const valid=parts[1]==='jpeg'?buffer[0]===255&&buffer[1]===216&&buffer[2]===255:
   parts[1]==='png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
   buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
 fail(valid,'invalid_image');return {buffer,type:'image/'+parts[1]};
}
export function newsInput(input){
 const result={};let count=0;
 for(const code of ['en','de','es','pt','ar']){
  const title=text(input['title_'+code]||'',160,false),body=text(input['body_'+code]||'',4000,false);
  fail(Boolean(title)===Boolean(body),'news_translation_incomplete');
  result['title_'+code]=title;result['body_'+code]=body;if(title)count++;
 }
 fail(count>0,'news_content_required');newsImage(input.image_data||'');
 return {...result,image_data:input.image_data||'',pinned:input.pinned===true};
}
