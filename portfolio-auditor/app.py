"""Portfolio Auditor - Streamlit front end."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import sqlite3
import subprocess
import sys
import time
from dataclasses import asdict
from pathlib import Path

import streamlit as st
from dotenv import load_dotenv

# Load only this project's .env (not one found further up the directory tree), and do it
# before importing analyzer so GEMINI_MODEL is respected.
load_dotenv(Path(__file__).parent / ".env")

from analyzer import MODEL, AnalyzerError, QuotaExceededError, analyze, review_to_markdown  # noqa: E402
from scraper import CaptureResult, ScrapeError, capture_portfolio, validate_url  # noqa: E402

APP_DIR = Path(__file__).parent
CACHE_DB = Path(os.getenv("CACHE_DB_PATH", APP_DIR / "audit_cache.sqlite3"))
CACHE_TTL_S = int(os.getenv("CACHE_TTL_HOURS", "24")) * 3600
CAPTURE_VERSION = 2
SERVER_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""

EXAMPLES = {
    "Behance - UI/UX": "https://www.behance.net/galleries/ui-ux",
    "Behance - Motion": "https://www.behance.net/galleries/motion",
    "Personal site": "https://brittanychiang.com",
    "Webflow showcase": "https://webflow.com/made-in-webflow/portfolio",
}

st.set_page_config(page_title="Portfolio Auditor", page_icon="🎯", layout="wide")

st.markdown(
    """
