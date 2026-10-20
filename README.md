# Private Todos

A static, keyboard-friendly todo app. The interface is hosted on GitHub Pages; each list is a readable `.txt` file in a separate private GitHub repository. There is no app backend, analytics, tracker, or external runtime dependency.

## Security model

The fine-grained personal access token (PAT) is entered and used in your browser. It is sent only in the `Authorization` header to `https://api.github.com`; it is never placed in a URL or included in error messages. The token is stored as plaintext in browser storage: `localStorage` when “Remember me” is checked and `sessionStorage` otherwise. Clear browser data or log out to remove it. An optional WebCrypto passphrase layer is not implemented.

Create a fine-grained token limited to the one private data repository, grant **Contents: Read and write** (GitHub automatically adds **Metadata: Read**), and set a short expiration. Do not use a classic token, a token with access to all repositories, or a token with unrelated permissions. Anyone with access to the browser profile while a remembered token is present could use it; this app cannot protect a compromised browser or device.

The production HTML includes a restrictive Content Security Policy. UI text is inserted with DOM `textContent`; todo content is not interpreted as HTML. The app makes authenticated network requests only to GitHub's API origin.

## Setup and deployment

1. Create a **private** GitHub repository for the data, for example `your-name/private-todos`. It can start empty; the app creates `lists/` when it saves the first list.
2. In GitHub, open **Settings → Developer settings → Fine-grained personal access tokens → Generate new token**.
3. Set **Resource owner** to your account, **Repository access** to **Only select repositories**, then select only the data repository.
4. Under **Repository permissions**, set **Contents: Read and write**. Keep the automatically-added **Metadata: Read**, grant nothing else, and set an expiration.
5. Create or use a separate repository for this app's static source. From a local checkout, run:

   ```sh
   npm ci
   npm test
   npm run build
   ```

6. Push the app source to the repository's `main` branch. The included `.github/workflows/deploy.yml` tests, builds, and deploys `dist/` to GitHub Pages on each push (or by manual workflow dispatch).
7. In the app repository, open **Settings → Pages** and select **GitHub Actions** as the build and deployment source. Ensure Actions are enabled.
8. Open the published Pages URL, paste the PAT, enter the data repo as `owner/repo`, and optionally specify a branch. The empty branch field uses the repo's default branch.

Vite's relative `base: './'` and hash routing support Pages URLs under a repository sub-path, such as `https://your-name.github.io/private-todos/`. Do not place the PAT in source, Pages settings, an Actions secret, or a URL.

## Data format

Each list is stored at `lists/<slug>-<short-random-suffix>.txt`.

```text
# Groceries

* [ ] Buy coffee
- [ ] Milk
- [x] Eggs
This is an unrecognized line and is preserved as a note.
```

The first line is the list title (`# <Title>`), followed by a blank line. `- [ ]` is an open todo, `- [x]` is a completed todo, and `* [ ]` / `* [x]` marks a pinned todo. Todos retain their file order; pinning changes their display priority but not their stored order. Non-matching lines remain visible as notes and are preserved when saving. Renaming changes only the title line; deleting removes the file. Files are UTF-8.

Example data layout:

```text
private-todos/
└── lists/
    └── example.txt
```

See [`examples/lists/example.txt`](./examples/lists/example.txt) for a sample file. Sharing exports only a list title and `[ ]` / `[x]` todo lines, with pinned todos first; notes and pin markers are omitted. Sharing creates no repository writes.

## Keyboard reference

Single-letter shortcuts run only in Navigate mode and outside text fields. `gg`, `dd`, and `yy` sequences time out after about 800 ms. The `?` overlay and command palette use the same shortcut registry. The palette opens with `Ctrl/Cmd+K` or `:`. Browser and operating-system shortcuts such as Ctrl+T, Ctrl+W, Ctrl+L, Ctrl+R, Ctrl+P, and F5 are not intercepted.

