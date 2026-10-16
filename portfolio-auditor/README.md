---
title: RPS Portfolio Review
emoji: 🎯
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# 🎯 Portfolio Auditor

A free, open-source tool that critiques design portfolios (Behance, Webflow, Framer, personal sites) from a URL.

1. **Capture** (`scraper.py`): headless Chromium (1280×800) loads the page, scrolls to trigger lazy-loading, dismisses cookie banners, and takes an above-the-fold screenshot plus a full-page screenshot.
2. **Detect mode**: counts `<video>`, player iframes (Vimeo/YouTube/Behance), canvases, GIFs and Lottie players, and checks the title, tags and headings for motion keywords. It then classifies the page as **Static UI/UX** or **Motion Design**. Motion pages also get a 4-frame burst (1 s apart) from the main player, plus extracted tools (After Effects, Blender, C4D…) and credits.
3. **Review** (`analyzer.py`): Gemini scores the page against a rubric for its mode and returns structured JSON:
   - **Static:** First Impressions (5-second test) · Visual Craft · Case Study Depth · Usability & Navigation → scores for *Visual Craft, Storytelling, Usability* + Top 3 fixes
   - **Motion:** Rhythm & Pacing · Easing & Physics · Visual Hierarchy in Motion · Technical Execution · Presentation & Context → scores for *Pacing, Easing/Fluidity, Technical Polish* + Top 3 motion tweaks
4. **UI** (`app.py`): Streamlit shows the evidence on the left, the scorecards and review on the right, and offers a Markdown report download. Results are cached in SQLite per URL for 24 h, so repeat audits don't spend API calls.

It costs $0 to run: the Gemini API free tier (no billing account) and Streamlit on a free Hugging Face CPU Space.

## Gemini model note

`gemini-2.5-flash` is **no longer available to new API keys**. Google now returns a 404 and recommends `gemini-3.8-flash`. The app defaults to `gemini-3.8-flash`. If that model is overloaded (503) or retired (404), it falls back to `gemini-3.5-flash`, then `gemini-flash-latest`. To pin a different model, set `GEMINI_MODEL`.

Free-tier rate limits vary by model and change over time. Check yours at [aistudio.google.com](https://aistudio.google.com) → *Usage & limits*. If the server key hits its limit (HTTP 429), users can paste their own free key in the app.

## Run locally

Requires Python 3.10+.

```bash
cd portfolio-auditor
python -m venv .venv
# Windows:  .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
cp .env.example .env          # Windows: copy .env.example .env
# edit .env and set GEMINI_API_KEY (free key: https://aistudio.google.com/apikey)
streamlit run app.py
```

Open http://localhost:8501.

Test the scraper on its own (no API key needed):

```bash
python scraper.py https://brittanychiang.com
```

On Linux, if Chromium fails to start because of missing system libraries, run `python -m playwright install --with-deps chromium`.

## Deploy to Hugging Face Spaces (free)

1. Create a new Space → SDK **Streamlit** → hardware **CPU basic**.
2. Push these files to the Space repo (the YAML header at the top of this README configures it):
   ```bash
   git clone https://huggingface.co/spaces/<you>/portfolio-auditor
   cp app.py scraper.py analyzer.py requirements.txt packages.txt README.md portfolio-auditor/
   cd portfolio-auditor && git add . && git commit -m "Portfolio Auditor" && git push
   ```
3. In the Space's **Settings → Variables and secrets**, add a secret named `GEMINI_API_KEY`.
4. `packages.txt` installs Chromium's system libraries via apt. On first launch the app runs `playwright install chromium` once (cached, ~1 min). If that download fails, the scraper falls back to the distro Chromium at `/usr/bin/chromium`.

Notes:
- The SQLite cache lives in the container and is cleared whenever the Space restarts. That's fine for a cache.
- If the Streamlit SDK image ever changes in a way that breaks Chromium, switch the Space to the **Docker** SDK and start from `mcr.microsoft.com/playwright/python` as the base image.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | – | Server key (also reads `GOOGLE_API_KEY`) |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Primary model |
| `CACHE_TTL_HOURS` | `24` | How long an audit is reused |
| `CACHE_DB_PATH` | `audit_cache.sqlite3` | SQLite cache file |

## Limitations

- Behance and some hosts serve bot-protection responses. The capture still works in most cases, and the app warns you when a page comes back nearly empty.
- Motion review uses 4 sampled frames, so the model infers easing and pacing from frame-to-frame changes and can't hear audio. The prompt asks it to state its confidence.
- Iframe players (Vimeo/YouTube) sometimes won't autoplay headless. When that happens the frames show the poster image, and the review relies more on the page context.
- Pages taller than 9,000 px are cropped before review.
- If auto-detection guesses the wrong mode, override it in the sidebar.

## RPS Community integration

`rps_api.py` serves the same engine to the RPS Community site (`../rps-community/frontend`), scored against the RPS Review Base v0.1 (`rps_review.py`). It also opens up to 3 case-study pages linked from the home page. Gemini only assigns 0–3 levels and writes the notes. Every score, band and fix lift is computed by the frontend in `lib/review/sample.js`.

Run both:

```bash
# terminal 1 - review engine (needs GEMINI_API_KEY in portfolio-auditor/.env)
cd portfolio-auditor
python -m uvicorn rps_api:app --host 127.0.0.1 --port 8765

# terminal 2 - the site
cd rps-community/frontend
npm install
npm run dev            # http://localhost:3000/review
```

The site calls the engine only from the server (`lib/review/auditor.js`). Set `AUDITOR_URL` in `.env.local` if it isn't on `127.0.0.1:8765`, and set the same `AUDITOR_TOKEN` on both sides if the engine listens anywhere other than localhost. Reports are private to the account that asked for them, and the same link is reused from cache for 24 h.