<style>
.block-container { padding-top: 2rem; max-width: 1400px; }
.mode-badge { display:inline-block; padding:4px 12px; border-radius:999px; font-weight:600; font-size:0.85rem; }
.mode-static { background:rgba(59,130,246,.15); color:#3b82f6; border:1px solid rgba(59,130,246,.4); }
.mode-motion { background:rgba(168,85,247,.15); color:#a855f7; border:1px solid rgba(168,85,247,.4); }
.score-card { border:1px solid rgba(128,128,128,.25); border-radius:12px; padding:14px 16px; height:100%; }
.score-card .label { font-size:.8rem; opacity:.75; text-transform:uppercase; letter-spacing:.04em; }
.score-card .value { font-size:2rem; font-weight:700; line-height:1.1; margin:4px 0 8px; }
.score-card .value small { font-size:1rem; opacity:.6; font-weight:500; }
.score-bar { height:6px; border-radius:3px; background:rgba(128,128,128,.2); overflow:hidden; }
.score-bar > div { height:100%; border-radius:3px; }
.score-card .why { font-size:.8rem; opacity:.8; margin-top:8px; }
.pill { display:inline-block; font-size:.72rem; padding:2px 8px; border-radius:999px; margin-right:4px;
        border:1px solid rgba(128,128,128,.35); }
.motion-pill { display:block; width:fit-content; margin:4px 0; border-color:rgba(168,85,247,.4); color:#a855f7; }
.headline { font-size:1.35rem; font-weight:650; margin:.2rem 0 .6rem; }
</style>
""",
    unsafe_allow_html=True,
)


# ---------------------------------------------------------------------------
# One-time setup: make sure Playwright's Chromium is present (needed on HF Spaces)
# ---------------------------------------------------------------------------

@st.cache_resource(show_spinner="Preparing headless browser (first run only)...")
def ensure_browser() -> str:
    try:
        proc = subprocess.run(
            [sys.executable, "-m", "playwright", "install", "chromium"],
            capture_output=True, text=True, timeout=600,
        )
        return "ok" if proc.returncode == 0 else proc.stderr[-500:]
    except Exception as exc:  # the scraper falls back to system Chromium if this fails
        return str(exc)


# ---------------------------------------------------------------------------
# SQLite cache keyed by URL (+ mode override). Captures and reviews are stored
# separately so a quota error doesn't force a re-scrape on retry.
# ---------------------------------------------------------------------------

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(CACHE_DB)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS audits (key TEXT PRIMARY KEY, url TEXT, capture TEXT, review TEXT, updated REAL)"
    )
    return conn


def cache_key(url: str, mode_override: str | None) -> str:
    norm = url.strip().lower().rstrip("/")
    # Bump CAPTURE_VERSION when the capture format changes so stale entries aren't reused.
    return hashlib.sha256(f"{CAPTURE_VERSION}|{norm}|{mode_override or 'AUTO'}".encode()).hexdigest()


def _encode_capture(cap: CaptureResult) -> str:
    d = asdict(cap)
    d["hero_png"] = base64.b64encode(cap.hero_png).decode()
    d["fullpage_png"] = base64.b64encode(cap.fullpage_png).decode() if cap.fullpage_png else None
    d["frames"] = [base64.b64encode(f).decode() for f in cap.frames]
    d["scroll_frames"] = [base64.b64encode(f).decode() for f in cap.scroll_frames]
    return json.dumps(d)


def _decode_capture(raw: str) -> CaptureResult:
    d = json.loads(raw)
    d["hero_png"] = base64.b64decode(d["hero_png"])
    d["fullpage_png"] = base64.b64decode(d["fullpage_png"]) if d["fullpage_png"] else None
    d["frames"] = [base64.b64decode(f) for f in d["frames"]]
    d["scroll_frames"] = [base64.b64decode(f) for f in d.get("scroll_frames", [])]
    return CaptureResult(**d)


def cache_get(key: str) -> tuple[CaptureResult | None, dict | None]:
    with _db() as conn:
        row = conn.execute("SELECT capture, review, updated FROM audits WHERE key=?", (key,)).fetchone()
    if not row or time.time() - row[2] > CACHE_TTL_S:
        return None, None
    cap = _decode_capture(row[0]) if row[0] else None
    review = json.loads(row[1]) if row[1] else None
    return cap, review


def cache_put(key: str, url: str, cap: CaptureResult, review: dict | None) -> None:
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO audits (key, url, capture, review, updated) VALUES (?, ?, ?, ?, ?)",
            (key, url, _encode_capture(cap), json.dumps(review) if review else None, time.time()),
        )


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------

def score_color(v: float) -> str:
    return "#16a34a" if v >= 7.5 else "#d97706" if v >= 5 else "#dc2626"


def render_score_card(label: str, value: float, rationale: str = "") -> None:
    color = score_color(value)
    st.markdown(
        f"""<div class="score-card">
  <div class="label">{label}</div>
  <div class="value" style="color:{color}">{value:.1f}<small> /10</small></div>
  <div class="score-bar"><div style="width:{value * 10:.0f}%;background:{color}"></div></div>
  {f'<div class="why">{rationale}</div>' if rationale else ''}
</div>""",
        unsafe_allow_html=True,
    )


def mode_badge(mode: str) -> str:
    if mode == "MOTION":
        return '<span class="mode-badge mode-motion">🎬 Motion Design</span>'
    return '<span class="mode-badge mode-static">🖼️ Static UI/UX</span>'


def render_capture(cap: CaptureResult) -> None:
    st.markdown(mode_badge(cap.mode), unsafe_allow_html=True)
    st.caption(f"{cap.mode_reason} · captured in {cap.elapsed_s}s")

    if cap.mode == "MOTION" and cap.frames:
        st.image(cap.frames[0], caption="Main player · frame 1", width="stretch")
        cols = st.columns(len(cap.frames))
        for i, (col, frame) in enumerate(zip(cols, cap.frames)):
            col.image(frame, caption=f"t={i}s", width="stretch")
        with st.expander("Above-the-fold view"):
            st.image(cap.hero_png, width="stretch")
    else:
        st.image(cap.hero_png, caption="Above the fold (1280×800)", width="stretch")

    if cap.motion_notes:
        st.markdown(
            " ".join(f'<span class="pill motion-pill">〰 {n}</span>' for n in cap.motion_notes), unsafe_allow_html=True
        )

    if cap.scroll_frames:
        with st.expander(f"Scroll journey · {len(cap.scroll_frames)} frames", expanded=cap.mode == "STATIC"):
            st.caption("What a visitor sees while scrolling, including pinned and scroll-animated sections.")
            for row in range(0, len(cap.scroll_frames), 2):
                cols = st.columns(2)
                for col, frame, y in zip(cols, cap.scroll_frames[row:row + 2], cap.scroll_positions[row:row + 2]):
                    col.image(frame, caption=f"y = {y:,}px", width="stretch")

    if cap.fullpage_png:
        with st.expander("Full-page capture"):
            if any("pinned" in n.lower() for n in cap.motion_notes):
                st.caption("Scroll-pinned sections render blank in a full-page screenshot; see the scroll journey above.")
            st.image(cap.fullpage_png, width="stretch")

    with st.expander("Detection signals & extracted data"):
        s = cap.signals
        st.write(
            f"**Videos:** {s['videos']} · **Player embeds:** {s['motion_iframes']} · **Canvas:** {s['canvases']} · "
            f"**GIFs:** {s['gifs']} · **Lottie:** {s['lottie']} · **Large images:** {s['large_images']}  \n"
            f"**Pinned sections:** {s.get('pinned_sections', 0)} · **Scroll reveals:** {s.get('scroll_reveals', 0)} · "
            f"**Ambient hero motion:** {'yes' if s.get('ambient_motion') else 'no'}"
        )
        if cap.tools:
            st.markdown("**Tools:** " + " ".join(f'<span class="pill">{t}</span>' for t in cap.tools), unsafe_allow_html=True)
        if cap.credits:
            st.markdown("**Credits:**\n" + "\n".join(f"- {c}" for c in cap.credits))
        if cap.headings:
            st.markdown("**Headings:** " + " · ".join(cap.headings[:12]))

    for w in cap.warnings:
        st.warning(w, icon="⚠️")


def render_review(review: dict, cap: CaptureResult) -> None:
    c1, c2 = st.columns([1, 3])
    with c1:
        render_score_card("Overall", review["overall_score"])
    with c2:
        st.markdown(f'<div class="headline">{review["headline"]}</div>', unsafe_allow_html=True)
        st.markdown(f"**Perceived role:** {review['detected_role']}")
        st.write(review["executive_summary"])

    st.write("")
    cols = st.columns(len(review["scores"]))
    for col, s in zip(cols, review["scores"]):
        with col:
            render_score_card(s["label"], s["value"], s["rationale"])

    st.write("")
    tab_actions, tab_detail, tab_raw = st.tabs(["✅ Action plan", "🔍 Detailed review", "{ } Raw JSON"])

    with tab_actions:
        for a in review["action_items"]:
            with st.container(border=True):
                st.markdown(
                    f"#### {a['priority']}. {a['title']}\n"
                    f'<span class="pill">Impact: {a["impact"]}</span><span class="pill">Effort: {a["effort"]}</span>',
                    unsafe_allow_html=True,
                )
                st.markdown(f"**Why it matters:** {a['why']}")
                st.markdown(f"**How to fix:** {a['how']}")

    with tab_detail:
        for sec in review["sections"]:
            with st.expander(f"{sec['title']} — {sec['rating']:.1f}/10", expanded=True):
                st.write(sec["verdict"])
                left, right = st.columns(2)
                with left:
                    st.markdown("**Strengths**")
                    for x in sec["strengths"]:
                        st.markdown(f"- ✅ {x}")
                with right:
                    st.markdown("**Issues**")
                    for x in sec["issues"]:
                        st.markdown(f"- ⚠️ {x}")

    with tab_raw:
        st.json(review)

    st.download_button(
        "⬇️ Download report (Markdown)",
        data=review_to_markdown(review, {"url": cap.final_url, "title": cap.title}),
        file_name="portfolio-audit.md",
        mime="text/markdown",
    )


# ---------------------------------------------------------------------------
# Page
# ---------------------------------------------------------------------------

def set_example(url: str) -> None:
    st.session_state.url_input = url


st.title("🎯 Portfolio Auditor")
st.markdown(
    "Paste a Behance, Webflow, Framer or personal portfolio link. A headless browser captures it, "
    "detects whether it's **static** or **motion** work, and Gemini writes a hiring-manager-style critique. Free and open source."
)

with st.sidebar:
    st.header("Settings")
    mode_choice = st.radio("Portfolio type", ["Auto-detect", "Static UI/UX", "Motion Design"], index=0)
    force_refresh = st.checkbox("Ignore cache (re-capture and re-review)", value=False)
    st.divider()
    st.caption(
        f"Model: `{MODEL}`  \n"
        f"Server key: {'configured ✅' if SERVER_KEY else 'not set — paste your own below'}  \n"
        f"Results are cached for {CACHE_TTL_S // 3600}h per URL."
    )

st.text_input("Portfolio URL", key="url_input", placeholder="https://www.behance.net/yourname")

ex_cols = st.columns(len(EXAMPLES))
for col, (label, url) in zip(ex_cols, EXAMPLES.items()):
    col.button(label, on_click=set_example, args=(url,), width="stretch")

with st.expander("🔑 Enter your own free Gemini API key (optional fallback if daily quota is reached)"):
    user_key = st.text_input(
        "Gemini API key", type="password", placeholder="AIza...", label_visibility="collapsed",
        help="Get one free at https://aistudio.google.com/apikey. It's used only for this session and never stored.",
    )
    st.caption("Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Used for this session only; never stored.")

run = st.button("Audit portfolio", type="primary", width="stretch")

mode_override = {"Static UI/UX": "STATIC", "Motion Design": "MOTION"}.get(mode_choice)

if run:
    try:
        url = validate_url(st.session_state.url_input)
    except ValueError as exc:
        st.error(str(exc))
        st.stop()

    key = cache_key(url, mode_override)
    cap, review = (None, None) if force_refresh else cache_get(key)
    # The user's own key goes first when given, so their quota is used intentionally;
    # otherwise the server key is tried first and the user key acts as a fallback.
    api_keys = [user_key, SERVER_KEY] if user_key else [SERVER_KEY]

    with st.status("Auditing portfolio...", expanded=True) as status:
        if cap is None:
            ensure_browser()
            st.write("🌐 Rendering page, scrolling to load lazy content...")
            try:
                cap = capture_portfolio(url, force_mode=mode_override)
            except (ScrapeError, ValueError) as exc:
                status.update(label="Capture failed", state="error")
                st.error(str(exc))
                st.stop()
            cache_put(key, url, cap, None)
            st.write(f"📸 Captured · detected **{'Motion Design' if cap.mode == 'MOTION' else 'Static UI/UX'}**")
        else:
            st.write("📦 Using cached capture")

        if review is None:
            st.write("🧠 Asking Gemini for a critique...")
            try:
                review = analyze(cap, api_keys)
                cache_put(key, url, cap, review)
            except QuotaExceededError:
                status.update(label="Gemini quota reached", state="error")
                st.session_state.result = (cap, None)
                st.session_state.error = (
                    "The free Gemini quota is used up for now (HTTP 429). Wait a minute and retry, or paste your own free "
                    "key from aistudio.google.com/apikey in the 🔑 field above. Your capture is cached, so a retry won't re-scrape."
                )
            except AnalyzerError as exc:
                status.update(label="Review failed", state="error")
                st.session_state.result = (cap, None)
                st.session_state.error = str(exc)
            else:
                st.session_state.error = None
        else:
            st.write("📦 Using cached review")
            st.session_state.error = None

        if review is not None:
            st.session_state.result = (cap, review)
            status.update(label="Audit complete", state="complete", expanded=False)

if "result" in st.session_state:
    cap, review = st.session_state.result
    st.divider()
    left, right = st.columns([5, 7], gap="large")
    with left:
        st.subheader("Captured evidence")
        render_capture(cap)
    with right:
        st.subheader("Review")
        if review:
            render_review(review, cap)
        elif st.session_state.get("error"):
            st.error(st.session_state.error, icon="🚫")
