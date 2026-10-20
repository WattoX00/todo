const API_ROOT = "https://api.github.com";
const DATA_PATH = ".daymark/todos.json";
const TOKEN_KEY = "daymark.github.token";
const REPO_KEY = "daymark.github.repo";
const EMOJIS = ["✳", "☀", "🌱", "☕", "✦", "◒"];

const $ = (selector) => document.querySelector(selector);
const ui = {
  connectScreen: $("#connect-screen"),
  connectForm: $("#connect-form"),
  token: $("#github-token"),
  repo: $("#repo-name"),
  remember: $("#remember-token"),
  connectMessage: $("#connect-message"),
  workspace: $("#workspace"),
  listNav: $("#list-nav"),
  listGrid: $("#list-grid"),
  emptyLists: $("#empty-lists"),
  listsView: $("#lists-view"),
  tasksView: $("#tasks-view"),
  taskList: $("#task-list"),
  newTask: $("#new-task-input"),
  modalBackdrop: $("#modal-backdrop"),
  modal: $("#modal"),
  toast: $("#toast")
};

const state = {
  token: "",
  repo: "",
  owner: "",
  repository: "",
  username: "",
  data: { lists: [] },
  sha: null,
  activeListId: null,
  selectedTask: 0,
  pendingKey: "",
  toastTimer: null,
  writeQueue: Promise.resolve(),
  editingTaskId: null,
  searchQuery: ""
};

function repoParts(repo) {
  const parts = repo.trim().replace(/^https:\/\/github\.com\//i, "").replace(/\.git$/i, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1] || /[?#\s]/.test(parts.join(""))) {
    throw new Error("Enter a repository as owner/name, for example octocat/my-todos.");
  }
  return parts;
}

