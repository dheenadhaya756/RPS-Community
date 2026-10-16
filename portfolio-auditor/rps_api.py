"""Local HTTP API that runs RPS portfolio reviews for the RPS Community frontend.

    uvicorn rps_api:app --host 127.0.0.1 --port 8765

The Next.js server (never the browser) calls it:
    POST /audits        {"url": "...", "user_id": "..."}  -> {"id": "...", "status": "..."}
    GET  /audits/{id}?user_id=...                          -> job status, and the report once done

A review takes a minute or two (headless browser + Gemini), so it runs as a background job and
the frontend polls. Jobs and finished reports live in SQLite next to the Streamlit cache, so a
restart doesn't lose them, and the same link reviewed again within CACHE_TTL_HOURS is served from
the stored report instead of spending another Gemini call.

Bind it to 127.0.0.1. If it must listen elsewhere, set AUDITOR_TOKEN here and in the frontend's
.env.local so only the Next.js server can call it.
"""

from __future__ import annotations

import io
import json
import os
import secrets
import shutil
import sqlite3
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from PIL import Image  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from analyzer import AnalyzerError, QuotaExceededError  # noqa: E402
from rps_review import KB_VERSION, review_rps  # noqa: E402
from scraper import ScrapeError, capture_portfolio, validate_portfolio_url, validate_url  # noqa: E402

DB_PATH = Path(os.getenv("CACHE_DB_PATH", Path(__file__).parent / "audit_cache.sqlite3"))
# The screenshots each report shows ("What we looked at"), as small JPEGs, one folder per job.
SHOTS_DIR = Path(os.getenv("SHOTS_DIR", Path(__file__).parent / "shots"))
SHOT_WIDTH = 1000
HOME_SHOTS = 4  # the opening screen plus up to three frames from scrolling
CACHE_TTL_S = int(os.getenv("CACHE_TTL_HOURS", "24")) * 3600
API_KEYS = [os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or ""]
TOKEN = os.getenv("AUDITOR_TOKEN", "")
# On a public address the token is what keeps everyone but the RPS site out.
if os.getenv("REQUIRE_TOKEN") == "1" and not TOKEN:
    raise SystemExit("AUDITOR_TOKEN must be set when REQUIRE_TOKEN=1 (a public deployment).")
DB_DIR = Path(os.getenv("CACHE_DB_PATH", "audit_cache.sqlite3")).parent
DB_DIR.mkdir(parents=True, exist_ok=True)
CASE_STUDIES = 3
# Each review runs its own Chromium; two at a time keeps memory sane on a small machine.
POOL = ThreadPoolExecutor(max_workers=int(os.getenv("AUDITOR_WORKERS", "2")))

# What the report page shows while a job runs, keyed by stage.
STAGES = {
    "queued": "Waiting for a free reviewer",
    "opening": "Opening your portfolio",
    "scrolling": "Scrolling through it like a visitor would",
    "case_studies": "Opening your case studies",
    "reviewing": "Reading it against the RPS review guidelines",
    "done": "Done",
    "failed": "Something went wrong",
}

_lock = threading.Lock()

app = FastAPI(title="RPS portfolio review API", docs_url=None, redoc_url=None)


