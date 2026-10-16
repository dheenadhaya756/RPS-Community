"""Gemini review engine: rubric prompts, structured output, and score normalisation."""

from __future__ import annotations

import json
import os
import time

import httpx
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field, ValidationError

from scraper import CaptureResult

# gemini-2.5-flash is no longer offered to new API keys; Google points to gemini-3.8-flash.
# If the primary model is retired (404) or overloaded (5xx), the next model in the chain is tried.
# Cost first: one RPS review has to stay within about Rs 0.50-1. Flash-Lite does that; the
# fallbacks are the other Lite models, so an outage never silently moves a review onto a model
# that costs several times more. Override with GEMINI_MODEL.
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
REQUEST_TIMEOUT_MS = 150_000
MODEL_CHAIN = list(dict.fromkeys([MODEL, "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"]))

# Output (which includes thinking) is the expensive half, so both are capped.
MAX_OUTPUT_TOKENS = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "6000"))
THINKING_LEVEL = os.getenv("GEMINI_THINKING_LEVEL", "medium")  # Gemini 3 models: think before scoring
THINKING_BUDGET = int(os.getenv("GEMINI_THINKING_BUDGET", "512"))  # Gemini 2.5 models

# USD per 1M tokens (input, output incl. thinking), paid tier, from
# ai.google.dev/gemini-api/docs/pricing (checked Oct 2026). Used only to report each review's cost.
PRICES_USD_PER_M = {
    "gemini-3.1-flash-lite": (0.25, 1.50),
    "gemini-2.5-flash-lite": (0.10, 0.40),
    "gemini-3.5-flash-lite": (0.30, 2.50),
    "gemini-3.8-flash": (0.75, 3.75),
    "gemini-3.6-flash": (0.75, 3.75),
    "gemini-2.5-flash": (0.30, 2.50),
}
USD_TO_INR = float(os.getenv("USD_TO_INR", "88"))


def cost_of(model: str, usage) -> dict:
    """Tokens and money for one Gemini call, from the usage the API itself reports."""
    prompt = getattr(usage, "prompt_token_count", 0) or 0
    out = (getattr(usage, "candidates_token_count", 0) or 0) + (getattr(usage, "thoughts_token_count", 0) or 0)
    price_in, price_out = PRICES_USD_PER_M.get(model, (0.0, 0.0))
    usd = prompt / 1e6 * price_in + out / 1e6 * price_out
    return {
        "model": model,
        "inputTokens": prompt,
        "outputTokens": out,
        "usd": round(usd, 5),
        "inr": round(usd * USD_TO_INR, 2),
        "priced": model in PRICES_USD_PER_M,
    }


def _config_for(model: str, system: str, schema) -> types.GenerateContentConfig:
    if model.startswith("gemini-3"):
        thinking = types.ThinkingConfig(thinking_level=THINKING_LEVEL)
    else:
        thinking = types.ThinkingConfig(thinking_budget=THINKING_BUDGET)
    return types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0.4,
        max_output_tokens=MAX_OUTPUT_TOKENS,
        thinking_config=thinking,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
    )


class QuotaExceededError(Exception):
    """Gemini returned HTTP 429 (free-tier rate or daily limit)."""


class AnalyzerError(Exception):
    """Any other failure talking to Gemini or parsing its answer."""


# ---------------------------------------------------------------------------
# Structured output schema (shared by both rubrics; prompts fix titles/labels)
# ---------------------------------------------------------------------------

class Score(BaseModel):
    label: str = Field(description="Exact score label from the rubric")
    value: float = Field(description="Score from 0 to 10, one decimal allowed")
    rationale: str = Field(description="One sentence justifying the score with visible evidence")


class Section(BaseModel):
    title: str = Field(description="Exact section title from the rubric")
    rating: float = Field(description="0-10 rating for this section")
    verdict: str = Field(description="2-3 sentence assessment referencing what is visible")
    strengths: list[str] = Field(description="1-3 specific strengths")
    issues: list[str] = Field(description="1-4 specific problems, each tied to a visible element")


class ActionItem(BaseModel):
    priority: int = Field(description="1 = most important")
    title: str = Field(description="Imperative, under 10 words")
    why: str = Field(description="What is wrong now and the cost to the designer")
    how: str = Field(description="Concrete steps; name exact elements, values, or techniques")
    effort: str = Field(description="One of: Low, Medium, High")
    impact: str = Field(description="One of: Low, Medium, High")


class Review(BaseModel):
    headline: str = Field(description="A one-line verdict, under 15 words")
    executive_summary: str = Field(description="3-4 sentences: who this designer appears to be, the biggest strength, the biggest risk")
    detected_role: str = Field(description="The role a recruiter would infer in 5 seconds, e.g. 'Product Designer (B2B SaaS)'")
    overall_score: float = Field(description="0-10 overall score")
    scores: list[Score]
    sections: list[Section]
    action_items: list[ActionItem]


