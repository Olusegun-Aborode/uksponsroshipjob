# Deploying to Render

This app is a stateful Express server (SQLite on disk + in-process schedulers), so it needs an
always-on host with a persistent disk. Render fits it natively via the included `Dockerfile` and
`render.yaml`. Budget ~**$7/month** (Render's Starter plan — required, because persistent disks are
not available on the free tier).

## 1. Create the service (Blueprint)
1. Push is already done. Go to <https://dashboard.render.com> and sign in (sign up with GitHub).
2. **New → Blueprint**.
3. Connect the repo **`Olusegun-Aborode/uksponsroshipjob`** and approve Render's GitHub access.
4. Render reads `render.yaml` and proposes one web service (Docker, Starter plan, 1 GB disk mounted
   at `/app/data`, health check `/api/health`). Click **Apply**.

## 2. Set the environment variables
In the service → **Environment**, add each of these (copy the values from your local `.env` — they
are never committed). All are marked `sync: false` in `render.yaml`, so Render will prompt for them:

| Variable | Notes |
|---|---|
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | job feed |
| `ANTHROPIC_API_KEY` | CV tailoring + interview prep |
| `APP_PASSWORD` | **set this** — the password gate for the public URL (any username) |
| `AI_MONTHLY_BUDGET_USD` | e.g. `15` — hard monthly AI spend cap |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | new-role + reminder alerts |
| `SEARCH_KEYWORDS`, `ATS_BOARDS` | already in your `.env`; paste them in |

(`SEARCH_LOCATIONS`, `ADZUNA_MAX_PAGES`, etc. are optional — code defaults apply.)

## 3. First deploy
Render builds the Docker image (installs deps, builds the React frontend) and starts the server.
**First boot is slow on purpose:** the persistent disk starts empty, so the app downloads the
gov.uk sponsor register and runs one initial scan (a few minutes). Watch **Logs** for
`First boot: loading sponsor register…` then `Initial scan:`.

## 4. Use it
Open the `https://<your-service>.onrender.com` URL, log in with `APP_PASSWORD`, upload your CV, and
tailor away. Future `git push`es auto-deploy; the disk keeps your tracking + generated CVs.

## After deploying
- **The GitHub Actions scanner is now redundant** — Render runs the 3-hourly scan, daily backup, and
  daily reminders in-process. You can disable the Action (repo → Actions → scan → ⋯ → Disable) or
  leave it as a cold backup.
- **Backups** land on the persistent disk at `/app/data/backups/`. For off-box safety you can later
  add an R2/S3 upload step.
- **Custom domain**: add it under the service's **Settings → Custom Domains**.