async function github(path, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    let message = `GitHub returned ${response.status}.`;
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch {
      // Keep the status-based error when GitHub does not return JSON.
    }
    if (response.status === 401) message = "That token is not valid. Check it and try again.";
    if (response.status === 403) message = "GitHub denied access. Check your token permissions and repository access.";
    if (response.status === 404) message = "Repository not found, or this token cannot access it.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function encodeContent(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value, null, 2));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeContent(content) {
  const binary = atob(content.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function loadData() {
  try {
    const file = await github(`/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repository)}/contents/${DATA_PATH}`);
    if (Array.isArray(file) || !file.content || !file.sha) throw new Error("The Daymark data file is not a valid JSON file.");
    const data = decodeContent(file.content);
    if (!data || !Array.isArray(data.lists)) throw new Error("The Daymark data file has an unsupported format.");
    state.data = data;
    state.sha = file.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
    state.data = { lists: [] };
    state.sha = null;
  }
}

function persistData(message = "Update todo lists") {
  const save = state.writeQueue.then(async () => {
    setSyncStatus("Saving…", "syncing");
    const body = {
      message: `${message} with Daymark`,
      content: encodeContent(state.data),
      ...(state.sha ? { sha: state.sha } : {})
    };
    const file = await github(`/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repository)}/contents/${DATA_PATH}`, {
      method: "PUT",
      body: JSON.stringify(body)
    });
    state.sha = file.content.sha;
    setSyncStatus("Synced with GitHub", "");
    render();
    return true;
  });
  state.writeQueue = save.catch((error) => {
    setSyncStatus("Sync failed", "error");
    showToast(`Could not save to GitHub: ${error.message}`, true);
    return false;
  });
  return state.writeQueue;
}

function setSyncStatus(label, status) {
  $("#sync-label").textContent = label;
  $("#saved-label").textContent = status === "syncing" ? "Saving changes…" : status === "error" ? "Could not sync" : "All changes saved";
  $("#sync-indicator").className = `sync-indicator ${status}`;
  $(".saved-dot").className = `saved-dot ${status}`;
}

function setConnectedScreen() {
  ui.connectScreen.classList.add("hidden");
  ui.workspace.classList.remove("hidden");
  $("#repo-label").textContent = state.repo;
  $("#top-repo-label").textContent = state.repo;
  $("#user-label").textContent = state.username;
  $("#user-avatar").textContent = (state.username[0] || "G").toUpperCase();
  render();
}

async function connect(token, repo, remember) {
  state.token = token.trim();
  [state.owner, state.repository] = repoParts(repo);
  state.repo = `${state.owner}/${state.repository}`;
  const user = await github("/user");
  state.username = user.login;
  await github(`/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repository)}`);
  await loadData();
  if (remember) {
    localStorage.setItem(TOKEN_KEY, state.token);
    localStorage.setItem(REPO_KEY, state.repo);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REPO_KEY);
  }
  setConnectedScreen();
  const sharedList = new URLSearchParams(location.search).get("list");
  const sharedRepo = new URLSearchParams(location.search).get("repo");
  if (sharedList && (!sharedRepo || sharedRepo.toLowerCase() === state.repo.toLowerCase()) && findList(sharedList)) openList(sharedList);
}

function findList(id) {
  return state.data.lists.find((list) => list.id === id);
}

function currentList() {
  return findList(state.activeListId);
}

function showToast(message, isError = false) {
  clearTimeout(state.toastTimer);
  ui.toast.textContent = message;
  ui.toast.className = `toast${isError ? " toast-error" : ""}`;
  state.toastTimer = setTimeout(() => ui.toast.classList.add("hidden"), 2800);
}

function render() {
  renderNavigation();
  renderLists();
  updateOverview();
  if (state.activeListId && currentList()) renderTasks();
}

function renderNavigation() {
  ui.listNav.replaceChildren();
  for (const list of state.data.lists) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `list-nav-item${state.activeListId === list.id ? " active" : ""}`;
    button.innerHTML = `<span class="nav-list-icon">${EMOJIS[list.emoji % EMOJIS.length]}</span><span class="nav-list-title"></span><span class="nav-list-count">${list.tasks.length}</span>`;
    button.querySelector(".nav-list-title").textContent = list.title;
    button.addEventListener("click", () => openList(list.id));
    ui.listNav.append(button);
  }
}

function renderLists() {
  ui.listGrid.replaceChildren();
  $("#list-count-label").textContent = `${state.data.lists.length} ${state.data.lists.length === 1 ? "list" : "lists"}`;
  ui.emptyLists.classList.toggle("hidden", state.data.lists.length !== 0);
  ui.listGrid.classList.toggle("hidden", state.data.lists.length === 0);
  for (const [index, list] of state.data.lists.entries()) {
    const done = list.tasks.filter((task) => task.completed).length;
    const card = document.createElement("article");
    card.className = "list-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${list.title}`);
    card.innerHTML = `<div class="list-card-top"><span class="list-emoji">${EMOJIS[list.emoji % EMOJIS.length]}</span><span class="list-card-menu">↗</span></div><h3></h3><div class="list-card-meta"><span class="list-card-count"></span><span class="mini-progress"><span></span></span></div>`;
    card.querySelector("h3").textContent = list.title;
    card.querySelector(".list-card-count").textContent = `${done} of ${list.tasks.length} done`;
    card.querySelector(".mini-progress span").style.width = `${list.tasks.length ? (done / list.tasks.length) * 100 : 0}%`;
    card.addEventListener("click", () => openList(list.id));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openList(list.id);
      }
    });
    ui.listGrid.append(card);
  }
  if (state.activeListId) $("#top-list-label").textContent = currentList()?.title || "All lists";
}

function updateOverview() {
  const tasks = state.data.lists.flatMap((list) => list.tasks);
  $("#total-tasks").textContent = tasks.filter((task) => !task.completed).length;
  $("#list-count").textContent = state.data.lists.length;
}

