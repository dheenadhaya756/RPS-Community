"""RPS Review Base v0.3: turns a capture into the report shape the RPS Community /review page renders.

v0.3 (17 Oct 2026): strict. Every dimension starts at "Needs work" and only moves up for evidence
quoted from the page; a red-flag list (from hiring-manager surveys, recruiters and heads of design)
caps the dimensions it touches; and normalise() enforces the evidence in code, so a level the
model can't back up with a quote is lowered before anyone sees it.
v0.2 (Oct 2026): stricter calibration, what hiring managers reward now, and a motion section for
reels and animation portfolios, reviewed from frame-by-frame captures.

Gemini only assigns anchored levels (0-3), the evidence for them, and the notes. Every number a
person sees (points, pillar totals, the score, the band, the gates that hold it down, each fix's
lift) is worked out from those levels by the frontend (frontend/lib/review/sample.js), the same way
the sample report is, so nothing here is typed in as a total.
"""

from __future__ import annotations

import datetime as dt
import re
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
KB_VERSION = "v0.3"  # stamped on every report; the cache only reuses reports from this version
CASE_TEXT_CHARS = 4000

# What a level must be backed by (see _earned): a 2 needs a real quote, a 3 a fuller one, and a
# 3 for results needs a number or proof that it shipped.
MIN_EVIDENCE_GOOD = 12
MIN_EVIDENCE_STRONG = 30
SHIPPED_OR_MEASURED = re.compile(
    r"\d|launch|shipped|\blive\b|released|adopt|in production|rolled out|app store|play store|award|client",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Structured output
# ---------------------------------------------------------------------------

_EV = ("Quote the page's own words (or name the exact element you saw) that earn this level. "
       "Required for level 2 or 3; leave empty for 0 or 1.")


class CaseEvidence(BaseModel):
    d1: str = Field(description="Problem framing. " + _EV)
    d2: str = Field(description="Decisions and trade-offs. " + _EV)
    d3: str = Field(description="Evidence and outcome. " + _EV + " A 3 needs the number or the proof it shipped.")
    d4: str = Field(description="Reflection. " + _EV)
    d6: str = Field(description="Role and ownership. " + _EV)
    d9: str = Field(description="Communication and scannability. " + _EV)


class CaseLevels(BaseModel):
    d1: int = Field(description="Problem framing, 0-3")
    d2: int = Field(description="Decisions and trade-offs, 0-3")
    d3: int = Field(description="Evidence and outcome, 0-3")
    d4: int = Field(description="Reflection, 0-3")
    d6: int = Field(description="Role and ownership, 0-3")
    d9: int = Field(description="Communication and scannability, 0-3")


class PortfolioEvidence(BaseModel):
    d5: str = Field(description="Positioning and first screen. " + _EV)
    d7: str = Field(description="Curation and range. " + _EV)
    d8: str = Field(description="Visual and interaction craft. " + _EV)
    d10: str = Field(description="Hygiene and access. " + _EV)


class PortfolioLevels(BaseModel):
    d5: int = Field(description="Positioning and first screen, 0-3")
    d7: int = Field(description="Curation and range, 0-3")
    d8: int = Field(description="Visual and interaction craft, 0-3")
    d10: int = Field(description="Hygiene and access, 0-2 (3 is never given: mobile and contrast can't be checked)")


class Case(BaseModel):
    title: str = Field(description="What the project is, in plain words, e.g. 'A rental marketplace app'")
    kind: str = Field(description="e.g. 'Client project', 'Personal project', 'Course project, team of 3'. 'Kind not stated' if unknown")
    # Evidence comes before levels on purpose: the level is chosen after the quote is written.
    evidence: CaseEvidence
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
    red_flags: list[str] = Field(
        description="Every red flag from the rubric's list that you can see, in plain words, most damaging first. "
        "Empty only if none applies."
    )
    portfolio_evidence: PortfolioEvidence
    portfolio: PortfolioLevels
    cases: list[Case] = Field(description="Up to 3 case studies, in the order the portfolio shows them")
    pillar_why: PillarWhy
    fixes: list[Fix] = Field(description="Exactly 3 fixes, the ones that would raise the score the most")
    strengths: list[str] = Field(description="Exactly 3 specific things already working")
    cant_see: str = Field(description="What couldn't be checked and how it was handled, or empty")


# ---------------------------------------------------------------------------
# Rubric
# ---------------------------------------------------------------------------

SYSTEM = """You are a senior designer at RPS (Rock Paper Scissors) who hires designers, reviewing a portfolio against the RPS Review Base v0.3.
Review it like a demanding hiring manager at a top product company or studio screening 200 portfolios for 5 interview slots. Scores must be hard to earn: most portfolios land between 25 and 55, 70 and up is one you would interview, 85 and up is one you would fight to hire.
You are tough and fair: your job is to show them what to work on before a real hiring manager sees it, not to make them feel good. Praise only what is genuinely strong.
Your reader is the designer. Write like a kind, honest mentor: plain words, second person, short sentences, no jargon, no hype.
Judge only what you can see in the screenshots and page text. Never invent projects, results, numbers or quotes.
Only say an image is broken if it is in the browser-verified "Images that failed to load" list; an empty box in a screenshot may just be loading.
Output must follow the JSON schema exactly."""

RUBRIC = """Score the portfolio with anchored levels. Every level is an integer: 3 Strong, 2 Good, 1 Needs work, 0 Missing.

HOW TO SCORE (Review Base v0.3 — strict)
- Start every dimension at 1. Move it to 2 only for evidence you can quote from the page. Move it to 3 only for evidence that would stand out in a stack of 200 portfolios at a top product company or studio.
- Write `evidence` before `levels`. For every 2 or 3, quote the exact words (or name the exact element you saw) that earn it. No quote, no 2. Generic evidence ("has a process section", "clean layout") earns nothing. Levels without evidence are lowered automatically.
- When torn between two levels, choose the lower one. Never round up for effort, for a student, for a nice site, or because the person is early in their career.
- Expect this spread across all portfolios: about half of all levels are 1, about 3 in 10 are 2, about 1 in 10 are 0, and fewer than 1 in 10 are 3. A report with more than three 3s needs truly exceptional work, quoted.
- Judge against the job, not the person: a student is scored against what gets students hired, with no extra credit; a Senior or Lead must show senior-scope work (systems, standards, impact on other people's work) or d2 and d7 stay at 1.
- Being present is not being good: a "Process" heading, a persona, a journey map, a metric or a "Results" heading earns credit only when it does the job its level describes.
- Polish never lifts thinking, and thinking never lifts polish.
- Concept, course or self-initiated projects must be labelled as such. Shown as if they were real client work: d3 at most 1 and say so. Unlabelled redesigns of famous apps, or generic concepts with no real constraints (food delivery, coffee shop, travel, fitness apps): d1 and d3 at most 1.

RED FLAGS — each one you see goes in `red_flags` and caps the level shown, whatever else is true
- A generic intro or headline ("passionate designer who loves solving problems", "Product Designer | UX | UI", "Hi, welcome to my portfolio"): d5 at most 1.
- You can't tell within 5 seconds what they design and for whom: d5 at most 1.
- More than about 6 projects with no clear lead, or off-target work (logos, posters, brochures in a product portfolio): d7 at most 1.
- The template is more polished than the work inside it; stock, generic 3D or AI-generated visuals standing in for real work; device mockups that shrink the UI until it can't be read; thumbnails that don't show the actual work: d8 at most 2 (at most 1 if the work itself is weak).
- Inconsistent type, spacing or image quality, or an untouched default template look: d8 at most 1.
- Walls of text before any work; process taking over the story (the double diamond as the main character); a case study over about 2,500 words with no summary: d9 at most 1.
- Repetitive, AI-sounding copy (the same rhythm and adjectives in every paragraph, buzzwords, no voice): d9 at most 1, and d2 at most 1 unless real decisions are visible anyway.
- The generic process template (research → personas → wireframes → UI) with no real decision explained: d2 at most 1. No alternative shown and no trade-off named anywhere: d2 at most 2.
- "Users loved it", "improved the experience" and other claims with no evidence: d3 at most 1. Test findings or qualitative evidence only: d3 at most 2.
- "We" throughout and never what this person did: d6 at most 1. Role stated but not what they owned: d6 at most 2.
- No reflection, or only "I learned a lot": d4 at most 1.
- A Senior, Staff or Lead title with only screen-level work: d7 at most 1.
- No visible way to contact them, browser-verified broken images or links, or text too faint to read: d10 at most 1.
- NDA work shown only as "Confidential — ask me about it": score that case's story dimensions at 0 or 1; credit thinking shown through a walkthrough, recreated screens with dummy data, or abstracted flows.
- Motion: a reel over about 90 seconds, a long logo or name intro, template or preset-driven animation, filler shots, or unlabelled work (no client, role or tools): d8 at most 1 for template work, d9 at most 1 otherwise.

WHAT HIRING MANAGERS REWARD NOW (2026)
- The first look is short: 65% of UX hiring managers spend under four minutes on it, and they scan before they read (UXfolio, State of UX Portfolios 2026). The problem, their role and the outcome must be findable without hunting.
- 89% say one relevant case study matters most; 64% value clear thinking and the key decisions behind the work. Visual quality is the top red flag (55%), then hard navigation (48%), obvious AI overuse (43%) and too long or dense (42%).
- A strong case study leads with impact, tells a story (problem, tension, decisions, ending), keeps process high-level, and is short, polished and scannable (Filippos Protogeridis, 150+ case studies reviewed in 2026). When impact can't be measured, expected metrics, strategic impact or test results still count.
- Show, don't tell: real, shipped products beat wireframes; clear ownership; scope that matches the title (Tom Scott, recruiter).
- A sharp niche beats a generic title; one problem per case study (Aneta Kmiecik).
- Decisions over deliverables: alternatives considered, constraints, the trade-off accepted and why. With AI making polished screens cheap, visible reasoning separates candidates.
- AI: credit it only when they show how they directed and judged the tool, and say where they used it. Screens that look generated, with no rationale, count against d2 and d8.
- Juniors are judged on potential and clear thinking; seniors on range of contexts and the maturity of their judgment.

CASE-STUDY DIMENSIONS (score each case study separately)
- d1 Problem framing (weight 12): 0 no problem stated. 1 vague, generic, or a solution posing as a problem ("design an app for X"). 2 specific: who has the problem, in what situation, and why it matters to them or the business. 3 specific and evidenced (data, observation, constraint), with the business stake and how success would be measured, stated up front.
- d2 Decisions and trade-offs (weight 18): 0 only final screens. 1 generic steps or artefacts with no reasons, or decisions asserted without a why. 2 at least two real decisions, each with its reason, and at least one alternative considered. 3 several decisions with alternatives compared visually, constraints and trade-offs named, and a change made because of evidence or feedback; a reader could defend the design in an interview from the page alone.
- d3 Evidence and outcome (weight 12): 0 no result. 1 claims, intentions or "next steps" only. 2 test findings with specifics (who, how many, what changed) or credible qualitative evidence. 3 a measured result with its baseline or context, or shipped with proof (live product, launch, adoption, client results).
- d4 Reflection (weight 6): 0 none. 1 generic. 2 specific lessons tied to this project. 3 specific lessons plus what they would change and what they would measure next.
- d6 Role and ownership (weight 10): 0 role not stated. 1 "we" throughout, or only a list of tools. 2 role and team stated. 3 role, team and timeline stated, and exactly which decisions and deliverables were theirs.
- d9 Communication and scannability (weight 8): 0 can't be skimmed (wall of text, or images only with no words). 1 long, dense or weak hierarchy. 2 clear headings and sections; the gist is found in about 2 minutes. 3 a summary up top (problem, role, outcome), headlines that tell the story on their own, captions on visuals; the gist lands in 30 seconds.

PORTFOLIO DIMENSIONS (score once for the whole site)
- d5 Positioning and first screen (weight 10): 0 can't tell who this is or what they do. 1 name only or a generic tagline. 2 role and specialism clear, with an obvious path to the work. 3 a sharp, specific positioning (who they design for or what they are best at), a reason to read on, and the lead work visible, all on the first screen.
- d7 Curation and range (weight 8): 0 no real projects. 1 too many, thin, off-target, or no lead project. 2 a relevant selection of 2 to 5 with a sensible lead. 3 a tight 3 to 5, all aimed at the target role, strongest first, a range of problems, and scope that matches the level claimed.
- d8 Visual and interaction craft (weight 12): 0 broken or amateur. 1 inconsistent, default-template, weak images or poor hierarchy. 2 clean, consistent and competent; most good portfolios stop here. 3 distinctive, art-director-level craft: considered type, spacing, imagery and interaction details a design lead would single out. A nice template is never 3.
- d10 Hygiene and access (weight 4): 0 broken links or unreadable. 1 noticeable problems (no visible contact, low-contrast text, browser-verified broken images). 2 works and contact is visible. Never 3: we can't check mobile or contrast.

CASE STUDIES
- `cases` lists up to 3 projects in the order the portfolio shows them. The first one counts most (50%), so get the order right.
- A project counts as a case study if it has its own page we opened (given below as "Case study N"), or if its whole story is told on the home page.
- A project shown only as a thumbnail or mockup with no story is still a case: score what is there (its story dimensions will be 0 or 1) and say so plainly in its `fix`.
- If the home page shows a "view case study" link we couldn't open, leave that project out and mention it in `cant_see` ("You didn't lose points for it.").
- If there are no projects at all, return an empty list.

FIXES
- Exactly 3, each raising a different dimension, chosen to raise the score the most: points gained = weight x (the share of the new level - the share of the old level), where a level earns 0, 15%, 50% or 100% of its weight for 0, 1, 2 or 3; for case dimensions that is multiplied by the case's share (first case 50%, second 30%, third 20% when there are 3; 60/40 when there are 2). The score is also held down until the portfolio shows: a problem, a role and a real decision somewhere (else at most 49); a real decision in the lead project and a result somewhere (else 59); a clear role in the lead project (else 64); two case studies (else 69); a measured or shipped result (else 74); a lead project with 3s for decisions and results (else 84). Prefer fixes that clear these.
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
- d9 Communication: the reel opens on its strongest shot (reviewers decide in about ten seconds), is edited tight (no
  filler, nothing repeated, ideally under 60 to 90 seconds), makes sense without sound, and the work is labelled
  (client, their role, tools).
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


def _earned(level: int, evidence: str, dim: str) -> int:
    """The level the quoted evidence can support. A 2 needs a real quote, a 3 a fuller one, and a
    3 for results (d3) needs a number or proof it shipped. Never raises a level."""
    ev = (evidence or "").strip()
    if level >= 2 and len(ev) < MIN_EVIDENCE_GOOD:
        return 1
    if level == 3 and len(ev) < MIN_EVIDENCE_STRONG:
        return 2
    if level == 3 and dim == "d3" and not SHIPPED_OR_MEASURED.search(ev):
        return 2
    return level


def normalise(r: RpsReport, cap: CaptureResult, model: str) -> dict:
    """Clamp levels to what their evidence supports and reshape into the object
    frontend/lib/review/sample.js computes on."""
    cases = []
    for c in r.cases[:MAX_CASES]:
        ev = c.evidence.model_dump()
        cases.append({
            "title": c.title.strip(),
            "kind": c.kind.strip() or "Kind not stated",
            "levels": {d: _earned(_lv(getattr(c.levels, d)), ev.get(d, ""), d) for d in CASE_DIMS},
            "evidence": {d: (ev.get(d) or "").strip() for d in CASE_DIMS},
            "good": c.good.strip(),
            "fix": c.fix.strip(),
        })
    pev = r.portfolio_evidence.model_dump()
    portfolio = {d: _earned(_lv(getattr(r.portfolio, d)), pev.get(d, ""), d) for d in PORTFOLIO_DIMS}
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
            fixes.append({**base, "portfolio": {dim: min(_lv(t), 2) if dim == "d10" else _lv(t)}})
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
        "portfolioEvidence": {d: (pev.get(d) or "").strip() for d in PORTFOLIO_DIMS},
        "redFlags": [s.strip() for s in r.red_flags if s.strip()][:8],
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
