import { mutate, read, id } from './state';
export type Task = { id: string; title: string; progress: number; status: 'todo'|'active'|'done'|'blocked'; reason?: string };
export function task(session: string, action: string, args: any = {}) {
  const key = 'tasks:' + id(session);
  if (action === 'list') return read(key, []) as Task[];
  return mutate(key, [], (tasks: Task[]) => {
    if (action === 'clear') { tasks.splice(0); return tasks; }
    if (!['add','replace','remove','active','progress','complete','block'].includes(action)) throw Error('Unknown task action');
    const current = tasks.find(t => t.id === args.id);
    if (action !== 'add' && !current) throw Error('Task not found');
    if (action === 'add' || action === 'replace') {
      if (typeof args.title !== 'string' || !args.title.trim() || args.title.length > 240) throw Error('Provide a title of 1–240 characters');
      const t: Task = { id: crypto.randomUUID(), title: args.title.trim(), progress: 0, status: 'todo' };
      if (current) tasks.splice(tasks.indexOf(current), 1, t); else tasks.push(t);
    } else if (action === 'remove') tasks.splice(tasks.indexOf(current!), 1);
    else if (action === 'block') {
      if (typeof args.reason !== 'string' || !args.reason.trim()) throw Error('A blocked task needs a reason');
      current!.status = 'blocked'; current!.reason = args.reason.slice(0, 500);
    } else {
      if (action === 'progress' && (!Number.isFinite(args.progress) || args.progress < 0 || args.progress > 100)) throw Error('Progress must be 0–100');
      if (action === 'active') { for (const t of tasks) if (t.status === 'active') t.status = 'todo'; current!.status = 'active'; if (current!.progress === 100) current!.progress = 0; }
      else { current!.progress = action === 'complete' ? 100 : args.progress; current!.status = current!.progress === 100 ? 'done' : current!.status === 'active' ? 'active' : 'todo'; }
      delete current!.reason;
    }
    return tasks;
  });
}
export function taskText(session: string) {
  return task(session, 'list').map(t => `${t.status} ${t.progress}% ${t.title}${t.reason ? ': '+t.reason : ''}`).join('\n');
}
