import { taskText } from './tasks';
import { id } from './state';
export async function handle(input:any) {
 const sid=id(input.session_id);const tasks=taskText(sid);
 if(input.hook_event_name==='SessionStart') return {hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:`Taskview session: ${sid}. For substantial implementation work track the outcomes through taskview task, restoring existing tasks first. Keep progress current. Ordinary questions need no tasks. Orly owns completion checks and continuation; task state never overrides a user stop.\n${tasks}`}};
 if(input.hook_event_name==='Stop' && tasks) return {systemMessage:'Tasks\n'+tasks};
}
if(import.meta.main) {try {const r=await handle(await new Response(Bun.stdin.stream()).json());if(r)console.log(JSON.stringify(r));}catch(e){console.error('taskview: '+String(e));}}