# ---------------------------------------------------------------------------
# Rubrics
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a senior design director who has hired designers at top product companies and studios.
You review portfolios the way a busy hiring manager does: fast first impression, then a careful look at craft and thinking.

Rules:
- Base every claim on what is visible in the screenshots/frames or present in the extracted text. Never invent projects, clients, or metrics.
- Be specific: name the element ("the hero headline", "the 3rd project card", "the grey body copy on white") and, where useful, suggest concrete values (sizes, spacing, contrast ratios, durations, easing curves).
- Be candid but constructive. Praise only what is genuinely strong.
- Calibrate scores: 5 = competent but forgettable, 7 = would get an interview at a good company, 9+ = exceptional, top 1%. Do not inflate.
- If the capture looks broken (blank areas, cookie wall, login wall, bot block), say so in the summary and score only what you can see.
- Only call an image broken if it appears in the browser-verified "Images that failed to load" list; an empty box in a screenshot may just be loading.
- Output must follow the JSON schema exactly."""

STATIC_RUBRIC = """Evaluate this as a STATIC design portfolio (UI/UX, product, graphic, or branding).

You get: the above-the-fold view at 1280x800 (use it for the 5-second test); "Scroll frames" - the viewport captured in order while scrolling like a visitor (these are the ground truth for what a visitor sees, including pinned/scroll-animated sections); and, only if scroll frames are unavailable, a full-page screenshot.

Produce exactly these {n_sections} `sections`, in this order, with these exact titles:
1. "First Impressions" - The 5-second test: is the designer's role, specialism, and level clear above the fold? Is there a clear path to the work? Does the hero earn attention?
2. "Visual Craft" - Typography (scale, pairing, line length, hierarchy), grid and alignment, whitespace and rhythm, colour and contrast (flag likely WCAG AA failures), image quality and consistency of project thumbnails.
3. "Case Study Depth" - Is there a problem statement, the designer's specific role, process (research, iterations, trade-offs), and business or user impact with outcomes? If only thumbnails are visible, judge what the page promises and say what is missing.
4. "Usability & Navigation" - Navigation clarity, scannability, CTA/contact visibility, how fast a recruiter can find the 2-3 best projects.{motion_section}

Produce exactly these three `scores`, in this order, with these exact labels: "Visual Craft", "Storytelling", "Usability".

Produce exactly 3 `action_items` - the Top 3 Actionable Fixes, ordered by impact on getting hired."""

MOTION_RUBRIC = """Evaluate this as a MOTION DESIGN / ANIMATION / 3D portfolio.

You get: the above-the-fold page view; "Frame 1..4" captured from the main video/player (or viewport) 1 second apart - compare them to infer pacing, cut frequency, camera movement, and how elements move between frames; "Scroll frames" showing the page in order as a visitor scrolls (including any scroll-driven animation).
You cannot hear audio and you only see sampled frames: state your confidence where it matters, and infer motion qualities (easing, weight, momentum) from motion blur, element displacement between frames, composition changes, and staging.

Produce exactly these five `sections`, in this order, with these exact titles:
1. "Rhythm & Pacing" - Does the edit hold attention? Cut frequency, hook in the first seconds, variety of shot lengths, build and release.
2. "Easing & Physics" - Natural weight, overshoot, follow-through and momentum vs. linear or default keyframes; consistency of the motion language.
3. "Visual Hierarchy in Motion" - Where the eye goes during cuts and transitions; focal-point continuity; clarity of the key message per shot.
4. "Technical Execution" - Lighting, materials, render polish (noise, aliasing, banding), compositing, typography integration and legibility in motion.
5. "Presentation & Context" - How the page frames the work: reel placement, project titles, role/credits, tools listed, breakdowns, contact path.

Produce exactly these three `scores`, in this order, with these exact labels: "Pacing", "Easing/Fluidity", "Technical Polish".

Produce exactly 3 `action_items` - the Top 3 Motion Tweaks that would most increase perceived production value."""

# Added to the static rubric when the page has scroll-driven or ambient motion.
STATIC_MOTION_SECTION = """
5. "Interaction & Motion" - The page's own motion design, judged from the scroll frames and the detected motion signals: do scroll reveals, pinned/stacked sections and hero animation guide attention to the work and support the story, or slow the recruiter down? Comment on sequencing and pacing across scroll, transition clarity between states (cards mid-transition in the frames are evidence), consistency of the motion language, scroll length vs. content payoff, and accessibility (prefers-reduced-motion, content reachable without long scrolling)."""

