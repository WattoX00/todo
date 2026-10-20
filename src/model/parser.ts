export interface Todo {
  id: string;
  text: string;
  done: boolean;
  pinned: boolean;
}

export interface Note {
  id: string;
  text: string;
}

export type ListLine = { kind: 'todo'; todo: Todo } | { kind: 'note'; note: Note };

export interface ParsedList {
  title: string;
  lines: ListLine[];
  trailingNewline: boolean;
}

let nextId = 0;
const id = () => `line-${++nextId}`;
const TODO_LINE = /^([*-]) \[([ xX])\] ?(.*)$/;

export function parseList(content: string, fallbackTitle = 'Untitled'): ParsedList {
  const normalized = content.replace(/\r\n?/g, '\n');
  const trailingNewline = normalized.endsWith('\n');
  const sourceLines = normalized.split('\n');
  if (trailingNewline) sourceLines.pop();
  let title = fallbackTitle;
  let start = 0;
  if (sourceLines[0]?.startsWith('# ')) {
    title = sourceLines[0].slice(2).trim() || fallbackTitle;
    start = 1;
    if (sourceLines[start] === '') start++;
  } else if (sourceLines.length === 1 && sourceLines[0] === '') {
    sourceLines.pop();
  }
  const lines = sourceLines.slice(start).map((raw): ListLine => {
    const match = TODO_LINE.exec(raw);
    if (!match) return { kind: 'note', note: { id: id(), text: raw } };
    return {
      kind: 'todo',
      todo: { id: id(), pinned: match[1] === '*', done: match[2].toLowerCase() === 'x', text: match[3] },
    };
  });
  return { title, lines, trailingNewline };
}

export function serializeList(list: ParsedList): string {
  const lines = [`# ${list.title}`, '', ...list.lines.map((line) => {
    if (line.kind === 'note') return line.note.text;
    const todo = line.todo;
    return `${todo.pinned ? '*' : '-'} [${todo.done ? 'x' : ' '}]${todo.text ? ` ${todo.text}` : ''}`;
  })];
  return lines.join('\n') + (list.trailingNewline ? '\n' : '');
}

export function shareText(list: ParsedList, onlyTodoId?: string): string {
  const todos = list.lines
    .filter((line): line is Extract<ListLine, { kind: 'todo' }> => line.kind === 'todo')
    .map(({ todo }) => todo)
    .filter((todo) => !onlyTodoId || todo.id === onlyTodoId)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
  if (onlyTodoId) return todos[0]?.text ?? '';
  return `${list.title}\n\n${todos.map((todo) => `[${todo.done ? 'x' : ' '}]${todo.text ? ` ${todo.text}` : ''}`).join('\n')}`;
}

export interface MergeResult {
  clean: boolean;
  content?: string;
  reason?: string;
}

export function mergeLines(base: string, local: string, remote: string): MergeResult {
  if (local === remote) return { clean: true, content: local };
  if (local === base) return { clean: true, content: remote };
  if (remote === base) return { clean: true, content: local };
  const b = base.split('\n');
  const l = local.split('\n');
  const r = remote.split('\n');
  const max = Math.max(b.length, l.length, r.length);
  const result: string[] = [];
  for (let i = 0; i < max; i++) {
    const baseLine = b[i];
    const localLine = l[i];
    const remoteLine = r[i];
    if (localLine === remoteLine) result.push(localLine ?? '');
    else if (localLine === baseLine) result.push(remoteLine ?? '');
    else if (remoteLine === baseLine) result.push(localLine ?? '');
    else return { clean: false, reason: 'Both versions changed the same line.' };
  }
  return { clean: true, content: result.join('\n') };
}
