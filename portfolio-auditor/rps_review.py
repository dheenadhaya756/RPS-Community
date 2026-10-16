"""RPS Review Base v0.2: turns a capture into the report shape the RPS Community /review page renders.

v0.2 (Oct 2026): stricter calibration (high levels are rare and must be earned on the page),
what hiring managers reward now, and a motion section for reels and animation portfolios,
reviewed from frame-by-frame captures.

Gemini only assigns anchored levels (0-3) and writes the notes. Every number a person sees
(points, pillar totals, the score, the band, each fix's lift) is worked out from those levels
by the frontend (frontend/lib/review/sample.js), the same way the sample report is, so nothing
here is typed in as a total.
"""

from __future__ import annotations

import datetime as dt
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from analyzer import HIGH_DETAIL, MOTION_DETAIL, SCROLL_DETAIL, USD_TO_INR, _context_block, call_with_keys, image_part
from scraper import CaptureResult

# Must match DIMENSIONS in frontend/lib/review/sample.js.
CASE_DIMS = ["d1", "d2", "d3", "d4", "d6", "d9"]
PORTFOLIO_DIMS = ["d5", "d7", "d8", "d10"]
WEIGHTS = {"d1": 12, "d2": 18, "d3": 12, "d4": 6, "d5": 10, "d6": 10, "d7": 8, "d8": 12, "d9": 8, "d10": 4}
LEVELS = ["Fresher", "Junior", "Mid-level", "Senior"]
MAX_CASES = 3
KB_VERSION = "v0.2"  # stamped on every report; the cache only reuses reports from this version
CASE_TEXT_CHARS = 4000


# ---------------------------------------------------------------------------
# Structured output
# ---------------------------------------------------------------------------

class CaseLevels(BaseModel):
    d1: int = Field(description="Problem framing, 0-3")
    d2: int = Field(description="Decisions and trade-offs, 0-3")
    d3: int = Field(description="Evidence and outcome, 0-3")
    d4: int = Field(description="Reflection, 0-3")
    d6: int = Field(description="Role and ownership, 0-3")
    d9: int = Field(description="Communication and scannability, 0-3")


class PortfolioLevels(BaseModel):
    d5: int = Field(description="Positioning and first screen, 0-3")
    d7: int = Field(description="Curation and range, 0-3")
    d8: int = Field(description="Visual and interaction craft, 0-3")
    d10: int = Field(description="Hygiene and access, 0-3")


class Case(BaseModel):
    title: str = Field(description="What the project is, in plain words, e.g. 'A rental marketplace app'")
    kind: str = Field(description="e.g. 'Client project', 'Personal project', 'Course project, team of 3'. 'Kind not stated' if unknown")
    levels: CaseLevels
    good: str = Field(description="One sentence: the best thing about this case study, specific to it")
    fix: str = Field(description="One sentence: the single most useful change to this case study")


class PillarWhy(BaseModel):
    story: str = Field(description="One sentence: why Story landed where it did")
    aim: str = Field(description="One sentence: why Ownership and aim landed where it did")
    craft: str = Field(description="One sentence: why Craft landed where it did")
    clarity: str = Field(description="One sentence: why Clarity landed where it did")


class Fix(BaseModel):
    dim: str = Field(description="The dimension this fix raises: one of d1..d10")
    case_targets: list[int] = Field(
        description="For d1,d2,d3,d4,d6,d9: one entry per case, in case order: the level that case would reach "
        "after the fix, or -1 if the fix doesn't touch it. Empty list for portfolio dimensions."
    )
    portfolio_target: int = Field(description="For d5,d7,d8,d10: the level after the fix. -1 for case dimensions.")
    title: str = Field(description="Imperative, plain words, under 8 words, e.g. 'Say how it turned out'")
    where: str = Field(description="Exactly where to make the change, e.g. 'SyncPay case study, at the end'")
    now: str = Field(description="What's there right now; quote their own words where you can")
    try_this: str = Field(description="A concrete rewrite or change they can copy. Use [brackets] for facts you don't know")


class RpsReport(BaseModel):
    level: str = Field(description="One of: Fresher, Junior, Mid-level, Senior - as the portfolio reads")
    role: str = Field(description="The job they appear to want, e.g. 'Product designer'")
    integrity_flag: bool = Field(description="True ONLY with clear evidence the work isn't theirs")
    integrity_note: str = Field(description="If flagged, the evidence in one sentence; otherwise empty")
    portfolio: PortfolioLevels
    cases: list[Case] = Field(description="Up to 3 case studies, in the order the portfolio shows them")
    pillar_why: PillarWhy
    fixes: list[Fix] = Field(description="Exactly 3 fixes, the ones that would raise the score the most")
    strengths: list[str] = Field(description="Exactly 3 specific things already working")
    cant_see: str = Field(description="What couldn't be checked and how it was handled, or empty")