STATIC_SECTIONS = ["First Impressions", "Visual Craft", "Case Study Depth", "Usability & Navigation"]
STATIC_SCORES = ["Visual Craft", "Storytelling", "Usability"]
MOTION_SECTIONS = ["Rhythm & Pacing", "Easing & Physics", "Visual Hierarchy in Motion", "Technical Execution", "Presentation & Context"]
MOTION_SCORES = ["Pacing", "Easing/Fluidity", "Technical Polish"]


def _context_block(cap: CaptureResult) -> str:
    lines = [
        f"URL: {cap.final_url}",
        f"Page title: {cap.title or '(none)'}",
        f"Meta description: {cap.meta_description or '(none)'}",
        f"Detected mode: {cap.mode} - {cap.mode_reason}",
        f"Media signals: {json.dumps(cap.signals)}",
    ]
    if cap.headings:
        lines.append("Headings: " + " | ".join(cap.headings))
    if cap.tools:
        lines.append("Tools mentioned: " + ", ".join(cap.tools))
    if cap.credits:
        lines.append("Credits found: " + " | ".join(cap.credits))
    if cap.motion_notes:
        lines.append("Detected page motion: " + " | ".join(cap.motion_notes))
    lines.append(
        "Images that failed to load (browser-verified): "
        + (", ".join(cap.broken_images[:15]) if cap.broken_images else "none")
    )
    if cap.warnings:
        lines.append("Capture warnings: " + " | ".join(cap.warnings))
    lines.append("\nVisible page text (truncated):\n" + cap.text_excerpt[:4500])
    return "\n".join(lines)


HIGH_DETAIL = types.PartMediaResolutionLevel.MEDIA_RESOLUTION_HIGH  # ~1,090 tokens per image
SCROLL_DETAIL = types.PartMediaResolutionLevel.MEDIA_RESOLUTION_MEDIUM  # ~520 tokens per image
MOTION_DETAIL = types.PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW  # motion frames: many, cheap


def image_part(png: bytes, level) -> types.Part:
    return types.Part.from_bytes(data=png, mime_type="image/png", media_resolution={"level": level})


def _build_contents(cap: CaptureResult) -> list:
    if cap.mode == "MOTION":
        rubric = MOTION_RUBRIC
    elif cap.motion_notes:
        rubric = STATIC_RUBRIC.format(n_sections="five", motion_section=STATIC_MOTION_SECTION)
    else:
        rubric = STATIC_RUBRIC.format(n_sections="four", motion_section="")
    # Token budget: every image costs a flat amount set by its media resolution, not its pixel size.
    # The hero (5-second test, typography) and video frames (render polish) keep full detail;
    # scroll frames only need layout and sequence, so medium detail halves their cost.
    parts: list = [rubric, "Above the fold:", image_part(cap.hero_png, HIGH_DETAIL)]
    if cap.mode == "MOTION":
        for i, frame in enumerate(cap.frames, start=1):
            parts += [f"Frame {i} (t={i - 1}s):", image_part(frame, HIGH_DETAIL)]
    total = len(cap.scroll_frames)
    for i, (frame, y) in enumerate(zip(cap.scroll_frames, cap.scroll_positions), start=1):
        parts += [f"Scroll frame {i}/{total} (scrolled to y={y}px):", image_part(frame, SCROLL_DETAIL)]
    # The scroll frames already cover the whole page, so the full-page shot is only a fallback.
    if cap.fullpage_png and not cap.scroll_frames:
        parts += ["Full page:", image_part(cap.fullpage_png, HIGH_DETAIL)]
    parts.append("Page context:\n" + _context_block(cap))
    return parts


def _clamp(v: float) -> float:
    try:
        return round(max(0.0, min(10.0, float(v))), 1)
    except (TypeError, ValueError):
        return 0.0


def _normalise(review: Review, mode: str, model: str = MODEL) -> dict:
    """Clamp numbers, order items, and make sure the expected labels exist."""
    data = review.model_dump()
    expected_scores = MOTION_SCORES if mode == "MOTION" else STATIC_SCORES

    by_label = {s["label"].strip().lower(): s for s in data["scores"]}
    scores = []
    for label in expected_scores:
        s = by_label.get(label.lower())
        if s is None:
            # Fall back to positional match if the model paraphrased a label.
            idx = expected_scores.index(label)
            s = data["scores"][idx] if idx < len(data["scores"]) else {"value": 0, "rationale": "Not scored."}
        scores.append({"label": label, "value": _clamp(s["value"]), "rationale": s.get("rationale", "")})
    data["scores"] = scores

    for sec in data["sections"]:
        sec["rating"] = _clamp(sec["rating"])
    data["overall_score"] = _clamp(data["overall_score"])

    items = sorted(data["action_items"], key=lambda a: a.get("priority", 99))[:3]
    for i, item in enumerate(items, start=1):
        item["priority"] = i
        for key in ("effort", "impact"):
            val = str(item.get(key, "")).strip().capitalize()
            item[key] = val if val in ("Low", "Medium", "High") else "Medium"
    data["action_items"] = items
    data["mode"] = mode
    data["model"] = model
    return data