function openList(id) {
  if (!findList(id)) return;
  state.activeListId = id;
  state.selectedTask = 0;
  state.searchQuery = "";
  ui.listsView.classList.add("hidden");
  ui.tasksView.classList.remove("hidden");
  $("#top-list-label").textContent = currentList().title;
  render();
  closeMobileMenu();
}

function showAllLists() {
  state.activeListId = null;
  state.editingTaskId = null;
  ui.tasksView.classList.add("hidden");
  ui.listsView.classList.remove("hidden");
  $("#top-list-label").textContent = "All lists";
  render();
}

function renderTasks() {
  const list = currentList();
  if (!list) return;
  $("#task-list-title").textContent = list.title;
  $("#top-list-label").textContent = list.title;
  const done = list.tasks.filter((task) => task.completed).length;
  $("#task-progress").textContent = `${done} of ${list.tasks.length} done`;
  $("#progress-fill").style.width = `${list.tasks.length ? (done / list.tasks.length) * 100 : 0}%`;
  $("#task-count-footer").textContent = `${list.tasks.length} ${list.tasks.length === 1 ? "task" : "tasks"}`;
  ui.taskList.replaceChildren();
  if (list.tasks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "task-empty";
    empty.textContent = "A fresh page. Add the first thing on your mind.";
    ui.taskList.append(empty);
  }
  list.tasks.forEach((task, index) => {
    const row = document.createElement("div");
    row.className = `task-row${index === state.selectedTask ? " selected" : ""}${task.completed ? " completed" : ""}`;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", index === state.selectedTask ? "true" : "false");
    row.innerHTML = `<span class="task-check">${task.completed ? "✓" : ""}</span><span class="task-text"></span><span class="task-row-hint">↵ edit</span>`;
    row.querySelector(".task-text").textContent = task.text;
    row.addEventListener("click", () => {
      state.selectedTask = index;
      renderTasks();
    });
    row.addEventListener("dblclick", () => editTask(task));
    ui.taskList.append(row);
    if (state.editingTaskId === task.id) beginInlineEdit(row, task);
  });
  const selected = ui.taskList.children[state.selectedTask];
  if (selected && !state.editingTaskId) selected.scrollIntoView({ block: "nearest" });
}

function beginInlineEdit(row, task) {
  const text = row.querySelector(".task-text");
  const input = document.createElement("input");
  input.className = "task-edit-input";
  input.value = task.text;
  input.setAttribute("aria-label", "Edit task");
  text.replaceWith(input);
  row.querySelector(".task-row-hint").textContent = "↵ save · esc cancel";
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      saveTaskEdit(task.id, input.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      state.editingTaskId = null;
      renderTasks();
    }
  });
  input.addEventListener("blur", () => {
    if (state.editingTaskId === task.id) saveTaskEdit(task.id, input.value);
  });
  input.focus();
  input.select();
}

function saveTaskEdit(id, value) {
  const task = currentList()?.tasks.find((item) => item.id === id);
  state.editingTaskId = null;
  if (task && value.trim()) {
    task.text = value.trim();
    persistData("Edit task");
  }
  renderTasks();
}

function addTask(text, index = null) {
  const list = currentList();
  const cleanText = text.trim();
  if (!list || !cleanText) return;
  const task = { id: crypto.randomUUID(), text: cleanText, completed: false };
  if (index === null) list.tasks.push(task);
  else list.tasks.splice(index, 0, task);
  state.selectedTask = list.tasks.indexOf(task);
  persistData("Add task");
  renderTasks();
}

function editTask(task = currentList()?.tasks[state.selectedTask]) {
  if (!task) return;
  state.editingTaskId = task.id;
  state.selectedTask = currentList().tasks.indexOf(task);
  renderTasks();
}

function toggleTask() {
  const task = currentList()?.tasks[state.selectedTask];
  if (!task) return;
  task.completed = !task.completed;
  persistData(task.completed ? "Complete task" : "Reopen task");
  render();
}