| Context | Key | Action |
|---|---|---|
| Global | `Ctrl/Cmd+K` or `:` | Open command palette |
| Global | `Ctrl/Cmd+S` | Save and sync now |
| Global | `?` | Show help |
| Global | `Esc` | Close dialog/overlay, leave edit mode, or go back |
| Global | `Shift+L` | Log out (confirmation) |
| Global | `u` or `Ctrl/Cmd+Z` | Undo |
| Global | `Ctrl/Cmd+Shift+Z` | Redo |
| Global | `t` | Toggle light/dark theme |
| Lists | `j` / `↓`, `k` / `↑` | Move selection |
| Lists | `gg`, `G` | Select first / last list |
| Lists | `Enter`, `l`, `→` | Open selected list |
| Lists | `n`, `r`, `dd` / `Delete` | New, rename, delete selected list |
| Lists | `/`, `s`, `R` | Search, toggle sort, refresh |
| Lists | `1`–`9` | Jump to the numbered list |
| List | `j` / `↓`, `k` / `↑` | Move selection |
| List | `gg`, `G` | Select first / last todo |
| List | `Space` / `x` | Toggle completion |
| List | `p` | Pin / unpin |
| List | `i`, `Enter`, `e` | Edit todo |
| List | `o`, `O`, `a` | Add below / above / at end |
| List | `dd` / `Delete` | Delete todo |
| List | `J` / `Alt+↓`, `K` / `Alt+↑` | Move todo down / up |
| List | `yy` | Copy selected todo text |
| List | `Y` | Copy whole list as plain text |
| List | `m` | Open share options |
| Share dialog | `c`, `d`, `n` | Copy, download, or use Web Share when available |
| List | `/`, `H` | Filter todos, hide/show completed |
| List | `h`, `Backspace`, `Esc` | Go back to lists |
| List | `[` / `]` | Previous / next list |
| Edit | `Alt+P` | Pin / unpin todo |
| Edit | `Alt+↑` / `Alt+↓` | Move todo up / down |
| Edit | `Enter` | Save and add a todo below |
| Edit | `Esc` | Save and leave edit mode |
| Edit | `Backspace` on an empty todo | Remove it |
| Edit | `↑` / `↓` | Save and edit previous / next todo |
| Edit | `Ctrl/Cmd+Enter` | Toggle completion |
| Todo editor | Paste multiple lines | Split into individual todos |
| Confirmation dialog | `y` / `n`, `Enter` / `Esc` | Confirm / cancel |
| Command palette | `↑` / `↓`, `Enter`, `Esc` | Navigate, run, or close |
| Share dialog | `Esc` | Close |

Touch equivalents are available through the sticky mobile action bar, checkbox and pin buttons, and list/todo overflow menus. On-screen keyboard presence hides the bottom action bar to avoid covering the editor; the focused field remains available through the browser's visual viewport behavior.

## Sync and offline behavior

Edits are optimistic and cached in `localStorage`, then autosaved about one second after typing. Saving also flushes on window blur, page hide, and Ctrl/Cmd+S. Writes are serialized per file and use the latest known SHA. On a SHA conflict, the app tries a line-based three-way merge; overlapping changes require an explicit **Keep mine**, **Keep remote**, or **Keep both (append)** choice. Unsynced additions and edits remain cached when offline and retry when the browser comes back online. A 401 returns to login without discarding cached edits.

The directory listing handles a missing `lists/` directory as an empty repository. File ETags are stored alongside cached file content and used for conditional refreshes; the directory listing ETag is kept for the current browser session. The visible sync indicator reports saved, saving, unsaved, offline, and error states; activate it to retry.

## Manual QA checklist

- **Keyboard-only:** log in; create a list; type multiple todos with Enter; Esc; use `j`/`k`, `x`, and `p`; reorder with `J`/`K`; use undo/redo; open `?` and the command palette; search; share; return with `h`; rename and delete with confirmation.
- **Offline/conflict:** create or edit a list while offline and reconnect; verify it syncs. Edit the same line in the GitHub file and app, then save and verify the conflict choices prevent an automatic overwrite.
- **Mobile:** open the Pages URL at 360 px width; sign in, create/edit/check/pin todos using touch controls; open the menu and share; verify the editor remains visible with the on-screen keyboard, and test in iOS Safari or Android Chrome.
- **UTF-8 and preservation:** save emoji and accented text, reopen the file in GitHub, and verify unknown note lines and completed/pinned markers survive.

## Known limitations and design decisions

- GitHub Pages is a static host. The browser must keep the PAT to access the private data repository, and the app cannot securely conceal it from a user with access to that browser session.
- Todo identity is inferred from each file read; stable todo IDs are intentionally not written into the human-readable text format. The simplest line-oriented merge is conservative and asks for a choice when both sides change the same line.
- Lists are fetched in batches of four files. File ETags and cached content survive reload; the directory listing ETag is in-memory.
- The optional WebCrypto passphrase protection and service-worker app-shell caching are not included. Sharing uses clipboard, download, and Web Share when the browser provides it.
- The mobile action bar is hidden while the virtual keyboard is open to prevent it from covering the focused editor. All core actions remain available by touch when the keyboard is closed and by keyboard shortcuts on devices with a keyboard.
