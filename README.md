# Daymark

Daymark is a keyboard-first todo app hosted as a static site on GitHub Pages. Your lists are stored in `.daymark/todos.json` in a GitHub repository you choose; the app has no server or separate database.

## Publish on GitHub Pages

The included Actions workflow publishes the site from the `main` branch. In your repository settings, choose **Pages → Build and deployment → GitHub Actions**. Push to `main` or run the **Deploy Daymark to GitHub Pages** workflow manually.

## Connect a repository

Create a fine-grained personal access token in GitHub and grant it access to the repository where your lists should live. Give it **Contents: Read and write** permission (GitHub's repository metadata permission is read-only and is selected automatically). Enter the token and repository as `owner/name` in Daymark.

The app tests access to your GitHub account and repository before connecting. Choose **Remember me on this device** to save the token in this browser's local storage. The token is sent to GitHub's API and nowhere else. Anyone with access to this browser profile can use it, so avoid saving it on shared devices; disconnect to remove it from local storage, and revoke it from GitHub when no longer needed.

Lists and tasks are saved in `.daymark/todos.json` in the selected repository. Daymark batches nearby edits into a single commit after a short pause, and syncs ongoing edits at least every 15 seconds. Commits are created under the connected GitHub account.

## Share a list

Use the share button in an open list to send a plain-text copy through your device's native share sheet, when available. Otherwise, Daymark copies the text to your clipboard. The shared text includes task completion and descriptions.

## Keyboard shortcuts

Open a list in View mode and press `e` to enter Write mode, or press `v` to return to View mode. These shortcuts also work when a list is selected from the list overview; lists open in View mode by default.

In Write mode, press `j` / `k` or the arrow keys to move the selection, `gg` / `G` to jump to the first / last task, `Enter` or `i` to edit a task's title and description, `o` to insert a task below and type its title, `a` to focus the add-task field, `x` to toggle completion, `Alt+j` / `Alt+k` to reorder the selected task, `dd` to delete, `/` to search, and `q` to return to all lists. Press `Escape` to cancel a task being typed or close a dialog. Press `?` for the in-app shortcut guide.

## Development

This is a dependency-free static site. Open `index.html` in a browser or serve the project directory with any static file server. API access requires a valid GitHub token and repository.
