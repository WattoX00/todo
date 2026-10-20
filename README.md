# Daymark

Daymark is a keyboard-first todo app hosted as a static site on GitHub Pages. Your lists are stored in `.daymark/todos.json` in a GitHub repository you choose; the app has no server or separate database.

## Publish on GitHub Pages

The included Actions workflow publishes the site from the `main` branch. In your repository settings, choose **Pages → Build and deployment → GitHub Actions**. Push to `main` or run the **Deploy Daymark to GitHub Pages** workflow manually.

## Connect a repository

Create a fine-grained personal access token in GitHub and grant it access to the repository where your lists should live. Give it **Contents: Read and write** permission (GitHub's repository metadata permission is read-only and is selected automatically). Enter the token and repository as `owner/name` in Daymark.

The app tests access to your GitHub account and repository before connecting. Choose **Remember me on this device** to save the token in this browser's local storage. The token is sent to GitHub's API and nowhere else. Anyone with access to this browser profile can use it, so avoid saving it on shared devices; disconnect to remove it from local storage, and revoke it from GitHub when no longer needed.

Lists and tasks are saved in `.daymark/todos.json` in the selected repository. All changes create commits in that repository under the connected GitHub account.

## Share a list

Use the share button in an open list to copy a link to that list. Recipients need their own token and access to the same repository; private repositories remain private.

## Keyboard shortcuts

Open a list and press `?` to see the in-app shortcut guide. Use `j` / `k` or the arrow keys to move, `gg` / `G` to jump to the first / last task, `Enter` to edit, `o` to insert and edit a task below, `a` to focus the add-task field, `x` to toggle completion, `dd` to delete, `/` to search, and `q` to return to all lists. Press `Escape` to cancel an inline edit.

## Development

This is a dependency-free static site. Open `index.html` in a browser or serve the project directory with any static file server. API access requires a valid GitHub token and repository.
