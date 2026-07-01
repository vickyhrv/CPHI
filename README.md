# HRV Pharma — CPHI Milan 2026 Planner

A small internal web app for CPHI Worldwide Milan (6–8 Oct 2026, Fiera Milano):
- **Overview** — countdown, quick stats
- **Budget** — editable line items (last year / this year est. / actual), auto-totals
- **Tasks** — prep checklist grouped by phase, with owners and a done toggle
- **Lead Capture** — booth staff log visitor details on any device; CSV export

Data is stored in JSON files under `/data` (no external database needed). Everyone
who opens the deployed URL sees and edits the same shared data — there's no login,
so treat the link as something you share only with your team.

## Run locally

```bash
npm install
npm start
```

Then open http://localhost:3000

## Deploy

This is a plain Node/Express app, so it runs on any standard Node host. Easiest options:

**Railway / Render** (recommended — both have a free tier and persistent disk):
1. Push this folder to a GitHub repo.
2. Create a new web service on Railway or Render, point it at the repo.
3. Build command: `npm install` · Start command: `npm start`.
4. **Important:** add a persistent volume/disk mounted at `/data` if the host
   offers one — otherwise the JSON data files reset on every redeploy.

**Fly.io / a VPS:** works the same way; just make sure the `/data` folder is
on a persistent volume, not the ephemeral container filesystem.

Once deployed, share the URL with your booth team — works fine on phones/tablets.

## Making changes later (with Claude Code)

This project is a normal Node app, so handing it to Claude Code for changes is
straightforward:

1. Open this folder in Claude Code (or point it at the GitHub repo).
2. Describe the change in plain language, e.g. "add a field for visitor's
   department on the lead form" or "add a chart showing budget by category."
3. Claude Code edits the existing files directly — `server.js` for the API,
   `public/index.html` / `public/app.js` / `public/styles.css` for the UI.
4. Test locally with `npm start`, then redeploy (push to GitHub if your host
   auto-deploys, or run your host's deploy command).
5. Your existing data in `/data` is untouched by a redeploy as long as it's on
   a persistent volume — code and data are separate.

## Project structure

```
server.js        — Express API (budget, tasks, leads)
store.js         — simple JSON-file datastore (swap for a real DB later if needed)
public/
  index.html     — app shell, 4 tabs
  app.js         — frontend logic, talks to the API
  styles.css     — design (teal/navy + amber accent)
data/            — JSON data files, created on first run
```
