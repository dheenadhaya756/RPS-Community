# Launch handoff — Portfolio review (Sat 17 Oct, 3:00 PM IST)

**For:** whoever deploys the cohorts site and the review engine.

## Where things run

| Piece | Where | Who |
|---|---|---|
| Cohorts site (`frontend/`) at `cohorts.rockpaperscissors.studio` | The VPS (nginx). Cloudflare DNS points `cohorts` at it. Vercel is disconnected. | Amandeep |
| Review engine (`portfolio-auditor/`) | Google Cloud Run, project `rps-portfolio-tool`, service `rps-portfolio-review`, region `asia-south1` | Shikhar |
| Database, logins, files | Supabase project `xolersjqbielxomyavyf` | — |

The site calls the engine with two server-only variables, `AUDITOR_URL` and
`AUDITOR_TOKEN`. The engine refuses any request without the token; only `/health` is open.

Supabase needs nothing run by hand: the site creates its own private storage buckets
(`review-reports`, `review-bookings`, `uploads`) on first use. Workshops, hosts and
testimonials from the CMS are in Supabase tables, so they don't depend on the server.

## Status (16 Oct, evening)

- ✅ **Review engine is live** at
  `https://rps-portfolio-review-235874302131.asia-south1.run.app`.
  `/health` returns `{"ok":true,"gemini_key":true}`, and a full review ran end to end
  (about 2½ minutes).
- ✅ **`frontend/pnpm-lock.yaml` matches Next 16.** `package.json` moved to Next 16 on
  13 Oct but the pnpm lockfile still said 14, so a pnpm install refused it
  (`ERR_PNPM_OUTDATED_LOCKFILE`). `package-lock.json` already matched.
- ⏳ **The VPS still runs a build without `/review`** (it returns 404). Step 1 below.

---

## Step 1 — Deploy the site on the VPS (Amandeep)

1. **Pull the latest `main`** from `github.com/dheenadhaya756/RPS-Community`. It adds
   `/review`, `/review/book` and the 1:1 bookings admin, and stores uploads in Supabase
   Storage. Next 16 needs Node **20.9 or newer** (`node -v`). Install with the lockfile
   you normally use — both match.
2. **Add to the site's production env file, before building.** `NEXT_PUBLIC_` values are
   written into the pages at build time.
   ```
   AUDITOR_URL=https://rps-portfolio-review-235874302131.asia-south1.run.app
   AUDITOR_TOKEN=<from Shikhar, privately>
   NEXT_PUBLIC_REVIEW_LAUNCH_AT=2026-10-17T15:00:00+05:30
   ```
   Keep the existing Supabase keys and
   `NEXT_PUBLIC_SITE_URL=https://cohorts.rockpaperscissors.studio`. **Do not** set
   `REVIEW_DEV_NO_AUTH` or `NEXT_PUBLIC_REVIEW_DEV_NO_AUTH` (local testing only).
3. **Build and restart** as usual, e.g. in `frontend/`: `npm ci && npm run build`, then
   restart the app process.
4. If nginx limits request size, keep `client_max_body_size` at **40m** or more — the
   CMS accepts a 20 MB PDF.

## Step 2 — Check it (5 minutes)

Logged **out** (or in a private window):
- `/review` → the "Something is cooking" countdown to Sat 17 Oct, 3:00 PM IST, with
  **Join Cohort 03**.
- `/workshops` → Cohort 03 (17 Oct) shows, with its banner.

Logged **in as an admin** (an address in `ADMIN_EMAILS`, e.g. dheena@):
- `/review` → the full product. Run one review end to end (about 2½ minutes, longer if
  the engine was idle), open the report, press **Download PDF**.
- `/review/book` → submit a test 1:1 booking; it appears in **Admin → 1:1 bookings**.
- `/admin/workshops` → the workshops are listed.
- Registration for Cohort 03 still works (`/workshops/shortlist-ready-portfolio`).

At 3:00 PM IST `/review` opens to everyone automatically — no redeploy.

**Before 3:00 PM**, optional: keep the engine awake so nobody waits for it to start
(this bills for the whole time it's on):

```bash
gcloud run services update rps-portfolio-review --region asia-south1 --min-instances 1
# after launch day:
gcloud run services update rps-portfolio-review --region asia-south1 --min-instances 0
```

---

## Redeploying the review engine (Cloud Run)

Needs `gcloud` logged in to project `rps-portfolio-tool`
(`brew install --cask google-cloud-sdk`, `gcloud auth login`,
`gcloud config set project rps-portfolio-tool`) and `portfolio-auditor/.env` with
`GEMINI_API_KEY` and `AUDITOR_TOKEN` (git-ignored; `.gcloudignore` keeps it out of the
upload).

```bash
cd portfolio-auditor
GEMINI=$(grep '^GEMINI_API_KEY=' .env | cut -d= -f2- | tr -d '\r')   # tr: a .env saved with Windows line endings breaks the values
TOKEN=$(grep '^AUDITOR_TOKEN=' .env | cut -d= -f2- | tr -d '\r')

gcloud run deploy rps-portfolio-review \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --memory 2Gi --cpu 1 \
  --no-cpu-throttling \
  --max-instances 1 --min-instances 0 \
  --execution-environment gen2 \
  --timeout 300 \
  --set-env-vars "GEMINI_API_KEY=$GEMINI,AUDITOR_TOKEN=$TOKEN"
```

Why these settings — don't change them:

| Setting | Why |
|---|---|
| `--no-cpu-throttling` | A review keeps running after the request that started it returns. Without this, Cloud Run freezes the CPU between requests and reviews stall. |
| `--max-instances 1` | A review's progress lives on the instance's disk while the site polls it. A second instance wouldn't know about it. |
| `--memory 2Gi` | Headless Chromium. |
| `--allow-unauthenticated` | The site calls with the `AUDITOR_TOKEN` header, not a Google login. The engine itself refuses requests without the token (`REQUIRE_TOKEN=1` in the Dockerfile). |

Changing only a value (no code change) is quicker and needs no rebuild:

```bash
gcloud run services update rps-portfolio-review --region asia-south1 --update-env-vars AUDITOR_TOKEN=NEW_TOKEN
```

Then put the same token in the site's env file on the VPS and restart it.

Hugging Face (`deploy/deploy_hf.py`) is no longer an option on a free account: Docker
Spaces now answer `402 Payment Required` without a PRO plan.

## If something's wrong

- **"Our reviewer isn't running right now"** → `AUDITOR_URL` / `AUDITOR_TOKEN` on the VPS
  don't match Cloud Run, or the engine is still starting. Check `/health`, then its logs:
  ```bash
  gcloud run services logs read rps-portfolio-review --region asia-south1 --limit 50
  ```
- **Reviews fail partway, logs say "Memory limit exceeded"** →
  `gcloud run services update rps-portfolio-review --region asia-south1 --memory 4Gi --cpu 2`
- **`/review` is still a 404** → the VPS is serving an older build; pull, build and
  restart (Step 1).
- **The countdown shows the wrong time** → `NEXT_PUBLIC_REVIEW_LAUNCH_AT` was missing or
  wrong at build time; fix it and rebuild.
- **Workshops page says "Could not load the workshops"** → the Supabase keys in the
  site's env file.
