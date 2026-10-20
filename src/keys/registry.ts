export interface Binding {
  id: string;
  keys: string;
  codes: string[];
  sequence?: string;
  label: string;
  scope: 'global' | 'lists' | 'list' | 'edit' | 'share' | 'confirm' | 'palette';
}

export const bindings: Binding[] = [
  { id: 'palette', keys: 'Ctrl/Cmd+K or :', codes: ['ctrl+k', 'meta+k', ':'], label: 'Open command palette', scope: 'global' },
  { id: 'save', keys: 'Ctrl/Cmd+S', codes: ['ctrl+s', 'meta+s'], label: 'Save and sync now', scope: 'global' },
  { id: 'help', keys: '?', codes: ['?'], label: 'Show keyboard help', scope: 'global' },
  { id: 'escape', keys: 'Esc', codes: ['escape'], label: 'Close, cancel, or go back', scope: 'global' },
  { id: 'logout', keys: 'Shift+L', codes: ['shift+l'], label: 'Log out', scope: 'global' },
  { id: 'move-next', keys: 'j / ↓', codes: ['j', 'arrowdown'], label: 'Move selection down', scope: 'lists' },
  { id: 'move-prev', keys: 'k / ↑', codes: ['k', 'arrowup'], label: 'Move selection up', scope: 'lists' },
  { id: 'first', keys: 'gg', codes: [], sequence: 'gg', label: 'Select first item', scope: 'lists' },
  { id: 'last', keys: 'G', codes: ['shift+g'], label: 'Select last item', scope: 'lists' },
  { id: 'open', keys: 'Enter / l / →', codes: ['enter', 'l', 'arrowright'], label: 'Open selected list', scope: 'lists' },
  { id: 'new-list', keys: 'n', codes: ['n'], label: 'Create list', scope: 'lists' },
  { id: 'rename-list', keys: 'r', codes: ['r'], label: 'Rename selected list', scope: 'lists' },
  { id: 'delete', keys: 'dd / Delete', codes: ['delete'], sequence: 'dd', label: 'Delete selected item', scope: 'lists' },
  { id: 'filter', keys: '/', codes: ['/'], label: 'Filter or search', scope: 'lists' },
  { id: 'sort', keys: 's', codes: ['s'], label: 'Toggle list sorting', scope: 'lists' },
  { id: 'refresh', keys: 'R', codes: ['shift+r'], label: 'Refresh from GitHub', scope: 'lists' },
  { id: 'jump-list', keys: '1–9', codes: ['1', '2', '3', '4', '5', '6', '7', '8', '9'], label: 'Jump to numbered list', scope: 'lists' },
  { id: 'select-next', keys: 'j / ↓', codes: ['j', 'arrowdown'], label: 'Move todo selection down', scope: 'list' },
  { id: 'select-prev', keys: 'k / ↑', codes: ['k', 'arrowup'], label: 'Move todo selection up', scope: 'list' },
  { id: 'first-todo', keys: 'gg', codes: [], sequence: 'gg', label: 'Select first todo', scope: 'list' },
  { id: 'last-todo', keys: 'G', codes: ['shift+g'], label: 'Select last todo', scope: 'list' },
  { id: 'delete-todo', keys: 'dd / Delete', codes: ['delete'], sequence: 'dd', label: 'Delete selected todo', scope: 'list' },
  { id: 'filter-todos', keys: '/', codes: ['/'], label: 'Filter todos', scope: 'list' },
  { id: 'rename-current', keys: 'r', codes: ['r'], label: 'Rename current list', scope: 'list' },
  { id: 'toggle', keys: 'Space / x', codes: [' ', 'x'], label: 'Toggle todo complete', scope: 'list' },
  { id: 'pin', keys: 'p', codes: ['p'], label: 'Pin or unpin todo', scope: 'list' },
  { id: 'edit', keys: 'i / Enter / e', codes: ['i', 'enter', 'e'], label: 'Edit selected todo', scope: 'list' },
  { id: 'new-below', keys: 'o', codes: ['o'], label: 'Add todo below', scope: 'list' },
  { id: 'new-above', keys: 'O', codes: ['shift+o'], label: 'Add todo above', scope: 'list' },
  { id: 'add-end', keys: 'a', codes: ['a'], label: 'Add todo at end', scope: 'list' },
  { id: 'move-down', keys: 'J / Alt+↓', codes: ['shift+j', 'alt+arrowdown'], label: 'Move todo down', scope: 'list' },
  { id: 'move-up', keys: 'K / Alt+↑', codes: ['shift+k', 'alt+arrowup'], label: 'Move todo up', scope: 'list' },
  { id: 'undo', keys: 'u / Ctrl/Cmd+Z', codes: ['u', 'ctrl+z', 'meta+z'], label: 'Undo', scope: 'global' },
  { id: 'redo', keys: 'Ctrl/Cmd+Shift+Z', codes: ['ctrl+shift+z', 'meta+shift+z'], label: 'Redo', scope: 'global' },
  { id: 'share-one', keys: 'yy', codes: [], sequence: 'yy', label: 'Copy selected todo', scope: 'list' },
  { id: 'share-list', keys: 'Y', codes: ['shift+y'], label: 'Copy whole list as plain text', scope: 'list' },
  { id: 'share-menu', keys: 'm', codes: ['m'], label: 'Open share options', scope: 'list' },
  { id: 'hide-done', keys: 'H', codes: ['shift+h'], label: 'Hide or show completed', scope: 'list' },
  { id: 'back', keys: 'h / Backspace', codes: ['h', 'backspace'], label: 'Back to lists', scope: 'list' },
  { id: 'previous-list', keys: '[', codes: ['['], label: 'Open previous list', scope: 'list' },
  { id: 'next-list', keys: ']', codes: [']'], label: 'Open next list', scope: 'list' },
  { id: 'theme', keys: 't', codes: ['t'], label: 'Toggle theme', scope: 'global' },
  { id: 'edit-next', keys: 'Enter', codes: ['enter'], label: 'Save and add todo below', scope: 'edit' },
  { id: 'edit-exit', keys: 'Esc', codes: ['escape'], label: 'Save and leave edit mode', scope: 'edit' },
  { id: 'edit-delete-empty', keys: 'Backspace on empty', codes: ['backspace'], label: 'Remove empty todo', scope: 'edit' },
  { id: 'edit-prev', keys: '↑', codes: ['arrowup'], label: 'Save and edit previous todo', scope: 'edit' },
  { id: 'edit-next-item', keys: '↓', codes: ['arrowdown'], label: 'Save and edit next todo', scope: 'edit' },
  { id: 'edit-toggle', keys: 'Ctrl/Cmd+Enter', codes: ['ctrl+enter', 'meta+enter'], label: 'Toggle completion', scope: 'edit' },
  { id: 'edit-pin', keys: 'Alt+P', codes: ['alt+p'], label: 'Pin or unpin todo', scope: 'edit' },
  { id: 'edit-move-up', keys: 'Alt+↑', codes: ['alt+arrowup'], label: 'Move todo up', scope: 'edit' },
  { id: 'edit-move-down', keys: 'Alt+↓', codes: ['alt+arrowdown'], label: 'Move todo down', scope: 'edit' },
  { id: 'share-copy', keys: 'c', codes: ['c'], label: 'Copy share text', scope: 'share' },
  { id: 'share-download', keys: 'd', codes: ['d'], label: 'Download share text', scope: 'share' },
  { id: 'share-native', keys: 'n', codes: ['n'], label: 'Use native sharing when available', scope: 'share' },
  { id: 'confirm-yes', keys: 'y', codes: ['y'], label: 'Confirm action', scope: 'confirm' },
  { id: 'confirm-no', keys: 'n', codes: ['n'], label: 'Cancel action', scope: 'confirm' },
  { id: 'palette-next', keys: '↓', codes: ['arrowdown'], label: 'Move to next palette result', scope: 'palette' },
  { id: 'palette-prev', keys: '↑', codes: ['arrowup'], label: 'Move to previous palette result', scope: 'palette' },
  { id: 'palette-activate', keys: 'Enter', codes: ['enter'], label: 'Run selected palette result', scope: 'palette' },
];

export function matchSequence(key: string, pending: string, sequences: string[], timeout = 800): {
  matched?: string;
  pending: string;
  timeout: number;
} {
  const candidate = `${pending}${key}`;
  const matched = sequences.find((sequence) => sequence === candidate);
  const stillPending = sequences.some((sequence) => sequence.startsWith(candidate) && sequence !== candidate);
  return { matched, pending: stillPending ? candidate : '', timeout };
}
