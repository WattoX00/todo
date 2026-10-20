import './styles.css';
import { GitHubClient, GitHubError, type Credentials } from './api/github';
import { bindings, matchSequence } from './keys/registry';
import { mergeLines, parseList, serializeList, shareText, type ListLine, type ParsedList, type Todo } from './model/parser';
import { UndoStack } from './state/undo';
import {
  clearCache, clearCredentials, loadCache, loadCredentials, saveCache, saveCredentials,
  type CachedList,
} from './storage/local';

const rootElement = document.querySelector<HTMLDivElement>('#app');
if (!rootElement) throw new Error('Application root element is missing.');
const root: HTMLDivElement = rootElement;

let credentials: Credentials | undefined;
let client: GitHubClient | undefined;
let lists: CachedList[] = [];
let currentPath: string | undefined;
let selected = 0;
let mode: 'NAV' | 'EDIT' = 'NAV';
let editSourceIndex: number | undefined;
let draftRecorded = false;
let filterText = '';
let listFilter = '';
let sortMode: 'recent' | 'alpha' = 'recent';
let hideCompleted = false;
let pendingKeys = '';
let pendingTimer: number | undefined;
const saveTimers = new Map<string, number>();
let focusRefreshAt = 0;
let toastTimer: number | undefined;
let cacheWarning = '';
let cacheWriteWarningShown = false;
const histories = new Map<string, UndoStack<string>>();

function historyFor(record: CachedList): UndoStack<string> {
  let stack = histories.get(record.path);
  if (!stack) {
    stack = new UndoStack<string>(150);
    histories.set(record.path, stack);
  }
  return stack;
}

