import { test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';import { tmpdir } from 'node:os';import { join } from 'node:path';
import { task } from './tasks';import { handle } from './adapter';import { dispatch } from './server';
let dir:string,old:string|undefined;
beforeEach(async()=>{old=process.env.CODEX_HOME;dir=await mkdtemp(join(tmpdir(),'taskview-test-'));process.env.CODEX_HOME=dir;});
afterEach(async()=>{if(old===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=old;await rm(dir,{recursive:true,force:true});});
test('no task limit, one active task, replacement and exact persisted progress',()=>{
 for(let i=0;i<6;i++)task('s','add',{title:'Task '+i});
 const tasks=task('s','list');task('s','active',{id:tasks[0].id});task('s','active',{id:tasks[1].id});
 expect(task('s','list').filter(t=>t.status==='active')).toHaveLength(1);
 task('s','progress',{id:tasks[1].id,progress:61});expect(task('s','list')[1].progress).toBe(61);
 expect(()=>task('s','progress',{id:tasks[1].id,progress:101})).toThrow();
 task('s','replace',{id:tasks[0].id,title:'Replacement'});expect(task('s','list')).toHaveLength(6);
 expect(task('other','list')).toEqual([]);
});
test('blocked work requires reason, completion and resume restore state without continuation loop',async()=>{
 const t=task('s','add',{title:'Outcome'})[0];expect(()=>task('s','block',{id:t.id})).toThrow();task('s','block',{id:t.id,reason:'missing input'});
 const resume=await handle({session_id:'s',hook_event_name:'SessionStart'});expect(resume?.hookSpecificOutput?.additionalContext).toContain('missing input');
 const stop=await handle({session_id:'s',hook_event_name:'Stop'});expect(stop).not.toHaveProperty('decision');expect(stop).not.toHaveProperty('continue');
 task('s','complete',{id:t.id});expect(task('s','list')[0].status).toBe('done');
});
test('MCP validates actions and exposes the original task tool name',async()=>{
 expect((await dispatch({id:1,method:'tools/list'}))?.result.tools[0].name).toBe('task');
 expect((await dispatch({id:2,method:'tools/call',params:{name:'task',arguments:{session_id:'s',action:'bad'}}}))?.result.isError).toBe(true);
});