# ---------------------------------------------------------------------------
# Rubric
# ---------------------------------------------------------------------------

SYSTEM = """You are a senior designer at RPS (Rock Paper Scissors) who hires designers, reviewing a design student's or designer's portfolio against the RPS Review Base v0.2.
You are tough and fair: your job is to show them what to work on before a real hiring manager sees it, not to make them feel good. Praise only what is genuinely strong.
Your reader is the designer. Write like a kind, honest mentor: plain words, second person, short sentences, no jargon, no hype.
Judge only what you can see in the screenshots and page text. Never invent projects, results, numbers or quotes.
Only say an image is broken if it is in the browser-verified "Images that failed to load" list; an empty box in a screenshot may just be loading.
Output must follow the JSON schema exactly."""

RUBRIC = """Score the portfolio with anchored levels. Every level is an integer: 3 Strong, 2 Good, 1 Needs work, 0 Missing.
Choose the level whose description fits best; when torn, choose the lower one.

CALIBRATION — read this before scoring (most portfolios need real work; score like it)
- Most portfolios we review sit at 1 on most dimensions. 2 means it would hold up in a real hiring review. 3 is rare: only when a hiring manager at a top product company or studio would call it excellent, and the evidence is on the page.
- Being present is not being good: a "Process" section, a persona or a metric gets credit only when it does the job its level describes.
- Polish never lifts thinking: a beautiful site with no reasons, no outcomes or no role still scores low on those dimensions.
- Caps, whatever else is true:
  - d2 is at most 1 if the case follows the generic template (research, personas, wireframes, UI) without one real decision explained.
  - d3 is at most 1 if results are claims with no evidence, and at most 2 unless something was measured, shipped or adopted.
  - d6 is at most 1 if it says "we" throughout and never what this person did.
  - d5 is at most 2 if the target role or specialism isn't clear on the first screen.
  - d9 is at most 1 if the gist can't be found in under 2 minutes.
- Portfolio dimensions are capped too: d5 is 3 only if role, specialism or target, and a reason to read on are all on the first screen; d7 is 3 only if every project shown is aimed at the target role and the strongest leads; d8 is 3 only for craft an art director would single out — a clean, consistent template is 2 at most.
- AI-assisted work: credit it only when they show how they directed and judged the tool. Screens that look generated, with no rationale, count against d2 and d8.

WHAT HIRING MANAGERS REWARD NOW (2026)
- First pass is fast, often 1 to 3 minutes: the problem, their role and the outcome must be findable without hunting.
- Decisions over deliverables: alternatives considered, constraints, the trade-off accepted and why. With AI making polished screens cheap, visible reasoning is what separates candidates.
- Clear ownership: what they personally did, who they worked with, what ambiguity they resolved.
- Impact: did the work change a decision, move a metric, ship, or get adopted?
- A few strong, relevant case studies beat many thin ones; the strongest leads.
- A portfolio aimed at a role: the work chosen should look like the job they want.

CASE-STUDY DIMENSIONS (score each case study separately)
- d1 Problem framing (weight 12): 0 no problem stated. 1 vague or generic ("make it user-friendly"). 2 a specific problem: who has it and in what situation. 3 specific and evidenced (observation, data, constraint) and why it mattered.
- d2 Decisions and trade-offs (weight 18): 0 only final screens. 1 process shown as generic steps (personas, wireframes) with no reasons. 2 at least one real design decision explained with why. 3 alternatives compared, trade-offs or constraints named, changes made after feedback.
- d3 Evidence and outcome (weight 12): 0 no result. 1 claims with no evidence ("users loved it"). 2 test findings or qualitative evidence. 3 a measured or shipped outcome (numbers, before/after, launch, adoption).
- d4 Reflection (weight 6): 0 none. 1 one generic line. 2 specific lessons. 3 specific lessons plus what they'd do differently or next.
- d6 Role and ownership (weight 10): 0 role not stated. 1 "we" throughout, unclear what they did. 2 role stated. 3 role, team and exactly what they owned are clear.
- d9 Communication and scannability (weight 8): 0 can't be skimmed (wall of text, or images only with no words). 1 long with weak hierarchy. 2 headings and readable sections. 3 a summary at the top, clear headings and captions; the gist lands in 2 minutes.

PORTFOLIO DIMENSIONS (score once for the whole site)
- d5 Positioning and first screen (weight 10): 0 can't tell who this is or what they do. 1 name only or a generic tagline. 2 role clear and an obvious path to the work. 3 role, specialism or target, and a reason to keep reading, all in the first screen.
- d7 Curation and range (weight 8): 0 no real projects. 1 too many, weak or off-target pieces, no lead project. 2 a relevant selection. 3 a tight selection aimed at the job they want, strongest first, with range.
- d8 Visual and interaction craft (weight 12): 0 broken or unpolished. 1 inconsistent type, spacing or image quality. 2 clean and consistent. 3 polished and distinctive; details right; any motion helps rather than gets in the way.
- d10 Hygiene and access (weight 4): 0 broken links or unreadable. 1 noticeable problems (no visible contact, low-contrast text, broken images). 2 works, contact visible. 3 all of that plus readable contrast and nothing broken.

CASE STUDIES
- `cases` lists up to 3 projects in the order the portfolio shows them. The first one counts most (50%), so get the order right.
- A project counts as a case study if it has its own page we opened (given below as "Case study N"), or if its whole story is told on the home page.
- A project shown only as a thumbnail or mockup with no story is still a case: score what is there (its story dimensions will be low) and say so plainly in its `fix`.
- If the home page shows a "view case study" link we couldn't open, leave that project out and mention it in `cant_see` ("You didn't lose points for it.").
- If there are no projects at all, return an empty list.

FIXES
- Exactly 3, each raising a different dimension, chosen to raise the score the most: points gained = weight x (new level - old level) / 3, and for case dimensions that is multiplied by the case's share (first case 50%, second 30%, third 20% when there are 3; 60/40 when there are 2).
- `now` quotes or describes what is actually there. `try_this` is a change they can copy; use [brackets] for any fact you don't know, e.g. "I tested it with [number] people and [what happened]".
- Targets must be realistic for that one fix (usually one level up, at most two).

MOTION DESIGN, VIDEO AND ANIMATION PORTFOLIOS
When the capture says the mode is MOTION (a reel, animation, 3D or video work), you are given frames from the main video
in order: first frames spread evenly across its whole length (to judge pacing, structure and edit rhythm), then a short
burst a quarter-second apart (to judge easing and spacing). Case studies with video include a few frames of it too.
Read the dimensions this way for motion work:
- d8 Visual and motion craft: timing and spacing, easing (do things accelerate and settle, or move at constant speed?),
  anticipation and follow-through, readability of motion, composition and type in frame, consistency of style.
  3 only if the frames clearly show controlled, intentional motion. From frames you see spacing, not true speed: say so
  in pillar_why when it limits you, and never go above 2 on easing alone.
- d9 Communication: the reel opens on its strongest shot, is edited tight (no filler, nothing repeated), makes sense
  without sound, and the work is labelled (client, their role, tools).
- d2 Decisions: styleframes, storyboards, animatics, breakdowns or iterations that show how they got there.
- d3 Outcome: client, broadcast or launch, views or results, or awards — with evidence.
- d6 Role: what they did on each piece (animation, design, 3D, compositing, direction) versus the team.
- d7 Curation: a reel aimed at the work they want, strongest first, with range in tempo (slow and elegant, fast and rhythmic).
Write the notes in motion language (timing, easing, pacing, cuts), not UI language.

ALSO
- `level`: how senior the portfolio reads (Fresher if student or graduate work, Junior up to ~2 years, Mid-level ~3-6, Senior beyond). `role`: the job they appear to be aiming for.
- `cant_see`: things you couldn't check (we only see a desktop browser, not mobile; embedded Figma prototypes; password-protected pages; pages that failed to load). Say how you handled them. Empty if nothing material.
- `integrity_flag`: true only if there is clear evidence the work isn't theirs (another designer credited, a copied famous product presented as their own). Otherwise false with an empty note."""