def _call_gemini(
    api_key: str, contents: list, schema: type[BaseModel] = Review, system: str = SYSTEM_PROMPT,
    usage_out: dict | None = None,
) -> tuple[BaseModel, str]:
    """Returns the parsed `schema` instance and the model that produced it."""
    # Without a timeout, a request to an overloaded model can hang indefinitely.
    client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_MS))
    calls: list[dict] = []  # every billed call, including retries, so the cost is the real one

    last_exc: Exception | None = None
    overloaded = False
    for model in MODEL_CHAIN:
        for attempt in range(2):
            try:
                resp = client.models.generate_content(
                    model=model, contents=contents, config=_config_for(model, system, schema)
                )
                if getattr(resp, "usage_metadata", None) is not None:
                    calls.append(cost_of(model, resp.usage_metadata))
                    if usage_out is not None:
                        usage_out["calls"] = calls
            except httpx.TimeoutException as exc:
                last_exc = exc
                overloaded = True
                break  # this model is too slow right now: next model
            except errors.APIError as exc:
                code = getattr(exc, "code", None)
                last_exc = exc
                if code == 429:
                    raise QuotaExceededError(str(exc)) from exc
                if code in (400, 401, 403) and "API key" in str(exc):
                    raise AnalyzerError("The Gemini API key was rejected. Check that it's correct and active.") from exc
                if code == 404:
                    break  # model retired or not offered to this key: next model
                if code in (500, 502, 503, 504):
                    overloaded = True
                    if attempt == 0:
                        time.sleep(3)  # brief back-off, then one retry before moving on
                    continue
                raise AnalyzerError(f"Gemini API error ({code}): {getattr(exc, 'message', exc)}") from exc

            if isinstance(resp.parsed, schema):
                return resp.parsed, model
            try:
                return schema.model_validate(json.loads(resp.text or "")), model
            except (json.JSONDecodeError, ValidationError) as exc:
                last_exc = exc  # malformed JSON: retry

    if overloaded:
        raise AnalyzerError(
            "Gemini is experiencing high demand right now (HTTP 503). This is usually temporary; try again in a minute."
        )
    raise AnalyzerError(f"Gemini didn't return a usable review: {last_exc}")


def call_with_keys(
    api_keys: list[str], contents: list, schema: type[BaseModel] = Review, system: str = SYSTEM_PROMPT,
    usage_out: dict | None = None,
) -> tuple[BaseModel, str]:
    """Try each key in order; a 429 on one key falls through to the next."""
    keys = [k.strip() for k in api_keys if k and k.strip()]
    if not keys:
        raise AnalyzerError(
            "No Gemini API key configured. Add GEMINI_API_KEY to your .env file, "
            "or paste a free key from aistudio.google.com in the API key field."
        )
    for i, key in enumerate(keys):
        try:
            return _call_gemini(key, contents, schema, system, usage_out)
        except QuotaExceededError:
            if i == len(keys) - 1:
                raise
    raise AnalyzerError("Unreachable")


def analyze(cap: CaptureResult, api_keys: list[str]) -> dict:
    """Run the review. `api_keys` is tried in order; a 429 on one key falls through to the next."""
    review, model = call_with_keys(api_keys, _build_contents(cap))
    return _normalise(review, cap.mode, model)


def review_to_markdown(review: dict, cap_meta: dict) -> str:
    """Render a review as a portable Markdown report for download."""
    out = [
        f"# Portfolio Audit: {cap_meta.get('title') or cap_meta.get('url')}",
        f"**URL:** {cap_meta.get('url')}  ",
        f"**Mode:** {'Motion Design' if review['mode'] == 'MOTION' else 'Static UI/UX'}  ",
        f"**Overall:** {review['overall_score']}/10  ",
        f"**Perceived role:** {review['detected_role']}",
        "",
        f"> {review['headline']}",
        "",
        "## Executive summary",
        review["executive_summary"],
        "",
        "## Scores",
    ]
    out += [f"- **{s['label']}: {s['value']}/10** - {s['rationale']}" for s in review["scores"]]
    for sec in review["sections"]:
        out += ["", f"## {sec['title']} ({sec['rating']}/10)", sec["verdict"], "", "**Strengths**"]
        out += [f"- {x}" for x in sec["strengths"]]
        out += ["", "**Issues**"]
        out += [f"- {x}" for x in sec["issues"]]
    out += ["", "## Top 3 action items"]
    for a in review["action_items"]:
        out += [
            f"### {a['priority']}. {a['title']}  (Impact: {a['impact']}, Effort: {a['effort']})",
            f"**Why:** {a['why']}",
            "",
            f"**How:** {a['how']}",
            "",
        ]
    return "\n".join(out)
