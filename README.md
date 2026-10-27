# The Iron Throne — Multiplayer Prototype

A temporary multiplayer Game of Thrones-inspired strategy game starter. The frontend is static HTML/CSS/JavaScript and can be hosted on **GitHub Pages**. The real-time game server uses **Node.js + Express + Socket.IO** and must be hosted separately (for example, as a Render Web Service). GitHub Pages does not run a Node server or keep a shared live game process.

## What this prototype includes

- Guest-name login with a browser session token (not secure account authentication)
- First-come-first-served house selection
- Major houses: Stark, Lannister, Baratheon — multiple players allowed
- Minor houses: Targaryen, Tyrell, Greyjoy, Martell, Arryn — one player per house, unlock at 7+ players
- House buffs / nerfs and one starting dragon for Targaryen
- Great Council vote for king and tied-election runoff
- Shared house treasury and force pool for players in the same house
- Gold income based on the number of capitals a house controls
- Recruiting infantry / navy, espionage, secret attack orders, and next-round resolution
- Hidden army counts; a successful spy report reveals the target house's available forces and pending attack target
- Public court chat, house-to-house secret messages, public/secret alliance offers, alliance acceptance, and breaking an alliance
- King commands: royal levy or recruitment embargo
- A public capital board, event chronicle, and reset button for the host

## Known prototype limits

- **The server keeps game state in memory.** Restarting or redeploying the server resets the game. Nothing is saved to a database yet.
- **Guest names are not protected by passwords.** This is only for testing with trusted players; do not use sensitive information.
- One server instance hosts one shared game. It does not yet have game rooms, a persistent user system, a full map movement model, siege progress, a finished victory condition, or production-ready cheat prevention.
- Battles are a deliberately simplified abstraction: forces are house-wide pools, and a battle targets a capital. Captured capitals increase the house's future income.
- Any player in a house shares that house's treasury and force pool. Coordinate purchases and attacks with your housemates.
- The prototype uses a few random battle and spy results. House rules are starter balance values, not final balance.

---

# Run it locally first

Install Node.js 20 or later.

From the project root:

```bash
npm install
npm start
```

The server should print that it is listening on port `3000`. Check `http://localhost:3000/health`; it should return JSON with `ok: true`.

In `config.js`, leave this value for local testing:

```js
serverUrl: 'http://localhost:3000'
```

Serve the repository root using VS Code Live Server (recommended) or another local static web server. Open the local page, enter a guest name, and open the page in another browser/incognito window to test multiplayer. Keep the Node terminal running while you play.

Do not open `index.html` directly as a `file://` URL; use Live Server or GitHub Pages.

# Deploy the backend (Render)

1. Push this entire project to a GitHub repository.
2. In Render, create a **New → Web Service** connected to that repository. Render's Node deployment guide: <https://render.com/docs/deploy-node-express-app>.
3. Set the service's root directory to the repository root (leave it blank if the form permits).
4. Use build command `npm install` and start command `npm start`.
5. Set the environment variable `ALLOWED_ORIGINS` to your GitHub Pages origin, such as `https://adrianstoltzfus2-eng.github.io`. Do **not** add the repository path or a trailing slash. For local development you may also include `http://localhost:5500,http://127.0.0.1:5500`.
6. Deploy. Copy the service's HTTPS URL, such as `https://your-game-server.onrender.com`.
7. Open `config.js` and replace `http://localhost:3000` with that HTTPS URL. Commit and push this change.
8. If you use `render.yaml` to deploy from a Blueprint, make sure its `ALLOWED_ORIGINS` value includes `https://adrianstoltzfus2-eng.github.io`. Otherwise, set `ALLOWED_ORIGINS` from the Render dashboard.

The backend exposes `/health` for a basic health check. On Render's free plan, services can spin down after a period without traffic; this temporary version keeps state only in memory, so a server restart/spin-down can reset the game. Render's web service documentation explains the server deployment and port behavior: <https://render.com/docs/web-services>.

# Deploy the frontend (GitHub Pages)

1. Push the project to GitHub.
2. In the repository, open **Settings → Pages**.
3. Under Build and deployment, choose **Deploy from a branch**.
4. Select branch `main` and folder `/(root)`, then save.
5. Wait for GitHub Pages to publish the site; open the URL shown in the Pages settings.
6. Confirm that `config.js` points to the deployed HTTPS backend. The frontend must use HTTPS to communicate with a secure hosted backend.

GitHub Pages hosts the frontend files in the repository root; it does **not** host `server/index.js` as a running backend. The frontend and backend are two separate deployments.

# Run the built-in game-logic tests

After installing dependencies, run:

```bash
npm test
```

The tests use Node's built-in test runner and check voting, income, house selection, privacy of army counts, attack reservation, and secret alliance visibility.

# Recommended next build steps

1. Add secure user accounts and persistent storage (SQLite/PostgreSQL) before opening the game to the public.
2. Add lobby rooms and a host-controlled game creation flow.
3. Move capital ownership and garrison units into a more detailed territory model.
4. Add routes, movement rules, naval landings, siege turns, and defender-specific garrisons.
5. Add action timers and robust reconnect / stale-order handling.
6. Add unit tests for house selection, income, espionage privacy, attacks, treaties, and phase progression.