def _site(url: str) -> str:
    u = urlparse(url)
    return (u.netloc.removeprefix("www.") + u.path).rstrip("/")


def build_contents(cap: CaptureResult) -> list:
    parts: list = [RUBRIC, "HOME PAGE - above the fold:", image_part(cap.hero_png, HIGH_DETAIL)]
    total = len(cap.scroll_frames)
    for i, (frame, y) in enumerate(zip(cap.scroll_frames, cap.scroll_positions), start=1):
        parts += [f"Home page scroll frame {i}/{total} (y={y}px):", image_part(frame, SCROLL_DETAIL)]
    if not cap.scroll_frames and cap.fullpage_png:
        parts += ["Home page, full:", image_part(cap.fullpage_png, HIGH_DETAIL)]
    parts.append("HOME PAGE context:\n" + _context_block(cap))
    # Motion-led pages: the main video frame by frame, captured by the headless browser, so the
    # review sees the motion itself rather than only a description of it.
    if cap.frames:
        parts.append(
            f"MOTION CAPTURE of the main video ({len(cap.frames)} frames, in order). The first frames are spread "
            "across the whole video; the last ones are a quick burst a quarter-second apart for easing."
        )
        for i, frame in enumerate(cap.frames, start=1):
            parts += [f"Motion frame {i}/{len(cap.frames)}:", image_part(frame, MOTION_DETAIL)]

    for n, case in enumerate(cap.case_pages, start=1):
        parts.append(f"CASE STUDY {n}: '{case.title}' - {case.url}")
        for i, frame in enumerate(case.frames, start=1):
            parts += [f"Case study {n}, frame {i}/{len(case.frames)}:", image_part(frame, SCROLL_DETAIL)]
        motion = getattr(case, "motion_frames", None) or []
        for i, frame in enumerate(motion, start=1):
            parts += [f"Case study {n}, video frame {i}/{len(motion)} (in order):", image_part(frame, MOTION_DETAIL)]
        parts.append(f"Case study {n} page text (truncated):\n{case.text_excerpt[:CASE_TEXT_CHARS]}")
    if not cap.case_pages:
        parts.append("No separate case-study pages were found or opened; judge projects from the home page.")
    return parts