type ButtonOptions = { className?: string; title?: string; ariaLabel?: string; bindingId?: string };
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function syncRoute(): void {
  if (!credentials) return;
  const nextHash = currentPath ? `#/list/${encodeURIComponent(fileId(currentPath))}` : '#/';
  if (window.location.hash !== nextHash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${nextHash}`);
  }
}

function applyHashRoute(): void {
  const match = /^#\/list\/([^/]+)$/.exec(window.location.hash);
  if (!match) {
    currentPath = undefined;
    return;
  }
  const id = decodeURIComponent(match[1]);
  currentPath = lists.find((record) => fileId(record.path) === id)?.path;
}

function button(label: string, action: () => void, options: ButtonOptions = {}): HTMLButtonElement {
  const node = element('button', label, options.className ?? 'button');
  node.type = 'button';
  const binding = options.bindingId ? bindings.find((item) => item.id === options.bindingId) : undefined;
  if (options.title || binding) node.title = [options.title, binding?.keys].filter(Boolean).join(' · ');
  if (options.ariaLabel) node.setAttribute('aria-label', options.ariaLabel);
  node.addEventListener('click', action);
  return node;
}

function activeList(): CachedList | undefined {
  return lists.find((list) => list.path === currentPath);
}

function readList(record: CachedList): ParsedList {
  const titleFromPath = record.path.split('/').pop()?.replace(/\.txt$/, '').replace(/-[a-z0-9]{4}$/i, '').replace(/-/g, ' ');
  return parseList(record.content, titleFromPath || 'Untitled');
}

function persistCache(): void {
  if (!credentials) return;
  try {
    saveCache(credentials, { lists });
  } catch {
    setStatus('Local cache error', 'error');
    if (!cacheWriteWarningShown) {
      toast('Could not save the local cache. Current edits remain in memory; check browser storage space and permissions.');
      cacheWriteWarningShown = true;
    }
  }
}

function restoreCache(value: Credentials): CachedList[] {
  try {
    return loadCache(value).lists;
  } catch (error) {
    cacheWarning = error instanceof Error ? error.message : 'Cached lists could not be read.';
    return [];
  }
}

function notifyCacheWarning(): void {
  if (!cacheWarning) return;
  toast(cacheWarning);
  cacheWarning = '';
}

function setStatus(message: string, state = ''): void {
  const node = document.querySelector<HTMLElement>('#sync-status');
  if (node) {
    node.textContent = message;
    node.className = `sync-status ${state}`.trim();
    node.setAttribute('aria-live', 'polite');
  }
}

function toast(message: string, actionLabel?: string, action?: () => void): void {
  const area = document.querySelector<HTMLElement>('#toasts');
  if (!area) return;
  area.replaceChildren();
  const item = element('div', undefined, 'toast');
  item.setAttribute('role', 'status');
  item.append(element('span', message));
  if (actionLabel && action) item.append(button(actionLabel, action, { className: 'text-button' }));
  area.append(item);
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => area.replaceChildren(), 4500);
}

function createDialog(title: string, description?: string): { dialog: HTMLDialogElement; body: HTMLDivElement } {
  const dialog = element('dialog', undefined, 'dialog');
  const heading = element('h2', title);
  dialog.setAttribute('aria-labelledby', 'dialog-title');
  heading.id = 'dialog-title';
  dialog.append(heading);
  if (description) dialog.append(element('p', description, 'muted'));
  const body = element('div', undefined, 'dialog-body');
  dialog.append(body);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, body };
}

function askText(title: string, initial = ''): Promise<string | null> {
  return new Promise((resolve) => {
    const { dialog, body } = createDialog(title);
    const form = element('form');
    form.method = 'dialog';
    const input = element('input');
    input.type = 'text';
    input.value = initial;
    input.maxLength = 120;
    input.setAttribute('aria-label', title);
    const actions = element('div', undefined, 'dialog-actions');
    const cancel = button('Cancel', () => dialog.close(), { className: 'button secondary' });
    const save = element('button', 'Continue', 'button');
    save.type = 'submit';
    actions.append(cancel, save);
    form.append(input, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      dialog.close();
      resolve(input.value.trim() || null);
    });
    dialog.addEventListener('close', () => resolve(null), { once: true });
    body.append(form);
    input.focus();
    input.select();
  });
}

function confirmAction(title: string, description: string): Promise<boolean> {
  return new Promise((resolve) => {
    const { dialog, body } = createDialog(title, description);
    const actions = element('div', undefined, 'dialog-actions');
    actions.append(button('Cancel', () => { dialog.close(); resolve(false); }, { className: 'button secondary' }));
    actions.append(button('Confirm', () => { dialog.close(); resolve(true); }));
    dialog.addEventListener('close', () => resolve(false), { once: true });
    dialog.addEventListener('keydown', (event) => {
      if (matchesBinding(event, 'confirm-yes')) {
        event.preventDefault();
        dialog.close();
        resolve(true);
      } else if (matchesBinding(event, 'confirm-no')) {
        event.preventDefault();
        dialog.close();
        resolve(false);
      }
    });
    body.append(actions);
    actions.querySelector<HTMLButtonElement>("button:last-child")?.focus();
  });
}

function showHelp(): void {
  const { body } = createDialog('Keyboard shortcuts', 'Navigate mode shortcuts are disabled while typing in a field.');
  const table = element('div', undefined, 'shortcut-list');
  for (const binding of bindings) {
    const row = element('div', undefined, 'shortcut-row');
    row.append(element('kbd', binding.keys), element('span', binding.label));
    table.append(row);
  }
  body.append(table, button('Done', () => document.querySelector<HTMLDialogElement>("dialog[open]")?.close()));
}

function expireSession(): void {
  if (credentials) persistCache();
  clearCredentials();
  credentials = undefined;
  client = undefined;
  renderLogin('Session expired. Unsynced edits have been kept in this device cache.', true);
}

function renderLogin(message = '', expired = false): void {
  mode = 'NAV';
  root.replaceChildren();
  const page = element('main', undefined, 'login-page');
  const card = element('section', undefined, 'login-card');
  card.append(element('p', 'PRIVATE REPOSITORY TODO LIST', 'eyebrow'), element('h1', 'Your tasks, your repository'));
  card.append(element('p', expired ? 'Your session expired. Your unsynced changes remain cached on this device.' : 'Sign in with a repository-scoped GitHub token. Your todo files stay in your private repository.', 'muted'));
  if (message) {
    const error = element('p', message, 'error-message');
    error.setAttribute('role', 'alert');
    card.append(error);
  }
  const form = element('form');
  form.autocomplete = 'off';
  const tokenLabel = element('label', 'GitHub token');
  const tokenRow = element('div', undefined, 'token-row');
  const token = element('input');
  token.type = 'password';
  token.name = 'token';
  token.autocomplete = 'new-password';
  token.required = true;
  token.placeholder = 'github_pat_…';
  token.setAttribute('aria-label', 'GitHub token');
  const toggle = button('Show', () => {
    const visible = token.type === 'password';
    token.type = visible ? 'text' : 'password';
    toggle.textContent = visible ? 'Hide' : 'Show';
  }, { className: 'button secondary', ariaLabel: 'Show or hide token' });
  tokenRow.append(token, toggle);
  tokenLabel.append(tokenRow);
  const repoLabel = element('label', 'Private repository (owner/repo)');
  const repository = element('input');
  repository.name = 'repository';
  repository.required = true;
  repository.placeholder = 'your-name/private-todos';
  repository.autocomplete = 'off';
  repoLabel.append(repository);
  const branchLabel = element('label', 'Branch (optional)');
  const branch = element('input');
  branch.name = 'branch';
  branch.placeholder = 'Default branch';
  branch.autocomplete = 'off';
  branchLabel.append(branch);
  const rememberLabel = element('label', undefined, 'checkbox-label');
  const remember = element('input');
  remember.type = 'checkbox';
  remember.checked = true;
  rememberLabel.append(remember, element('span', 'Remember me on this device'));
  const submit = element('button', 'Connect repository', 'button primary full-width');
  submit.type = 'submit';
  form.append(tokenLabel, repoLabel, branchLabel, rememberLabel, submit);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.textContent = 'Connecting…';
    try {
      const repoMatch = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository.value.trim());
      if (!repoMatch) throw new Error('Enter the repository as owner/repo.');
      const newCredentials: Credentials = {
        token: token.value.trim(),
        owner: repoMatch[1],
        repo: repoMatch[2],
        branch: branch.value.trim(),
      };
      const newClient = new GitHubClient(newCredentials);
      const info = await newClient.validate();
      if (!newCredentials.branch) newCredentials.branch = info.default_branch;
      credentials = newCredentials;
      client = new GitHubClient(newCredentials);
      saveCredentials(newCredentials, remember.checked);
      lists = restoreCache(newCredentials);
      applyHashRoute();
      selected = 0;
      render();
      notifyCacheWarning();
      refresh().catch(showError);
    } catch (error) {
      const text = error instanceof GitHubError
        ? error.status === 401
          ? 'Token rejected. Check that it is active and has Contents read/write access.'
          : error.message
        : error instanceof Error ? error.message : 'Could not connect to GitHub.';
      renderLogin(text);
    }
  });
  const instructions = element('details');
  instructions.append(element('summary', 'How to create a fine-grained token'));
  const steps = element('ol');
  for (const text of [
    'GitHub → Settings → Developer settings → Fine-grained tokens.',
    'Choose only the private todo repository under Repository access.',
    'Grant Contents: Read and write. Metadata: Read is added automatically.',
    'Set an expiration, then paste the token above. The token is sent only to api.github.com.',
  ]) steps.append(element('li', text));
  instructions.append(steps);
  card.append(form, instructions);
  page.append(card);
  root.append(page);
}

function sortedLists(): CachedList[] {
  const matching = lists.filter((record) => {
    if (record.deleted) return false;
    const parsed = readList(record);
    return `${parsed.title} ${parsed.lines.map((line) => line.kind === 'todo' ? line.todo.text : line.note.text).join(' ')}`.toLowerCase().includes(listFilter.toLowerCase());
  });
  return matching.sort((a, b) => sortMode === 'alpha'
    ? readList(a).title.localeCompare(readList(b).title)
    : b.modifiedAt - a.modifiedAt);
}

function visibleLines(parsed: ParsedList): Array<{ line: ListLine; sourceIndex: number }> {
  const ordered = parsed.lines.map((line, sourceIndex) => ({ line, sourceIndex }));
  const pinned = ordered.filter(({ line }) => line.kind === 'todo' && line.todo.pinned);
  const rest = ordered.filter(({ line }) => line.kind !== 'todo' || !line.todo.pinned);
  return [...pinned, ...rest].filter(({ line }) => {
    if (line.kind === 'todo' && hideCompleted && line.todo.done) return false;
    if (filterText && !lineText(line).toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });
}

function lineText(line: ListLine): string {
  return line.kind === 'todo' ? line.todo.text : line.note.text;
}

function render(): void {
  if (!credentials || !client) {
    renderLogin();
    return;
  }
  root.replaceChildren();
  const app = element('div', undefined, 'app-shell');
  const toastRegion = element('div');
  toastRegion.id = 'toasts';
  toastRegion.setAttribute('aria-live', 'polite');
  app.append(toastRegion);
  const header = element('header', undefined, 'topbar');
  const brand = button('✓ Private Todos', () => { currentPath = undefined; selected = 0; render(); }, { className: 'brand' });
  header.append(brand);
  const hasUnsaved = lists.some((record) => record.dirty);
  const statusText = hasUnsaved ? navigator.onLine ? 'Unsaved changes' : 'Offline' : 'Saved ✓';
  const status = element('button', statusText, `sync-status${hasUnsaved ? navigator.onLine ? ' unsaved' : ' offline' : ' saved'}`);
  status.id = 'sync-status';
  status.type = 'button';
  status.setAttribute('aria-live', 'polite');
  status.title = `Click to retry sync · ${bindings.find((binding) => binding.id === 'save')?.keys ?? ''}`;
  status.addEventListener('click', () => flushAll(true));
  header.append(status);
  header.append(element('span', pendingKeys ? `Keys: ${pendingKeys}_` : '', 'pending-keys'));
  header.append(element('span', mode, 'mode-badge'));
  header.append(button('?', showHelp, { className: 'icon-button', ariaLabel: 'Keyboard help', bindingId: 'help' }));
  header.append(button('Menu', showMenu, { className: 'button secondary menu-button' }));
  app.append(header);
  const main = element('main', undefined, 'main-content');
  const page = currentPath ? renderList() : renderLists();
  syncRoute();
  main.append(page);
  app.append(main);
  const footer = element('footer', undefined, 'mobile-bar');
  footer.append(
    button('Add', () => currentPath ? addTodo() : createList()),
    button('Share', () => currentPath ? showShare() : showToastMessage('Open a list to share it.')),
    button('Back', goBack),
    button('Menu', showMenu),
  );
  app.append(footer);
  root.append(app);
}

function renderLists(): HTMLElement {
  const page = element('section', undefined, 'page');
  const titleRow = element('div', undefined, 'page-heading');
  const heading = element('div');
  heading.append(element('p', 'YOUR PRIVATE SPACE', 'eyebrow'), element('h1', 'Lists'));
  const controls = element('div', undefined, 'heading-actions');
  controls.append(button(sortMode === 'recent' ? 'Recent' : 'A–Z', () => {
    sortMode = sortMode === 'recent' ? 'alpha' : 'recent';
    render();
  }, { className: 'button secondary', title: 'Toggle list sorting (s)' }));
  controls.append(button('+ New list', createList, { className: 'button primary', bindingId: 'new-list' }));
  titleRow.append(heading, controls);
  page.append(titleRow);
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Search all lists and todos…';
  search.value = listFilter;
  search.setAttribute('aria-label', 'Search all lists and todos');
  search.addEventListener('input', () => { listFilter = search.value; selected = 0; render(); const next = root.querySelector<HTMLInputElement>('input[type=search]'); next?.focus(); next?.setSelectionRange(listFilter.length, listFilter.length); });
  page.append(search);
  const items = sortedLists();
  selected = Math.min(selected, Math.max(0, items.length - 1));
  const list = element('div', undefined, 'card-list');
  list.setAttribute('role', 'list');
  items.forEach((record, index) => {
    const parsed = readList(record);
    const todos = parsed.lines.filter((line): line is Extract<ListLine, { kind: 'todo' }> => line.kind === 'todo').map(({ todo }) => todo);
    const card = element('article', undefined, `list-card${index === selected ? ' selected' : ''}`);
    card.setAttribute('role', 'listitem');
    if (index === selected) card.setAttribute('aria-current', 'true');
    card.tabIndex = 0;
    card.addEventListener('click', () => { selected = 0; currentPath = record.path; filterText = ''; render(); });
    card.addEventListener('keydown', (event) => {
      if (matchesBinding(event, 'open')) {
        event.preventDefault();
        event.stopPropagation();
        selected = 0;
        currentPath = record.path;
        render();
      }
    });
    const main = element('div', undefined, 'list-card-main');
    main.append(element('h2', parsed.title));
    const count = todos.filter((todo) => !todo.done).length;
    main.append(element('p', `${count} open · ${todos.length} total`, 'muted'));
    const pins = todos.filter((todo) => todo.pinned).slice(0, 2).map((todo) => todo.text).join(' · ');
    if (pins) main.append(element('p', `📌 ${pins}`, 'preview'));
    const actions = element('div', undefined, 'card-actions');
    actions.append(button('Open', () => { selected = 0; currentPath = record.path; render(); }, { className: 'button secondary' }));
    actions.append(button('⋯', () => showListMenu(record), { className: 'icon-button', ariaLabel: `Options for ${parsed.title}` }));
    card.append(main, actions);
    list.append(card);
  });
  if (!items.length) {
    const empty = element('div', undefined, 'empty-state');
    empty.append(element('div', '☀', 'empty-icon'), element('h2', listFilter ? 'No matching lists' : 'No lists yet'), element('p', listFilter ? 'Try a different search.' : 'Press n or choose New list to get started.', 'muted'));
    if (!listFilter) empty.append(button('Create your first list', createList, { className: 'button primary' }));
    list.append(empty);
  }
  page.append(list);
  page.append(element('p', 'Press ? for the full keyboard reference · / to search', 'keyboard-hint'));
  return page;
}

function renderList(): HTMLElement {
  const record = activeList();
  if (!record) {
    currentPath = undefined;
    return renderLists();
  }
  const parsed = readList(record);
  const lines = visibleLines(parsed);
  selected = Math.min(Math.max(0, selected), Math.max(0, lines.length - 1));
  const page = element('section', undefined, 'page');
  const titleRow = element('div', undefined, 'page-heading list-heading');
  const heading = element('div');
  heading.append(button('← All lists', goBack, { className: 'back-link' }));
  heading.append(element('h1', parsed.title));
  heading.append(element('p', `${parsed.lines.filter((line) => line.kind === 'todo' && !line.todo.done).length} open`, 'muted'));
  const actions = element('div', undefined, 'heading-actions');
  actions.append(button('+ Add todo', addTodo, { className: 'button primary', bindingId: 'new-below' }));
  actions.append(button('Share', showShare, { className: 'button secondary', bindingId: 'share-list' }));
  actions.append(button('⋯', () => showListMenu(record), { className: 'icon-button', ariaLabel: 'List options' }));
  titleRow.append(heading, actions);
  page.append(titleRow);
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Filter this list…';
  search.value = filterText;
  search.setAttribute('aria-label', 'Filter todos in this list');
  search.addEventListener('input', () => {
    filterText = search.value;
    selected = 0;
    render();
    const next = root.querySelector<HTMLInputElement>('input[type=search]');
    next?.focus();
    next?.setSelectionRange(filterText.length, filterText.length);
  });
  page.append(search);
  const list = element('div', undefined, 'todo-list');
  list.setAttribute('role', 'list');
  let pinnedHeader = false;
  lines.forEach(({ line, sourceIndex }, visibleIndex) => {
    if (line.kind === 'todo' && line.todo.pinned && !pinnedHeader) {
      list.append(element('p', 'PINNED', 'section-label'));
      pinnedHeader = true;
    }
    if (line.kind === 'todo' && !line.todo.pinned && pinnedHeader) {
      list.append(element('p', 'TODOS', 'section-label'));
      pinnedHeader = false;
    }
    if (line.kind === 'note') {
      const note = element('div', line.note.text, 'note-line');
      note.setAttribute('role', 'listitem');
      list.append(note);
      return;
    }
    const todo = line.todo;
    const row = element('article', undefined, `todo-row${visibleIndex === selected ? ' selected' : ''}${todo.done ? ' completed' : ''}${todo.pinned ? ' pinned' : ''}`);
    row.setAttribute('role', 'listitem');
    if (visibleIndex === selected) row.setAttribute('aria-current', 'true');
    row.dataset.todoId = todo.id;
    row.tabIndex = 0;
    row.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button,input')) return;
      selected = visibleIndex;
      render();
    });
    row.addEventListener('dblclick', () => startEdit(sourceIndex));
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = todo.done;
    checkbox.setAttribute('aria-label', `Mark ${todo.text || 'empty todo'} ${todo.done ? 'open' : 'done'}`);
    checkbox.addEventListener('change', () => mutate((listValue) => {
      const target = listValue.lines[sourceIndex];
      if (target.kind === 'todo') target.todo.done = checkbox.checked;
    }));
    const content = element('div', undefined, 'todo-content');
    if (sourceIndex === editSourceIndex) {
      const input = element('input');
      input.className = 'todo-edit';
      input.value = todo.text;
      input.setAttribute('aria-label', 'Edit todo text');
      input.addEventListener('keydown', (event) => handleEditKey(event, sourceIndex, input.value));
      input.addEventListener('input', () => updateDraft(sourceIndex, input.value));
      input.addEventListener('paste', (event) => {
        const pasted = event.clipboardData?.getData('text/plain') ?? '';
        if (pasted.includes('\n') || pasted.includes('\r')) {
          event.preventDefault();
          pasteTodos(sourceIndex, input, pasted);
        }
      });
      input.addEventListener('blur', () => {
        if (editSourceIndex === sourceIndex) commitEdit(sourceIndex, input.value, false);
      });
      content.append(input);
      mode = 'EDIT';
      window.requestAnimationFrame(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); });
    } else {
      content.append(element('span', todo.text || 'Empty todo', 'todo-text'));
    }
    const controls = element('div', undefined, 'todo-controls');
    controls.append(button(todo.pinned ? '★' : '☆', () => mutate((listValue) => {
      const target = listValue.lines[sourceIndex];
      if (target.kind === 'todo') target.todo.pinned = !target.todo.pinned;
    }, { selection: (listValue) => visibleLines(listValue).findIndex((item) => item.sourceIndex === sourceIndex) }), {
      className: `icon-button pin-button${todo.pinned ? ' is-pinned' : ''}`,
      ariaLabel: `${todo.pinned ? 'Unpin' : 'Pin'} ${todo.text}`,
    }));
    controls.append(button('⋯', () => showTodoMenu(sourceIndex), { className: 'icon-button', ariaLabel: `Options for ${todo.text}` }));
    row.append(checkbox, content, controls);
    list.append(row);
  });
  if (!lines.length) {
    const empty = element('div', undefined, 'empty-state compact');
    empty.append(element('h2', filterText ? 'No matching todos' : 'A clear list'), element('p', filterText ? 'Try a different filter.' : 'Add your first task, then press Enter to keep outlining.', 'muted'));
    empty.append(button('Add a todo', addTodo, { className: 'button primary' }));
    list.append(empty);
  }
  page.append(list);
  const footer = element('div', undefined, 'list-footer');
  footer.append(button(hideCompleted ? 'Show completed' : 'Hide completed', () => { hideCompleted = !hideCompleted; render(); }, { className: 'text-button' }));
  footer.append(element('span', `${mode} mode · ? for shortcuts`, 'keyboard-hint'));
  page.append(footer);
  return page;
}

function listIndexForSelection(): number {
  return Math.min(selected, Math.max(0, sortedLists().length - 1));
}

function currentTodoSourceIndex(): number | undefined {
  const record = activeList();
  if (!record) return undefined;
  return visibleLines(readList(record))[selected]?.sourceIndex;
}

function mutate(change: (list: ParsedList) => void, options: { record?: CachedList; selection?: number | ((list: ParsedList) => number) } = {}): void {
  const record = options.record ?? activeList();
  if (!record) return;
  const parsed = readList(record);
  historyFor(record).push(record.content);
  change(parsed);
  record.content = serializeList(parsed);
  record.dirty = true;
  record.modifiedAt = Date.now();
  selected = typeof options.selection === 'function' ? options.selection(parsed) : options.selection ?? selected;
  persistCache();
  setStatus('Unsaved changes', 'unsaved');
  render();
  scheduleSave(record);
}

function scheduleSave(record: CachedList): void {
  const previous = saveTimers.get(record.path);
  if (previous) window.clearTimeout(previous);
  setStatus(navigator.onLine ? 'Unsaved changes' : 'Offline', navigator.onLine ? 'unsaved' : 'offline');
  saveTimers.set(record.path, window.setTimeout(() => {
    saveTimers.delete(record.path);
    saveRecord(record).catch(showError);
  }, 1000));
}

function saveRecord(record: CachedList): Promise<void> {
  const execute = async () => {
    if (!client || !credentials || !record.dirty) return;
    if (!navigator.onLine) {
      setStatus('Offline', 'offline');
      return;
    }
    setStatus('Saving…', 'saving');
    try {
      if (record.deleted) {
        if (record.sha) await client.deleteFile(record.path, record.sha, `Delete list: ${readList(record).title}`);
        record.sha = undefined;
        record.baseContent = '';
        record.etag = undefined;
        lists = lists.filter((item) => item.path !== record.path);
        persistCache();
        setStatus('Saved ✓', 'saved');
        render();
        return;
      }
      let contentToSave = record.content;
      let sha: string;
      try {
        sha = await client.putFile(record.path, contentToSave, record.sha ? `Update ${fileId(record.path)}` : `Create list: ${readList(record).title}`, record.sha);
      } catch (error) {
        if (!(error instanceof GitHubError) || !error.conflict) throw error;
        const remote = await client.getFile(record.path, true);
        const merge = mergeRemote(record, remote.content);
        if (merge === 'conflict') {
          const choice = await resolveConflict();
          if (choice === 'cancel') {
            setStatus('Unsaved changes', 'unsaved');
            return;
          }
          if (choice === 'remote') {
            record.content = remote.content;
            record.baseContent = remote.content;
            record.sha = remote.sha;
            record.dirty = false;
            persistCache();
            render();
            return;
          }
          if (choice === 'both') {
            const remoteLines = remote.content.replace(/\r\n?/g, '\n').split('\n');
            const remoteBody = remoteLines[0]?.startsWith('# ') ? remoteLines.slice(2).join('\n') : remote.content;
            const local = record.content.replace(/\n+$/, '');
            const appended = remoteBody.replace(/^\n+|\n+$/g, '');
            record.content = `${local}${appended ? `\n${appended}` : ''}\n`;
          }
        }
        contentToSave = record.content;
        sha = await client.putFile(record.path, contentToSave, `Update ${fileId(record.path)}`, remote.sha);
      }
      record.sha = sha;
      record.baseContent = contentToSave;
      record.etag = undefined;
      record.dirty = record.content !== contentToSave;
      persistCache();
      if (record.dirty) scheduleSave(record);
      else setStatus('Saved ✓', 'saved');
    } catch (error) {
      if (error instanceof GitHubError && error.status === 401) {
        expireSession();
        return;
      }
      if (error instanceof GitHubError && error.status === 0) setStatus('Offline', 'offline');
      else setStatus('Error · click to retry', 'error');
      showError(error);
      return;
    }
  };
  return queueWrite(record.path, execute);
}

const writeQueues = new Map<string, Promise<void>>();
function queueWrite(path: string, action: () => Promise<void>): Promise<void> {
  const prior = writeQueues.get(path) ?? Promise.resolve();
  const next = prior.catch(() => undefined).then(action);
  writeQueues.set(path, next);
  return next.finally(() => {
    if (writeQueues.get(path) === next) writeQueues.delete(path);
  });
}

function mergeRemote(record: CachedList, remote: string): 'merged' | 'conflict' {
  const merged = mergeLines(record.baseContent, record.content, remote);
  if (!merged.clean || merged.content === undefined) return 'conflict';
  record.content = merged.content;
  record.baseContent = remote;
  return 'merged';
}

async function resolveConflict(): Promise<'mine' | 'remote' | 'both' | 'cancel'> {
  return new Promise((resolve) => {
    const { dialog, body } = createDialog('Resolve sync conflict', 'Both this device and GitHub changed the same lines. Choose what to save.');
    const actions = element('div', undefined, 'dialog-actions wrap');
    let chosen = false;
    for (const [label, value] of [['Keep mine', 'mine'], ['Keep remote', 'remote'], ['Keep both (append)', 'both']] as const) {
      actions.append(button(label, () => { chosen = true; dialog.close(); resolve(value); }, { className: 'button secondary' }));
    }
    dialog.addEventListener('close', () => { if (!chosen) resolve('cancel'); }, { once: true });
    body.append(actions);
    actions.querySelector<HTMLButtonElement>("button")?.focus();
  });
}

function fileId(path: string): string {
  return path.split('/').pop()?.replace(/\.txt$/, '') ?? 'todo list';
}

async function flushAll(refreshIfClean = false): Promise<void> {
  for (const timer of saveTimers.values()) window.clearTimeout(timer);
  saveTimers.clear();
  const dirty = lists.filter((record) => record.dirty);
  if (!dirty.length) {
    if (refreshIfClean) await refresh().catch(showError);
    return;
  }
  await Promise.all(dirty.map((record) => saveRecord(record)));
}

function showError(error: unknown): void {
  if (error instanceof GitHubError) {
    if (error.status === 401) {
      expireSession();
      return;
    }
    toast(error.message);
    if (error.status === 0) setStatus('Offline', 'offline');
    else if (error.status === 403 || error.status === 429) setStatus(error.message, 'error');
    return;
  }
  toast(error instanceof Error ? error.message : 'An unexpected error occurred.');
}

async function refresh(): Promise<void> {
  if (!client || !credentials) return;
  if (!navigator.onLine) {
    setStatus('Offline', 'offline');
    return;
  }
  try {
    const files = await client.listFiles();
    const cachedByPath = new Map(lists.map((item) => [item.path, item]));
    const records: CachedList[] = [];
    for (let start = 0; start < files.length; start += 4) {
      const batch = files.slice(start, start + 4);
      const results = await Promise.all(batch.map(async (file) => {
        const cached = cachedByPath.get(file.path);
        if (cached?.deleted) return cached;
        if (cached?.dirty) return cached;
        try {
          const remote = await client!.getFile(file.path, false, cached
            ? { content: cached.content, sha: cached.sha ?? '', etag: cached.etag }
            : undefined);
          const latest = lists.find((record) => record.path === file.path);
          if (latest?.dirty) return latest;
          return { path: file.path, content: remote.content, baseContent: remote.content, sha: remote.sha, etag: remote.etag, modifiedAt: cached?.modifiedAt ?? Date.now() };
        } catch (error) {
          if (error instanceof GitHubError && error.status === 304 && cached) return cached;
          throw error;
        }
      }));
      records.push(...results);
    }
    const remotePaths = new Set(records.map((record) => record.path));
    records.push(...lists.filter((record) => record.dirty && !record.deleted && !remotePaths.has(record.path)));
    lists = records;
    applyHashRoute();
    persistCache();
    setStatus(lists.some((record) => record.dirty) ? 'Unsaved changes' : 'Saved ✓', lists.some((record) => record.dirty) ? 'unsaved' : 'saved');
    render();
    if (lists.some((record) => record.dirty)) void flushAll();
  } catch (error) {
    if (error instanceof GitHubError && error.status === 401) {
      showError(error);
      return;
    }
    if (error instanceof GitHubError && error.status === 0) setStatus('Offline', 'offline');
    else setStatus('Error · click to retry', 'error');
    showError(error);
  }
}

function slug(title: string): string {
  const base = title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
  const suffix = crypto.getRandomValues(new Uint8Array(2));
  return `${base}-${Array.from(suffix, (value) => value.toString(16).padStart(2, '0')).join('').slice(0, 4)}`;
}

async function createList(): Promise<void> {
  const title = await askText('New list title');
  if (!title || !credentials) return;
  const path = `lists/${slug(title)}.txt`;
  const parsed: ParsedList = { title, lines: [], trailingNewline: true };
  const record: CachedList = { path, content: serializeList(parsed), baseContent: '', modifiedAt: Date.now(), dirty: true };
  lists.unshift(record);
  currentPath = path;
  selected = 0;
  persistCache();
  render();
  scheduleSave(record);
}

async function renameList(record: CachedList): Promise<void> {
  const parsed = readList(record);
  const title = await askText('Rename list', parsed.title);
  if (!title || title === parsed.title) return;
  mutate((value) => { value.title = title; }, { record });
}

async function deleteList(record: CachedList): Promise<void> {
  const title = readList(record).title;
  if (!await confirmAction('Delete list?', `Delete “${title}” and its file from the private repository?`)) return;
  const wasDirty = Boolean(record.dirty);
  record.deleted = true;
  record.dirty = true;
  if (currentPath === record.path) currentPath = undefined;
  selected = 0;
  persistCache();
  render();
  toast(`Deleted “${title}”.`, 'Undo', () => {
    record.deleted = false;
    record.dirty = true;
    lists.unshift(record);
    persistCache();
    render();
    if (!wasDirty) scheduleSave(record);
  });
  if (navigator.onLine) scheduleSave(record);
}

function showListMenu(record: CachedList): void {
  const { body } = createDialog(readList(record).title, 'List actions');
  body.append(
    button('Rename list', () => { document.querySelector<HTMLDialogElement>("dialog[open]")?.close(); void renameList(record); }),
    button('Share list', () => { closeDialog(); currentPath = record.path; render(); showShare(); }),
    button('Delete list', () => { document.querySelector<HTMLDialogElement>("dialog[open]")?.close(); void deleteList(record); }, { className: 'button danger' }),
    button('Close', () => document.querySelector<HTMLDialogElement>("dialog[open]")?.close(), { className: 'button secondary' }),
  );
}

function showTodoMenu(sourceIndex: number): void {
  const { body } = createDialog('Todo actions');
  body.append(
    button('Move up', () => { closeDialog(); moveTodo(sourceIndex, -1); }),
    button('Move down', () => { closeDialog(); moveTodo(sourceIndex, 1); }),
    button('Copy todo text', () => { closeDialog(); void copyText(lineTodo(sourceIndex)?.text ?? ''); }),
    button('Delete todo', () => { closeDialog(); deleteTodo(sourceIndex); }, { className: 'button danger' }),
    button('Close', closeDialog, { className: 'button secondary' }),
  );
}

function closeDialog(): void {
  document.querySelector<HTMLDialogElement>("dialog[open]")?.close();
}

function lineTodo(sourceIndex: number): Todo | undefined {
  const line = activeList() && readList(activeList()!).lines[sourceIndex];
  return line?.kind === 'todo' ? line.todo : undefined;
}

function addTodo(sourceIndex?: number, text = '', before = false): void {
  const record = activeList();
  if (!record) return;
  filterText = '';
  const parsed = readList(record);
  const insertAt = sourceIndex === undefined
    ? parsed.lines.length
    : Math.max(0, Math.min(parsed.lines.length, sourceIndex + (before ? 0 : 1)));
  mutate((value) => {
    const todo: Todo = { id: `new-${Date.now()}`, text, done: false, pinned: false };
    value.lines.splice(insertAt, 0, { kind: 'todo', todo });
  });
  const updated = readList(record);
  editSourceIndex = insertAt;
  draftRecorded = false;
  selected = visibleLines(updated).findIndex((item) => item.sourceIndex === insertAt);
  mode = 'EDIT';
  render();
}

function startEdit(sourceIndex: number): void {
  const line = activeList() && readList(activeList()!).lines[sourceIndex];
  if (!line || line.kind !== 'todo') return;
  editSourceIndex = sourceIndex;
  draftRecorded = false;
  mode = 'EDIT';
  render();
}

function commitEdit(sourceIndex: number, value: string, addBelow: boolean): void {
  const record = activeList();
  if (!record) return;
  const parsed = readList(record);
  const target = parsed.lines[sourceIndex];
  if (!target || target.kind !== 'todo') {
    editSourceIndex = undefined;
    mode = 'NAV';
    render();
    return;
  }
  const removeEmpty = !value.trim() && !addBelow;
  const changed = target.todo.text !== value || removeEmpty;
  const originalContent = record.content;
  editSourceIndex = undefined;
  mode = 'NAV';
  if (changed) {
    if (!draftRecorded) historyFor(record).push(originalContent);
    if (removeEmpty) parsed.lines.splice(sourceIndex, 1);
    else target.todo.text = value;
    record.content = serializeList(parsed);
    record.dirty = true;
    record.modifiedAt = Date.now();
    selected = Math.max(0, Math.min(selected, visibleLines(parsed).length - 1));
    persistCache();
    setStatus('Unsaved changes', 'unsaved');
    scheduleSave(record);
    render();
  }
  draftRecorded = false;
  if (addBelow) {
    addTodo(sourceIndex, '');
  } else if (!changed) render();
}

function updateDraft(sourceIndex: number, value: string): void {
  const record = activeList();
  if (!record) return;
  const parsed = readList(record);
  const line = parsed.lines[sourceIndex];
  if (!line || line.kind !== 'todo' || line.todo.text === value) return;
  if (!draftRecorded) {
    historyFor(record).push(record.content);
    draftRecorded = true;
  }
  line.todo.text = value;
  record.content = serializeList(parsed);
  record.dirty = true;
  record.modifiedAt = Date.now();
  persistCache();
  scheduleSave(record);
}

function handleEditKey(event: KeyboardEvent, sourceIndex: number, value: string): void {
  if (matchesBinding(event, 'edit-next')) {
    event.preventDefault();
    commitEdit(sourceIndex, value, true);
  } else if (matchesBinding(event, 'edit-exit')) {
    event.preventDefault();
    commitEdit(sourceIndex, value, false);
  } else if (matchesBinding(event, 'edit-delete-empty') && !value) {
    event.preventDefault();
    commitEdit(sourceIndex, '', false);
    selected = Math.max(0, selected - 1);
    const previousIndex = currentTodoSourceIndex();
    if (previousIndex !== undefined) startEdit(previousIndex);
  } else if (matchesBinding(event, 'edit-prev') || matchesBinding(event, 'edit-next-item')) {
    event.preventDefault();
    commitEdit(sourceIndex, value, false);
    const step = matchesBinding(event, 'edit-prev') ? -1 : 1;
    selected = Math.max(0, Math.min(visibleLines(readList(activeList()!)).length - 1, selected + step));
    const nextIndex = currentTodoSourceIndex();
    if (nextIndex !== undefined) startEdit(nextIndex);
  } else if (matchesBinding(event, 'edit-toggle')) {
    event.preventDefault();
    const line = activeList() && readList(activeList()!).lines[sourceIndex];
    if (line?.kind === 'todo') mutate((parsed) => {
      const target = parsed.lines[sourceIndex];
      if (target.kind === 'todo') target.todo.done = !target.todo.done;
    });
  } else if (matchesBinding(event, 'edit-pin')) {
    event.preventDefault();
    mutate((parsed) => {
      const target = parsed.lines[sourceIndex];
      if (target?.kind === 'todo') target.todo.pinned = !target.todo.pinned;
    }, { selection: (parsed) => visibleLines(parsed).findIndex((item) => item.sourceIndex === sourceIndex) });
  } else if (matchesBinding(event, 'edit-move-up') || matchesBinding(event, 'edit-move-down')) {
    event.preventDefault();
    commitEdit(sourceIndex, value, false);
    moveTodo(sourceIndex, matchesBinding(event, 'edit-move-up') ? -1 : 1);
    const nextIndex = currentTodoSourceIndex();
    if (nextIndex !== undefined) startEdit(nextIndex);
  }
}

function pasteTodos(sourceIndex: number, input: HTMLInputElement, pasted: string): void {
  const items = pasted.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.replace(/^\s*[-*]\s+\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
  const before = input.value.slice(0, input.selectionStart ?? input.value.length);
  const after = input.value.slice(input.selectionEnd ?? input.value.length);
  if (items.length < 2) {
    updateDraft(sourceIndex, `${before}${items[0] ?? ''}${after}`);
    return;
  }
  editSourceIndex = undefined;
  mutate((parsed) => {
    const current = parsed.lines[sourceIndex];
    if (!current || current.kind !== 'todo') return;
    current.todo.text = `${before}${items[0]}`;
    const inserted: ListLine[] = items.slice(1).map((text) => ({
      kind: 'todo',
      todo: { id: `paste-${crypto.randomUUID()}`, text, done: false, pinned: false },
    }));
    const last = inserted[inserted.length - 1];
    if (last?.kind === 'todo') last.todo.text += after;
    parsed.lines.splice(sourceIndex + 1, 0, ...inserted);
  });
  editSourceIndex = sourceIndex + items.length - 1;
  draftRecorded = false;
  const visibleIndex = visibleLines(readList(activeList()!)).findIndex((item) => item.sourceIndex === editSourceIndex);
  if (visibleIndex >= 0) selected = visibleIndex;
  mode = 'EDIT';
  render();
}

function deleteTodo(sourceIndex: number): void {
  const record = activeList();
  if (!record) return;
  const parsed = readList(record);
  const line = parsed.lines[sourceIndex];
  if (!line || line.kind !== 'todo') return;
  mutate((value) => { value.lines.splice(sourceIndex, 1); }, { selection: Math.max(0, selected - 1) });
  toast('Todo deleted.', 'Undo', undo);
}

function moveTodo(sourceIndex: number, direction: -1 | 1): void {
  const record = activeList();
  if (!record) return;
  const parsed = readList(record);
  if (parsed.lines[sourceIndex]?.kind !== 'todo') return;
  const targetIndex = sourceIndex + direction;
  if (targetIndex < 0 || targetIndex >= parsed.lines.length) return;
  mutate((value) => {
    const [line] = value.lines.splice(sourceIndex, 1);
    value.lines.splice(targetIndex, 0, line);
  }, { selection: (value) => visibleLines(value).findIndex((item) => item.sourceIndex === targetIndex) });
}

function undo(): void {
  const record = activeList();
  if (!record) return;
  const content = historyFor(record).undo(record.content);
  if (content === undefined) return toast('Nothing to undo.');
  record.content = content;
  record.dirty = true;
  record.modifiedAt = Date.now();
  editSourceIndex = undefined;
  draftRecorded = false;
  mode = 'NAV';
  persistCache();
  render();
  scheduleSave(record);
}

function redo(): void {
  const record = activeList();
  if (!record) return;
  const content = historyFor(record).redo(record.content);
  if (content === undefined) return toast('Nothing to redo.');
  record.content = content;
  record.dirty = true;
  record.modifiedAt = Date.now();
  editSourceIndex = undefined;
  draftRecorded = false;
  mode = 'NAV';
  persistCache();
  render();
  scheduleSave(record);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard.');
  } catch {
    toast('Clipboard access was denied. Use the download option instead.');
  }
}

function showShare(): void {
  const record = activeList();
  if (!record) return;
  const text = shareText(readList(record));
  const { dialog, body } = createDialog('Share plain text');
  const preview = element('pre', text, 'share-preview');
  body.append(preview);
  const copy = () => { dialog.close(); void copyText(text); };
  const download = () => { dialog.close(); downloadText(record.path, text); };
  const nativeShare = () => { dialog.close(); void shareNative(record, text); };
  body.append(button('Copy to clipboard', copy, { className: 'button primary' }));
  body.append(button('Download .txt', download));
  if (typeof navigator.share === 'function') body.append(button('Share…', nativeShare));
  body.append(button('Close', closeDialog, { className: 'button secondary' }));
  dialog.addEventListener('keydown', (event) => {
    const binding = bindings.find((item) => item.scope === 'share' && item.codes.includes(tokenFor(event)));
    if (!binding) return;
    event.preventDefault();
    if (binding.id === 'share-copy') copy();
    else if (binding.id === 'share-download') download();
    else nativeShare();
  });
}

function downloadText(path: string, text: string): void {
  const link = element('a');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  link.href = url;
  link.download = `${fileId(path)}.txt`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareNative(record: CachedList, text: string): Promise<void> {
  if (typeof navigator.share !== 'function') {
    toast('Native sharing is not available in this browser.');
    return;
  }
  try {
    await navigator.share({ title: readList(record).title, text });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    showError(error);
  }
}

function showMenu(): void {
  const { body } = createDialog('Menu', 'Commands and account');
  body.append(
    button('Keyboard shortcuts', () => { closeDialog(); showHelp(); }),
    button('Command palette', () => { closeDialog(); showPalette(); }),
    button('Search', () => { closeDialog(); focusSearch(); }),
    button('Undo', () => { closeDialog(); undo(); }),
    button('Redo', () => { closeDialog(); redo(); }),
    button('Hide/show completed', () => { closeDialog(); hideCompleted = !hideCompleted; render(); }),
    button('Toggle light/dark theme', toggleTheme),
    button('Refresh from GitHub', () => { closeDialog(); void refresh(); }),
    button('Log out', () => { closeDialog(); void logout(); }, { className: 'button danger' }),
    button('Close', closeDialog, { className: 'button secondary' }),
  );
}

function showToastMessage(message: string): void {
  toast(message);
}

function focusSearch(): void {
  root.querySelector<HTMLInputElement>('input[type=search]')?.focus();
}

function toggleTheme(): void {
  const root = document.documentElement;
  const current = root.classList.contains('light-theme')
    ? 'light'
    : root.classList.contains('dark-theme')
      ? 'dark'
      : window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  root.classList.toggle('light-theme', next === 'light');
  root.classList.toggle('dark-theme', next === 'dark');
  localStorage.setItem('private-todos-theme', next);
}

function goBack(): void {
  if (currentPath) {
    currentPath = undefined;
    selected = 0;
    filterText = '';
    editSourceIndex = undefined;
    mode = 'NAV';
    render();
  }
}

function tokenFor(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.metaKey) parts.push('meta');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && event.key.length === 1 && event.key.toLowerCase() !== event.key) parts.push('shift');
  const key = event.key.toLowerCase();
  parts.push(key);
  return parts.join('+');
}

function matchesBinding(event: KeyboardEvent, id: string): boolean {
  const binding = bindings.find((item) => item.id === id);
  return Boolean(binding?.codes.includes(tokenFor(event)));
}

function selectedList(): CachedList | undefined {
  return sortedLists()[listIndexForSelection()];
}

function openPaletteAction(id: string): void {
  const record = activeList();
  const sourceIndex = currentTodoSourceIndex();
  switch (id) {
    case 'new-list': void createList(); break;
    case 'new-below': addTodo(sourceIndex); break;
    case 'open': if (!currentPath && selectedList()) { selected = 0; currentPath = selectedList()!.path; render(); } break;
    case 'help': showHelp(); break;
    case 'palette': showPalette(); break;
    case 'save': void flushAll(true); break;
    case 'share-list': dispatchAction('share-list'); break;
    case 'share-menu': showShare(); break;
    case 'refresh': void refresh(); break;
    case 'logout': void logout(); break;
    case 'filter': focusSearch(); break;
    default: dispatchAction(id);
  }
  void record;
}

function showPalette(): void {
  const { dialog, body } = createDialog('Command palette', 'Search commands and lists.');
  const input = element('input');
  input.type = 'search';
  input.placeholder = 'Type a command or list name…';
  input.setAttribute('aria-label', 'Command palette search');
  const results = element('div', undefined, 'palette-results');
  const update = () => {
    results.replaceChildren();
    const query = input.value.trim().toLowerCase();
    const actionRows = bindings.filter((binding) => !['confirm', 'palette'].includes(binding.scope)
      && (!query || fuzzyMatch(query, `${binding.label} ${binding.keys}`)));
    for (const binding of actionRows) {
      const row = button('', () => { dialog.close(); openPaletteAction(binding.id); }, { className: 'palette-option' });
      row.append(element('span', binding.label), element('kbd', binding.keys));
      results.append(row);
    }
    for (const record of sortedLists().filter((item) => !query || fuzzyMatch(query, readList(item).title))) {
      results.append(button(readList(record).title, () => {
        dialog.close();
        selected = 0;
        currentPath = record.path;
        render();
      }, { className: 'palette-option' }));
    }
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (matchesBinding(event, 'palette-next')) {
      event.preventDefault();
      results.querySelector<HTMLButtonElement>('button')?.focus();
    } else if (matchesBinding(event, 'palette-activate')) {
      event.preventDefault();
      results.querySelector<HTMLButtonElement>('button')?.click();
    }
  });
  results.addEventListener('keydown', (event) => {
    if (!matchesBinding(event, 'palette-next') && !matchesBinding(event, 'palette-prev')) return;
    event.preventDefault();
    const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>('button'));
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = matchesBinding(event, 'palette-next')
      ? Math.min(current + 1, buttons.length - 1)
      : Math.max(0, current - 1);
    buttons[next]?.focus();
  });
  body.append(input, results);
  update();
  input.focus();
}

function fuzzyMatch(query: string, candidate: string): boolean {
  const text = candidate.toLowerCase();
  let index = 0;
  for (const character of query.toLowerCase()) {
    index = text.indexOf(character, index);
    if (index < 0) return false;
    index++;
  }
  return true;
}

async function logout(): Promise<void> {
  if (!await confirmAction('Log out?', 'This clears the saved token and cached lists on this device.')) return;
  if (credentials) clearCache(credentials);
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('private-todos-cache:')) localStorage.removeItem(key);
  }
  histories.clear();
  clearCredentials();
  credentials = undefined;
  client = undefined;
  lists = [];
  currentPath = undefined;
  root.replaceChildren();
  renderLogin();
}

function dispatchAction(id: string): void {
  const record = activeList();
  const sourceIndex = currentTodoSourceIndex();
  switch (id) {
    case 'move-next':
    case 'move-down':
      if (currentPath) moveTodo(sourceIndex ?? 0, 1);
      else { selected = Math.min(selected + 1, Math.max(0, sortedLists().length - 1)); render(); }
      break;
    case 'move-prev':
    case 'move-up':
      if (currentPath) moveTodo(sourceIndex ?? 0, -1);
      else { selected = Math.max(0, selected - 1); render(); }
      break;
    case 'select-next': selected = Math.min(selected + 1, Math.max(0, visibleLines(readList(record!)).length - 1)); render(); break;
    case 'select-prev': selected = Math.max(0, selected - 1); render(); break;
    case 'first': selected = 0; render(); break;
    case 'first-todo': selected = 0; render(); break;
    case 'last':
    case 'last-todo': selected = Math.max(0, currentPath ? visibleLines(readList(record!)).length - 1 : sortedLists().length - 1); render(); break;
    case 'jump-list':
      void askText('Jump to list number (1–9)').then((value) => {
        const index = Number(value) - 1;
        if (value && Number.isInteger(index) && index >= 0 && index < sortedLists().length) {
          selected = index;
          render();
        }
      });
      break;
    case 'open': {
      const list = selectedList();
      if (list) { currentPath = list.path; filterText = ''; selected = 0; render(); }
      break;
    }
    case 'new-list': void createList(); break;
    case 'rename-list': {
      if (record) void renameList(record);
      else if (selectedList()) void renameList(selectedList()!);
      break;
    }
    case 'delete': {
      if (record && sourceIndex !== undefined) deleteTodo(sourceIndex);
      else if (selectedList()) void deleteList(selectedList()!);
      break;
    }
    case 'delete-todo': if (sourceIndex !== undefined) deleteTodo(sourceIndex); break;
    case 'filter': focusSearch(); break;
    case 'filter-todos': focusSearch(); break;
    case 'rename-current': if (record) void renameList(record); break;
    case 'sort': sortMode = sortMode === 'recent' ? 'alpha' : 'recent'; render(); break;
    case 'refresh': void refresh(); break;
    case 'toggle': if (record && sourceIndex !== undefined) mutate((parsed) => { const line = parsed.lines[sourceIndex]; if (line?.kind === 'todo') line.todo.done = !line.todo.done; }); break;
    case 'pin': if (record && sourceIndex !== undefined) mutate((parsed) => {
      const line = parsed.lines[sourceIndex];
      if (line?.kind === 'todo') line.todo.pinned = !line.todo.pinned;
    }, { selection: (parsed) => visibleLines(parsed).findIndex((item) => item.sourceIndex === sourceIndex) }); break;
    case 'edit': if (sourceIndex !== undefined) startEdit(sourceIndex); break;
    case 'edit-next':
    case 'edit-exit': {
      const input = root.querySelector<HTMLInputElement>('.todo-edit');
      if (sourceIndex !== undefined && input) commitEdit(sourceIndex, input.value, id === 'edit-next');
      break;
    }
    case 'edit-delete-empty': {
      const input = root.querySelector<HTMLInputElement>('.todo-edit');
      if (sourceIndex !== undefined && input?.value === '') commitEdit(sourceIndex, '', false);
      break;
    }
    case 'edit-prev':
    case 'edit-next-item': {
      const input = root.querySelector<HTMLInputElement>('.todo-edit');
      if (sourceIndex === undefined || !input) break;
      commitEdit(sourceIndex, input.value, false);
      selected = Math.max(0, Math.min(visibleLines(readList(activeList()!)).length - 1, selected + (id === 'edit-prev' ? -1 : 1)));
      const nextIndex = currentTodoSourceIndex();
      if (nextIndex !== undefined) startEdit(nextIndex);
      break;
    }
    case 'edit-toggle': dispatchAction('toggle'); break;
    case 'edit-pin': dispatchAction('pin'); break;
    case 'edit-move-up': if (sourceIndex !== undefined) moveTodo(sourceIndex, -1); break;
    case 'edit-move-down': if (sourceIndex !== undefined) moveTodo(sourceIndex, 1); break;
    case 'new-below': addTodo(sourceIndex); break;
    case 'new-above': addTodo(sourceIndex ?? 0, '', true); break;
    case 'add-end': addTodo(); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'share-one': if (sourceIndex !== undefined) void copyText(lineTodo(sourceIndex)?.text ?? ''); break;
    case 'share-list': if (record) void copyText(shareText(readList(record))); break;
    case 'share-copy': if (record) void copyText(shareText(readList(record))); break;
    case 'share-download': if (record) downloadText(record.path, shareText(readList(record))); break;
    case 'share-native': if (record) void shareNative(record, shareText(readList(record))); break;
    case 'hide-done': hideCompleted = !hideCompleted; render(); break;
    case 'back': goBack(); break;
    case 'previous-list':
    case 'next-list': {
      const all = sortedLists();
      if (all.length) {
        const current = all.findIndex((item) => item.path === currentPath);
        const offset = id === 'previous-list' ? -1 : 1;
        currentPath = all[(current + offset + all.length) % all.length].path;
        selected = 0;
        render();
      }
      break;
    }
    case 'theme': toggleTheme(); break;
    case 'save': void flushAll(true); break;
    case 'help': showHelp(); break;
    case 'palette': showPalette(); break;
    case 'escape':
      if (document.querySelector('dialog[open]')) closeDialog();
      else if (mode === 'EDIT') {
        const input = root.querySelector<HTMLInputElement>('.todo-edit');
        if (input) input.blur();
        else { mode = 'NAV'; editSourceIndex = undefined; render(); }
      } else goBack();
      break;
    case 'logout': void logout(); break;
  }
}

function handleKeys(event: KeyboardEvent): void {
  if (event.isComposing) return;
  const target = event.target as HTMLElement;
  const isField = target.matches('input, textarea, select') || Boolean(target.closest('dialog'));
  if (isField) {
    const fieldToken = tokenFor(event);
    const fieldGlobal = credentials && (event.ctrlKey || event.metaKey)
      ? bindings.find((binding) => binding.scope === 'global'
        && binding.codes.includes(fieldToken)
        && ['save', 'undo', 'redo', 'palette'].includes(binding.id)
        && (!['undo', 'redo'].includes(binding.id) || target.matches('.todo-edit'))
        && (binding.id !== 'palette' || !target.closest('dialog')))
      : undefined;
    if (fieldGlobal) {
      event.preventDefault();
      dispatchAction(fieldGlobal.id);
      return;
    }
    if (matchesBinding(event, 'escape') && target.matches('input[type=search]') && !target.closest('dialog')) {
      event.preventDefault();
      (target as HTMLInputElement).value = '';
      if (currentPath) filterText = ''; else listFilter = '';
      render();
    }
    return;
  }
  const token = tokenFor(event);
  if (target.matches('button, a, summary')
    && bindings.some((binding) => ['open', 'toggle'].includes(binding.id) && binding.codes.includes(token))) return;
  const global = bindings.find((binding) => binding.scope === 'global'
    && binding.codes.includes(token)
    && (mode === 'NAV' || event.ctrlKey || event.metaKey || binding.id === 'logout'));
  if (global) {
    event.preventDefault();
    dispatchAction(global.id);
    return;
  }
  if (mode === 'EDIT') return;
  const scope = currentPath ? 'list' : 'lists';
  const sequences = bindings
    .filter((binding) => binding.scope === scope && binding.sequence)
    .map((binding) => binding.sequence!);
  const sequenceResult = matchSequence(token, pendingKeys, sequences);
  if (sequenceResult.matched) {
    event.preventDefault();
    pendingKeys = '';
    if (pendingTimer) window.clearTimeout(pendingTimer);
    const sequenceBinding = bindings.find((binding) => binding.scope === scope && binding.sequence === sequenceResult.matched);
    if (sequenceBinding) dispatchAction(sequenceBinding.id);
    setPendingIndicator();
    return;
  }
  if (sequenceResult.pending) {
    event.preventDefault();
    pendingKeys = sequenceResult.pending;
    setPendingIndicator();
    if (pendingTimer) window.clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => { pendingKeys = ''; setPendingIndicator(); }, sequenceResult.timeout);
    return;
  }
  pendingKeys = '';
  if (pendingTimer) window.clearTimeout(pendingTimer);
  const binding = bindings.find((item) => item.scope === scope && item.codes.includes(token));
  if (!binding) return;
  event.preventDefault();
  if (binding.id === 'jump-list') {
    selected = Number(token) - 1;
    render();
    return;
  }
  dispatchAction(binding.id);
}

function setPendingIndicator(): void {
  const indicator = document.querySelector<HTMLElement>('.pending-keys');
  if (indicator) indicator.textContent = pendingKeys ? `Keys: ${pendingKeys}_` : '';
}

document.addEventListener('keydown', handleKeys);
window.addEventListener('hashchange', () => {
  if (!credentials) return;
  applyHashRoute();
  render();
});
window.addEventListener('online', () => {
  setStatus('Saving…', 'saving');
  void flushAll();
});
window.addEventListener('offline', () => setStatus('Offline', 'offline'));
window.addEventListener('blur', () => { void flushAll(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void flushAll();
});
window.addEventListener('focus', () => {
  if (Date.now() - focusRefreshAt > 60_000 && client && mode !== 'EDIT') {
    focusRefreshAt = Date.now();
    void refresh();
  }
});
window.visualViewport?.addEventListener('resize', () => {
  document.documentElement.classList.toggle('keyboard-open', window.visualViewport!.height < window.innerHeight * 0.75);
});

const savedTheme = localStorage.getItem('private-todos-theme');
if (savedTheme === 'light') document.documentElement.classList.add('light-theme');
if (savedTheme === 'dark') document.documentElement.classList.add('dark-theme');
let authWarning = '';
try {
  credentials = loadCredentials();
} catch (error) {
  authWarning = error instanceof Error ? error.message : 'Saved sign-in details could not be read.';
}
if (credentials) {
  client = new GitHubClient(credentials);
  lists = restoreCache(credentials);
  applyHashRoute();
  render();
  notifyCacheWarning();
  void refresh();
} else {
  renderLogin(authWarning);
}
