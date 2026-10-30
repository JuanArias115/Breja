import { Readable } from 'node:stream';

// Exercise the real API handlers without opening network sockets.
export async function dispatch(api,path,{method='GET',body,headers={},origin='http://breja.test'}={}){
 const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
 req.method=method;req.headers={origin,'content-type':'application/json',...headers};req.socket={remoteAddress:'test'};
 const result={status:200,headers:{},body:''};
 const res={setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,headers){result.status=status;for(const [k,v]of Object.entries(headers||{}))result.headers[k.toLowerCase()]=v;},end(body=''){result.body=body;}};
 try{await api(req,res,new URL(path,origin));}catch(e){result.status=e.status||500;result.body=JSON.stringify({error:e.code||'server_error',details:e.details||{}});result.headers['content-type']='application/json';if(!e.status)throw e;}
 result.json=()=>JSON.parse(result.body);return result;
}