function deleteSelectedTask() {
  const list = currentList();
  if (!list || !list.tasks[state.selectedTask]) return;
  const [removed] = list.tasks.splice(state.selectedTask, 1);
  state.selectedTask = Math.max(0, Math.min(state.selectedTask, list.tasks.length - 1));
  persistData("Delete task");
  renderTasks();
  showToast(`Removed “${removed.text}”`);
}

function openModal({ title, description = "", label = "", value = "", placeholder = "", submitText = "Save", destructiveAction = null, onSubmit }) {
  ui.modal.innerHTML = `<div class="modal-header"><h2 id="modal-title"></h2><button class="icon-button modal-close" type="button" aria-label="Close dialog">×</button></div><p class="modal-copy"></p><form><label for="modal-input"></label><input id="modal-input" type="text" maxlength="80" autocomplete="off"><p class="modal-error hidden" role="alert"></p><div class="modal-actions">${destructiveAction ? '<button class="button button-danger modal-danger" type="button"></button>' : ""}<span class="modal-action-spacer"></span><button class="button button-secondary modal-cancel" type="button">Cancel</button><button class="button button-primary modal-submit" type="submit"></button></div></form>`;
  $("#modal-title").textContent = title;
  $(".modal-copy").textContent = description;
  $(".modal-copy").classList.toggle("hidden", !description);
  const input = $("#modal-input");
  input.value = value;
  input.placeholder = placeholder;
  $("label[for='modal-input']").textContent = label;
  $("label[for='modal-input']").classList.toggle("hidden", !label);
  $(".modal-submit").textContent = submitText;
  if (destructiveAction) {
    $(".modal-danger").textContent = destructiveAction.label;
    $(".modal-danger").addEventListener("click", destructiveAction.onClick);
  }
  ui.modalBackdrop.classList.remove("hidden");
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal-cancel").addEventListener("click", closeModal);
  ui.modalBackdrop.addEventListener("click", modalBackdropClick);
  ui.modal.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $(".modal-error");
    try {
      const result = await onSubmit(input.value.trim());
      if (result !== false) closeModal();
    } catch (exception) {
      error.textContent = exception.message;
      error.classList.remove("hidden");
    }
  });
  input.focus();
}

function modalBackdropClick(event) {
  if (event.target === ui.modalBackdrop) closeModal();
}

function closeModal() {
  ui.modalBackdrop.classList.add("hidden");
  ui.modalBackdrop.removeEventListener("click", modalBackdropClick);
}

function createList() {
  openModal({
    title: "Give this list a name",
    description: "Big plans, tiny errands, that idea you keep forgetting. It all belongs here.",
    label: "List name",
    placeholder: "e.g. Weekend little wins",
    submitText: "Create list",
    onSubmit: async (title) => {
      if (!title) return false;
      if (state.data.lists.some((list) => list.title.toLowerCase() === title.toLowerCase())) throw new Error("You already have a list with that name.");
      const list = { id: crypto.randomUUID(), title, emoji: state.data.lists.length % EMOJIS.length, tasks: [] };
      state.data.lists.push(list);
      const saved = await persistData("Create list");
      if (!saved) {
        state.data.lists = state.data.lists.filter((item) => item.id !== list.id);
        render();
        return false;
      }
      openList(list.id);
    }
  });
}