def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS rps_reports (
            id TEXT PRIMARY KEY, user_id TEXT, url TEXT, status TEXT, stage TEXT,
            report TEXT, error TEXT, created REAL, updated REAL)"""
    )
    # The optional case study someone added (e.g. a Behance project). Added to older databases.
    cols = {r[1] for r in conn.execute("PRAGMA table_info(rps_reports)")}
    if "extra" not in cols:
        conn.execute("ALTER TABLE rps_reports ADD COLUMN extra TEXT DEFAULT ''")
    return conn


def _norm(url: str) -> str:
    return url.strip().lower().rstrip("/")


def _save(job_id: str, **fields) -> None:
    fields["updated"] = time.time()
    cols = ", ".join(f"{k}=?" for k in fields)
    with _lock, _db() as conn:
        conn.execute(f"UPDATE rps_reports SET {cols} WHERE id=?", (*fields.values(), job_id))


def _check_token(token: str | None) -> None:
    if TOKEN and not secrets.compare_digest(token or "", TOKEN):
        raise HTTPException(status_code=401, detail="Bad auditor token")


def _jpeg(png: bytes) -> bytes:
    img = Image.open(io.BytesIO(png)).convert("RGB")
    if img.width > SHOT_WIDTH:
        img = img.resize((SHOT_WIDTH, round(img.height * SHOT_WIDTH / img.width)), Image.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=72, optimize=True, progressive=True)
    return out.getvalue()


def _save_shots(job_id: str, cap) -> list[dict]:
    """Keep a few of the captured screenshots for the report, in the order a visitor sees them:
    the opening screen, frames from scrolling the home page, then each case study it opened."""
    picks: list[tuple[bytes, str, str]] = []
    if cap.hero_png:
        picks.append((cap.hero_png, "home", "Your home page, as it first loads"))
    frames = cap.scroll_frames[1:] if len(cap.scroll_frames) > 1 else []
    step = max(1, len(frames) // (HOME_SHOTS - 1)) if frames else 1
    for i, frame in enumerate(frames[::step][: HOME_SHOTS - 1], start=1):
        picks.append((frame, "home", f"Scrolling your home page ({i})"))
    for case in cap.case_pages:
        if case.frames:
            picks.append((case.frames[0], "case", f"Case study: {case.title}"[:120]))
    folder = SHOTS_DIR / job_id
    folder.mkdir(parents=True, exist_ok=True)
    shots = []
    for n, (png, kind, label) in enumerate(picks):
        try:
            (folder / f"{n}.jpg").write_bytes(_jpeg(png))
            shots.append({"n": n, "kind": kind, "label": label})
        except Exception:  # a bad frame never costs the whole report
            continue
    return shots


def _run(job_id: str, url: str, extra: str = "") -> None:
    try:
        _save(job_id, status="running", stage="opening")
        cap = capture_portfolio(
            url,
            case_studies=CASE_STUDIES,
            on_progress=lambda stage: _save(job_id, stage=stage),
            extra_cases=[extra] if extra else [],
        )
        _save(job_id, stage="reviewing")
        report = review_rps(cap, API_KEYS)
        report["shots"] = _save_shots(job_id, cap)
        cost = report.get("meta", {}).get("cost", {})
        print(
            f"[review] {url}: Rs {cost.get('inr')} (${cost.get('usd')}), "
            f"{cost.get('inputTokens')} in / {cost.get('outputTokens')} out tokens, {cost.get('calls')} call(s)",
            flush=True,
        )
        _save(job_id, status="done", stage="done", report=json.dumps(report))
    except QuotaExceededError:
        _save(job_id, status="failed", stage="failed",
              error="Our reviewer has hit its daily limit. Try again in a few hours.")
    except (ScrapeError, ValueError, AnalyzerError) as exc:
        _save(job_id, status="failed", stage="failed", error=str(exc))
    except Exception as exc:  # never leave a job stuck in "running"
        _save(job_id, status="failed", stage="failed", error=f"Unexpected error: {exc}")


class AuditIn(BaseModel):
    url: str
    user_id: str
    # Optional: one case study the person adds themselves, typically on Behance.
    case_study_url: str | None = None


@app.get("/health")
def health():
    return {"ok": True, "gemini_key": bool(API_KEYS[0])}


@app.post("/audits")
def create_audit(body: AuditIn, x_auditor_token: str | None = Header(default=None)):
    _check_token(x_auditor_token)
    try:
        url = validate_portfolio_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    extra = ""
    if body.case_study_url and body.case_study_url.strip():
        try:
            extra = validate_url(body.case_study_url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=f"The case study link: {exc}") from exc

    job_id = uuid.uuid4().hex
    now = time.time()
    with _lock, _db() as conn:
        # Same link reviewed recently (by anyone): reuse that report rather than re-run it.
        row = conn.execute(
            "SELECT report, id FROM rps_reports WHERE url=? AND COALESCE(extra,'')=? AND status='done' AND updated>? "
            f"AND instr(report, '\"kb\": \"{KB_VERSION}\"') > 0 "
            "ORDER BY updated DESC LIMIT 1",
            (_norm(url), _norm(extra) if extra else "", now - CACHE_TTL_S),
        ).fetchone()
        status, stage, report = ("done", "done", row[0]) if row else ("queued", "queued", None)
        conn.execute(
            "INSERT INTO rps_reports (id, user_id, url, status, stage, report, error, created, updated, extra) "
            "VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
            (job_id, body.user_id, _norm(url), status, stage, report, now, now, _norm(extra) if extra else ""),
        )
    if row and (SHOTS_DIR / row[1]).is_dir():
        shutil.copytree(SHOTS_DIR / row[1], SHOTS_DIR / job_id, dirs_exist_ok=True)
    if not row:
        POOL.submit(_run, job_id, url, extra)
    return {"id": job_id, "status": status}


@app.get("/audits/{job_id}")
def get_audit(job_id: str, user_id: str, x_auditor_token: str | None = Header(default=None)):
    _check_token(x_auditor_token)
    with _db() as conn:
        row = conn.execute(
            "SELECT user_id, url, status, stage, report, error, created, updated FROM rps_reports WHERE id=?",
            (job_id,),
        ).fetchone()
    # A report is private to whoever asked for it; someone else's id looks like a missing one.
    if not row or row[0] != user_id:
        raise HTTPException(status_code=404, detail="No such review")
    _, url, status, stage, report, error, created, updated = row
    return {
        "id": job_id,
        "url": url,
        "status": status,
        "stage": stage,
        "stageLabel": STAGES.get(stage, stage),
        "elapsed": round((updated if status in ("done", "failed") else time.time()) - created),
        "report": json.loads(report) if report else None,
        "error": error,
    }


@app.get("/audits/{job_id}/shots/{n}")
def get_shot(job_id: str, n: int, user_id: str, x_auditor_token: str | None = Header(default=None)):
    """One of a report's screenshots. Private, like the report: someone else's looks missing."""
    _check_token(x_auditor_token)
    with _db() as conn:
        row = conn.execute("SELECT user_id FROM rps_reports WHERE id=?", (job_id,)).fetchone()
    path = SHOTS_DIR / job_id / f"{int(n)}.jpg"
    if not row or row[0] != user_id or not path.is_file() or not job_id.isalnum():
        raise HTTPException(status_code=404, detail="No such screenshot")
    return Response(path.read_bytes(), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


# ----------------------------------------------------------------- 1:1 bookings
# Requests for a paid 1:1 mentoring call (Rs 200), made from /review/book. The team works them
# from the admin's Bookings tab: confirm a time, send the payment link, mark paid, mark done.

BOOKING_STATUSES = ("NEW", "CONFIRMED", "PAID", "DONE", "CANCELLED")


def _bookings_db() -> sqlite3.Connection:
    conn = _db()
    conn.execute(
        """CREATE TABLE IF NOT EXISTS rps_bookings (
            id TEXT PRIMARY KEY, user_id TEXT, name TEXT, email TEXT, whatsapp TEXT,
            portfolio_url TEXT, report_id TEXT, slot TEXT, topic TEXT, price_inr INTEGER,
            status TEXT, note TEXT, created REAL, updated REAL)"""
    )
    return conn


class BookingIn(BaseModel):
    user_id: str
    name: str
    email: str
    whatsapp: str
    portfolio_url: str = ""
    report_id: str = ""
    slot: str
    topic: str = ""
    price_inr: int = 200


@app.post("/bookings")
def create_booking(body: BookingIn, x_auditor_token: str | None = Header(default=None)):
    _check_token(x_auditor_token)
    now = time.time()
    booking_id = uuid.uuid4().hex
    with _lock, _bookings_db() as conn:
        conn.execute(
            "INSERT INTO rps_bookings (id, user_id, name, email, whatsapp, portfolio_url, report_id, slot, topic, "
            "price_inr, status, note, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NEW', '', ?, ?)",
            (booking_id, body.user_id, body.name.strip()[:120], body.email.strip()[:200], body.whatsapp.strip()[:32],
             body.portfolio_url.strip()[:2048], body.report_id.strip()[:64], body.slot.strip()[:80],
             body.topic.strip()[:2000], int(body.price_inr), now, now),
        )
    return {"id": booking_id, "status": "NEW"}


def _booking_row(r) -> dict:
    keys = ["id", "userId", "name", "email", "whatsapp", "portfolioUrl", "reportId", "slot", "topic",
            "priceInr", "status", "note", "created", "updated"]
    return dict(zip(keys, r))


@app.get("/bookings")
def list_bookings(user_id: str | None = None, x_auditor_token: str | None = Header(default=None)):
    """Every booking, newest first (the admin list) — or one person's own, with `user_id`."""
    _check_token(x_auditor_token)
    sql = ("SELECT id, user_id, name, email, whatsapp, portfolio_url, report_id, slot, topic, price_inr, status, "
           "note, created, updated FROM rps_bookings")
    args: tuple = ()
    if user_id:
        sql += " WHERE user_id=?"
        args = (user_id,)
    with _bookings_db() as conn:
        rows = conn.execute(sql + " ORDER BY created DESC LIMIT 500", args).fetchall()
    return {"bookings": [_booking_row(r) for r in rows]}


