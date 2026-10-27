# The Iron Throne — browser + multiplayer setup

This project uses **GitHub Pages for the browser interface** and a separate **Node.js + Socket.IO server** for multiplayer. GitHub Pages cannot run the multiplayer server itself.

## Files and layout

Keep this structure at the root of your GitHub repository:

```text
index.html
style.css
app.js
config.js
package.json
render.yaml
server/
  index.js
```

The server lives in `server/index.js`; this file must be present for `npm start` and Render to work.

## 1. Test locally first

1. Install Node.js 20 or later.
2. Open this folder in VS Code.
3. Open a terminal at this folder and run:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:3000/health`. You should see JSON containing `"ok":true`.
5. In VS Code, use **Live Server** to open the root `index.html`. It usually opens at `http://127.0.0.1:5500` or `http://localhost:5500`.
6. The supplied `config.js` is set for local testing (`http://localhost:3000`). Keep the terminal running while playing.
7. Open the Live Server page in another browser or an incognito window to test the shared lobby.

Do not double-click `index.html` to open it with a `file://` address.

## 2. Deploy the multiplayer server to Render

1. Push the whole project—including `package.json` and `server/index.js`—to your GitHub repository.
2. In Render, choose **New → Web Service** and connect the repository.
3. Use the repository root as the service root directory (leave it blank if the UI permits).
4. Set **Build Command** to `npm install` and **Start Command** to `npm start`.
5. Add an environment variable named `ALLOWED_ORIGINS`. Set its value to the origin of your GitHub Pages site, plus the local development origins, separated by commas. Example:

   ```text
   https://YOUR-USERNAME.github.io,http://localhost:5500,http://127.0.0.1:5500
   ```

   Do not include a repository path (such as `/your-repo`) or a trailing slash in the origin. If you use a custom domain, add that domain's origin instead.
6. Deploy the service. Copy its HTTPS address, for example `https://iron-throne-game-server.onrender.com`.
7. Edit `config.js` and replace `http://localhost:3000` with your real Render HTTPS address. Do not include a trailing slash. Commit and push that change.
8. Visit `https://YOUR-RENDER-SERVICE.onrender.com/health`. You should see `{"ok":true,...}`.

## 3. Publish the browser interface with GitHub Pages

Because `index.html`, `style.css`, `app.js`, and `config.js` are in the repository root:

1. Open your repository on GitHub and go to **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `main` and folder `/(root)`, then save.
4. Open the published Pages URL. The page URL commonly looks like `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/` for a project site.
5. Make sure `config.js` now points to your Render server, not `localhost`.

If Pages is already publishing from `/docs`, either change the source to `/(root)` as above, or place the four frontend files in `/docs` and keep their paths together. Do not mix a root `index.html` with a `/docs` publishing source.

## Troubleshooting

- **The page loads but says “Server unavailable”:** `config.js` still points to localhost, the Render service is not running, or the Render URL is wrong.
- **The page loads but login says it cannot reach the server:** open the Render `/health` URL and confirm the JSON response.
- **Browser console shows a CORS/origin error:** make `ALLOWED_ORIGINS` match the exact site origin (`https://YOUR-USERNAME.github.io`, without the repository path or trailing slash), then save/redeploy the Render service.
- **Only the browser interface loads:** that is expected until the Node backend is running and the frontend has the backend URL in `config.js`.
- **The game resets after a server restart or redeploy:** this prototype keeps state in memory; it does not have a database yet.

## Prototype limitations

Guest names are not password-protected; use only for testing with trusted players. Players in a house share its resources. The game uses simplified battles and a basic capital model. This is not yet production-ready and does not persist game state across server restarts.