function renameList() {
  const list = currentList();
  if (!list) return;
  openModal({
    title: "Rename your list",
    description: "A good name makes it easier to find your focus.",
    label: "List name",
    value: list.title,
    submitText: "Save name",
    destructiveAction: {
      label: "Delete list",
      onClick: async () => {
        if (!window.confirm(`Delete “${list.title}” and all its tasks? This cannot be undone.`)) return;
        const index = state.data.lists.indexOf(list);
        state.data.lists = state.data.lists.filter((item) => item.id !== list.id);
        state.activeListId = null;
        const saved = await persistData("Delete list");
        if (!saved) {
          state.data.lists.splice(index, 0, list);
          state.activeListId = list.id;
          render();
          return;
        }
        showAllLists();
        closeModal();
      }
    },
    onSubmit: async (title) => {
      if (!title) return false;
      if (title === list.title) return true;
      if (state.data.lists.some((item) => item.id !== list.id && item.title.toLowerCase() === title.toLowerCase())) throw new Error("You already have a list with that name.");
      const previousTitle = list.title;
      list.title = title;
      const saved = await persistData("Rename list");
      if (!saved) {
        list.title = previousTitle;
        render();
        return false;
      }
      render();
    }
  });
}

async function shareList() {
  const list = currentList();
  if (!list) return;
  const url = new URL(location.href);
  url.search = "";
  url.searchParams.set("repo", state.repo);
  url.searchParams.set("list", list.id);
  try {
    await navigator.clipboard.writeText(url.toString());
    showToast("List link copied. Recipients need access to this repo and their own token.");
  } catch {
    openModal({
      title: "Share this list",
      description: "Recipients need access to this GitHub repository and their own token to open this list.",
      label: "Share link",
      value: url.toString(),
      submitText: "Done",
      onSubmit: async () => true
    });
    $("#modal-input").readOnly = true;
    $("#modal-input").addEventListener("focus", (event) => event.target.select());
  }
}

function showHelp() {
  ui.modal.innerHTML = `<div class="modal-header"><h2 id="modal-title">Your keyboard, your flow.</h2><button class="icon-button modal-close" type="button" aria-label="Close dialog">×</button></div><p class="modal-copy">Vim-inspired shortcuts for moving through your list. Press <kbd>Esc</kbd> or <kbd>?</kbd> to close.</p><div class="help-list">${[
    ["j / ↓", "Move down"], ["k / ↑", "Move up"], ["gg", "Jump to the first task"], ["G", "Jump to the last task"], ["Enter", "Edit the selected task"], ["o", "Add a task below and edit it"], ["a", "Add a task at the end"], ["x", "Mark done / reopen"], ["dd", "Delete the selected task"], ["/", "Search tasks"], ["q", "Back to all lists"], ["?", "Show this help"]
  ].map(([key, description]) => `<div class="help-row"><kbd>${key}</kbd><span>${description}</span></div>`).join("")}</div><div class="modal-actions"><button class="button button-primary modal-close-action" type="button">Got it</button></div>`;
  ui.modalBackdrop.classList.remove("hidden");
  $(".modal-close").addEventListener("click", closeModal);
  $(".modal-close-action").addEventListener("click", closeModal);
  ui.modalBackdrop.addEventListener("click", modalBackdropClick);
}

function searchTasks() {
  openModal({
    title: "Find a task",
    description: "Search within this list.",
    label: "Search",
    placeholder: "Type to find a task",
    submitText: "Find",
    onSubmit: async (query) => {
      const list = currentList();
      const index = list.tasks.findIndex((task) => task.text.toLowerCase().includes(query.toLowerCase()));
      if (index < 0) throw new Error("No matching task in this list.");
      state.selectedTask = index;
      closeModal();
      renderTasks();
    }
  });
}

