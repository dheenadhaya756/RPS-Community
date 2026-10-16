# Launch handoff — Portfolio review (Sat 17 Oct, 3:00 PM IST)

**For:** Shikhar (owner of the Vercel project `rps-community` and the Supabase project).
**Time:** about 30 minutes, most of it waiting for builds.

## Why this is needed

1. **Vercel hasn't deployed since 7 Oct.** Every push to `main` since then shows
   "Canceled by Ignored Build Step" — including Darshit's workshop CMS. The live site
   is still the 7 Oct version.
2. **The repo moved** from `shikhar-rsp/RPS-Community` to
   **`dheenadhaya756/RPS-Community`** (public), so the project's Git link points at
   the old address.
3. **The portfolio reviewer** (`portfolio-auditor/`) is a separate Python service
   (headless Chromium + Gemini). Vercel can't run it, so it goes on a free Hugging
   Face Docker Space.

Supabase stays exactly as it is (project `xolersjqbielxomyavyf`). Nothing to run there:
the new code creates its own private storage buckets (`review-reports`,
`review-bookings`, `uploads`) on first use.

---

## Step 1 — Host the reviewer on Hugging Face (free)

```bash
git clone https://github.com/dheenadhaya756/RPS-Community.git
cd RPS-Community/portfolio-auditor
pip install huggingface_hub
python -c "from huggingface_hub import login; login()"   # paste a WRITE token from huggingface.co/settings/tokens
echo GEMINI_API_KEY=<ask Dheena for the key> > .env        # never commit this file
python deploy/deploy_hf.py
```

The script creates the Space `<your-hf-user>/rps-portfolio-review`, uploads only the
engine's code, stores `GEMINI_API_KEY` and a fresh `AUDITOR_TOKEN` as private Space
secrets, and prints:

```
AUDITOR_URL   https://<your-hf-user>-rps-portfolio-review.hf.space
AUDITOR_TOKEN <random token>
```

**Keep both values for Step 2.** The first build takes 5–10 minutes. Done when
`<AUDITOR_URL>/health` returns `{"ok":true,"gemini_key":true}`.

---

## Step 2 — Fix and deploy the Vercel project

### 2a. Stop skipping builds
Vercel → **rps-community** → **Settings → Git → Ignored Build Step** → set to
**Automatic** (delete any custom command) → **Save**.

### 2b. Add environment variables (Production)
Vercel → **Settings → Environment Variables**:

| Name | Value |
|---|---|
| `AUDITOR_URL` | from Step 1 |
| `AUDITOR_TOKEN` | from Step 1 |
| `NEXT_PUBLIC_REVIEW_LAUNCH_AT` | `2026-10-17T15:00:00+05:30` |

Check these already exist (they should): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL` = `https://cohorts.rockpaperscissors.studio`.

**Do not** set `REVIEW_DEV_NO_AUTH` or `NEXT_PUBLIC_REVIEW_DEV_NO_AUTH` — those are
for local testing only (they're ignored by production builds anyway).

### 2c. Deploy the latest `main`
The Git link still points at the old repo address, so deploy from a fresh clone with
the CLI (from the repo root, the project's Root Directory setting stays `frontend`):

```bash
cd RPS-Community
npx vercel link            # pick the existing project: shikhar-7897s-projects / rps-community
npx vercel --prod
```

Later, to make pushes deploy on their own again: Settings → Git → connect
`dheenadhaya756/RPS-Community` (Dheena installs the Vercel GitHub app on his account,
or adds you as a collaborator first).

---

## Step 3 — Check it (5 minutes)

Logged **out** (or in a private window):
- `/review` → the "Something is cooking" countdown to Sat 17 Oct, 3:00 PM IST, with
  **Join Cohort 03**.
- `/workshops` → Cohort 03 (17 Oct) shows, with its banner.

Logged **in as an admin** (an address in `ADMIN_EMAILS`, e.g. dheena@):
- `/review` → the full product. Run one review end to end (about a minute), open the
  report, press **Download PDF**.
- `/review/book` → submit a test 1:1 booking; it appears in **Admin → 1:1 bookings**.
- Registration for Cohort 03 still works (`/workshops/shortlist-ready-portfolio`).

At 3:00 PM IST `/review` opens to everyone automatically — no redeploy.

## If something's wrong
- "Our reviewer isn't running right now" → `AUDITOR_URL` / `AUDITOR_TOKEN` don't match
  the Space, or the Space is still building / asleep (first request wakes it in ~1 min).
- Workshops page says "Could not load the workshops" → the Supabase keys in Vercel.
