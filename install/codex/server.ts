import { createInterface } from 'node:readline';
import { task } from './tasks';
const invoke=(a:any)=>task(a.session_id,a.action,a);
const str={type:'string'};
const definition={"name": "task", "description": "Persist tasks per session. Track progress, completion and blocked reasons without a second resume loop.", "inputSchema": {"type": "object", "properties": {"session_id": {"type": "string"}, "action": {"enum": ["list", "add", "replace", "remove", "clear", "active", "progress", "complete", "block"]}, "id": {"type": "string"}, "title": {"type": "string"}, "progress": {"type": "number", "minimum": 0, "maximum": 100}, "reason": {"type": "string"}}, "required": ["session_id", "action"], "additionalProperties": false}};
export async function dispatch(r:any) {
 if(r.id===undefined) return;
 let result:any;
 if(r.method==='initialize') result={protocolVersion:r.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'taskview',version:'0.3.0'}};
 else if(r.method==='ping') result={};
 else if(r.method==='tools/list') result={tools:[definition]};
 else if(r.method==='tools/call') {
  try {if(r.params?.name!==definition.name)throw Error('Unknown tool');const a=r.params.arguments||{};const value=await invoke(a);result={content:[{type:'text',text:JSON.stringify(value)}]};}
  catch(e){result={isError:true,content:[{type:'text',text:String(e instanceof Error?e.message:e)}]};}
 }else return {jsonrpc:'2.0',id:r.id,error:{code:-32601,message:'Method not found'}};
 return {jsonrpc:'2.0',id:r.id,result};
}
if(import.meta.main) for await(const line of createInterface({input:process.stdin})) {try {const r=await dispatch(JSON.parse(line));if(r)console.log(JSON.stringify(r));}catch{console.log(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}}));}}