function handleEditorKeys(event) {
  if (!state.activeListId || !ui.modalBackdrop.classList.contains("hidden")) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  const list = currentList();
  if (!list) return;
  if (event.key === "?") {
    event.preventDefault();
    showHelp();
    return;
  }
  if (event.key === "Escape") {
    state.pendingKey = "";
    event.preventDefault();
    return;
  }
  if (event.key === "q") {
    showAllLists();
    return;
  }
  if (event.key === "j" || event.key === "ArrowDown") {
    event.preventDefault();
    state.pendingKey = "";
    state.selectedTask = Math.min(state.selectedTask + 1, Math.max(list.tasks.length - 1, 0));
    renderTasks();
    return;
  }
  if (event.key === "k" || event.key === "ArrowUp") {
    event.preventDefault();
    state.pendingKey = "";
    state.selectedTask = Math.max(0, state.selectedTask - 1);
    renderTasks();
    return;
  }
  if (event.key === "g") {
    event.preventDefault();
    if (state.pendingKey === "g") {
      state.selectedTask = 0;
      state.pendingKey = "";
      renderTasks();
    } else state.pendingKey = "g";
    return;
  }
  if (event.key === "G") {
    event.preventDefault();
    state.pendingKey = "";
    state.selectedTask = Math.max(0, list.tasks.length - 1);
    renderTasks();
    return;
  }
  if (event.key === "d") {
    event.preventDefault();
    if (state.pendingKey === "d") {
      state.pendingKey = "";
      deleteSelectedTask();
    } else state.pendingKey = "d";
    return;
  }
  state.pendingKey = "";
  if (event.key === "Enter") {
    event.preventDefault();
    editTask();
  } else if (event.key === "x") {
    toggleTask();
  } else if (event.key === "o") {
    event.preventDefault();
    addTask("New task", state.selectedTask + 1);
    editTask();
  } else if (event.key === "a") {
    ui.newTask.focus();
  } else if (event.key === "/") {
    event.preventDefault();
    searchTasks();
  }
}

function closeMobileMenu() {
  $("#sidebar").classList.remove("menu-open");
  $("#mobile-backdrop").classList.add("hidden");
}

ui.connectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  ui.connectMessage.textContent = "Connecting to GitHub…";
  const button = ui.connectForm.querySelector("button[type='submit']");
  button.disabled = true;
  try {
    await connect(ui.token.value, ui.repo.value, ui.remember.checked);
  } catch (error) {
    ui.connectMessage.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#show-token").addEventListener("click", () => {
  const visible = ui.token.type === "text";
  ui.token.type = visible ? "password" : "text";
  $("#show-token").textContent = visible ? "Show" : "Hide";
  $("#show-token").setAttribute("aria-label", visible ? "Show token" : "Hide token");
});

$("#new-list-button").addEventListener("click", createList);
$("#new-list-link").addEventListener("click", createList);
$("#create-first-list").addEventListener("click", createList);
$("#empty-create-list").addEventListener("click", createList);
$("#back-to-lists").addEventListener("click", showAllLists);
$("#share-list-button").addEventListener("click", shareList);
$("#rename-list-button").addEventListener("click", renameList);
$("#help-button").addEventListener("click", showHelp);
$("#add-task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!ui.newTask.value.trim()) return;
  addTask(ui.newTask.value);
  ui.newTask.value = "";
});
$("#disconnect-button").addEventListener("click", () => {
  if (!window.confirm("Disconnect from GitHub on this device? Your lists stay safely in the repository.")) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REPO_KEY);
  location.href = location.pathname;
});
$("#mobile-menu").addEventListener("click", () => {
  $("#sidebar").classList.toggle("menu-open");
  $("#mobile-backdrop").classList.toggle("hidden");
});
$("#mobile-backdrop").addEventListener("click", closeMobileMenu);
document.addEventListener("keydown", (event) => {
  if (!ui.modalBackdrop.classList.contains("hidden")) {
    if (event.key === "Escape") closeModal();
    return;
  }
  handleEditorKeys(event);
});

const params = new URLSearchParams(location.search);
if (params.get("repo")) ui.repo.value = params.get("repo");
if (localStorage.getItem(TOKEN_KEY) && localStorage.getItem(REPO_KEY)) {
  ui.token.value = localStorage.getItem(TOKEN_KEY);
  ui.repo.value = params.get("repo") || localStorage.getItem(REPO_KEY);
  connect(ui.token.value, ui.repo.value, true).catch((error) => {
    ui.connectMessage.textContent = `Could not reconnect: ${error.message}`;
    ui.token.value = "";
  });
}