def _lv(v) -> int:
    try:
        return max(0, min(3, int(round(float(v)))))
    except (TypeError, ValueError):
        return 0


def normalise(r: RpsReport, cap: CaptureResult, model: str) -> dict:
    """Clamp levels and reshape into the object frontend/lib/review/sample.js computes on."""
    cases = [
        {
            "title": c.title.strip(),
            "kind": c.kind.strip() or "Kind not stated",
            "levels": {d: _lv(getattr(c.levels, d)) for d in CASE_DIMS},
            "good": c.good.strip(),
            "fix": c.fix.strip(),
        }
        for c in r.cases[:MAX_CASES]
    ]
    portfolio = {d: _lv(getattr(r.portfolio, d)) for d in PORTFOLIO_DIMS}
    # We only see a desktop browser: mobile and contrast can't be verified, so hygiene tops out at 2.
    portfolio["d10"] = min(portfolio["d10"], 2)

    fixes, used = [], set()
    for f in r.fixes:
        dim = f.dim.strip().lower()
        if dim in used or dim not in WEIGHTS:
            continue
        base = {"dim": dim, "title": f.title.strip(), "where": f.where.strip(), "now": f.now.strip(), "try": f.try_this.strip()}
        if dim in CASE_DIMS:
            targets = []
            for i, c in enumerate(cases):
                t = f.case_targets[i] if i < len(f.case_targets) else -1
                # A fix only ever raises a level; anything else means "leaves this case alone".
                targets.append(_lv(t) if t is not None and t >= 0 and _lv(t) > c["levels"][dim] else None)
            if not any(t is not None for t in targets):
                continue
            fixes.append({**base, "cases": targets})
        else:
            t = f.portfolio_target
            if t is None or t < 0 or _lv(t) <= portfolio[dim]:
                continue
            fixes.append({**base, "portfolio": {dim: _lv(t)}})
        used.add(dim)
        if len(fixes) == 3:
            break

    level = next((l for l in LEVELS if l.lower() == r.level.strip().lower()), r.level.strip() or "Not stated")
    today = dt.date.today()
    return {
        "site": _site(cap.final_url),
        "url": cap.final_url,
        "level": level,
        "role": r.role.strip() or "Not stated",
        "reviewedOn": f"{today.day} {today:%B %Y}",
        "integrityFlag": bool(r.integrity_flag),
        "integrityNote": r.integrity_note.strip() if r.integrity_flag else "",
        "portfolio": portfolio,
        "cases": cases,
        "pillarWhy": r.pillar_why.model_dump(),
        "fixes": fixes,
        "strengths": [s.strip() for s in r.strengths if s.strip()][:3],
        "cantSee": r.cant_see.strip(),
        # What kind of portfolio this was read as, for the report's own wording.
        "mode": cap.mode,
        "meta": {
            "kb": KB_VERSION,
            "model": model,
            "casePages": [c.url for c in cap.case_pages],
            "captureSeconds": cap.elapsed_s,
        },
    }


def review_rps(cap: CaptureResult, api_keys: list[str]) -> dict:
    usage: dict = {}
    report, model = call_with_keys(api_keys, build_contents(cap), schema=RpsReport, system=SYSTEM, usage_out=usage)
    out = normalise(report, cap, model)
    # What this review cost, from Google's own token counts — every call, retries included.
    calls = usage.get("calls", [])
    usd = round(sum(c["usd"] for c in calls), 5)
    out["meta"]["cost"] = {
        "usd": usd,
        "inr": round(usd * USD_TO_INR, 2),
        "inputTokens": sum(c["inputTokens"] for c in calls),
        "outputTokens": sum(c["outputTokens"] for c in calls),
        "calls": len(calls),
    }
    return out