class BookingPatch(BaseModel):
    status: str | None = None
    note: str | None = None


@app.patch("/bookings/{booking_id}")
def update_booking(booking_id: str, body: BookingPatch, x_auditor_token: str | None = Header(default=None)):
    _check_token(x_auditor_token)
    if body.status is not None and body.status not in BOOKING_STATUSES:
        raise HTTPException(status_code=422, detail="Unknown status")
    fields, args = [], []
    if body.status is not None:
        fields.append("status=?"); args.append(body.status)
    if body.note is not None:
        fields.append("note=?"); args.append(body.note.strip()[:1000])
    if not fields:
        raise HTTPException(status_code=422, detail="Nothing to change")
    fields.append("updated=?"); args.append(time.time())
    with _lock, _bookings_db() as conn:
        n = conn.execute(f"UPDATE rps_bookings SET {', '.join(fields)} WHERE id=?", (*args, booking_id)).rowcount
    if not n:
        raise HTTPException(status_code=404, detail="No such booking")
    return {"ok": True}


@app.get("/users/{user_id}/reviews")
def reviews_since(user_id: str, since: float, x_auditor_token: str | None = Header(default=None)):
    """This account's reviews since a moment (the start of today, IST): the daily limit counts
    these. Failed reviews don't count, so a site that wouldn't open never uses up a go."""
    _check_token(x_auditor_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, url, status, created FROM rps_reports WHERE user_id=? AND created>=? "
            "AND status IN ('queued', 'running', 'done') ORDER BY created DESC",
            (user_id, float(since)),
        ).fetchall()
    return {"reviews": [{"id": r[0], "url": r[1], "status": r[2], "created": r[3]} for r in rows]}


@app.get("/users/{user_id}/review")
def latest_for_user(user_id: str, x_auditor_token: str | None = Header(default=None)):
    """The review this account already has, if any — the site allows one per account.

    A failed review doesn't count (the portfolio couldn't be opened, the model was busy),
    so only jobs that are queued, running or done are returned.
    """
    _check_token(x_auditor_token)
    with _db() as conn:
        row = conn.execute(
            "SELECT id, url, status FROM rps_reports WHERE user_id=? AND status IN ('queued', 'running', 'done') "
            "ORDER BY created DESC LIMIT 1",
            (user_id,),
        ).fetchone()
    if not row:
        return {"review": None}
    return {"review": {"id": row[0], "url": row[1], "status": row[2]}}


# Jobs that were running when the server stopped will never finish; mark them so the page
# shows an error instead of spinning forever.
with _db() as _conn:
    _conn.execute(
        "UPDATE rps_reports SET status='failed', stage='failed', "
        "error='The reviewer restarted before this finished. Please send the link again.' "
        "WHERE status IN ('queued', 'running')"
    )
