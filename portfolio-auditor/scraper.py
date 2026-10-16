"""Playwright capture layer: render a portfolio page, detect Static vs Motion, grab visual evidence."""

from __future__ import annotations

import asyncio
import io
import os
import re
import shutil
import sys
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

from PIL import Image, ImageChops
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1280, "height": 800}
NAV_TIMEOUT_MS = 30_000
IDLE_TIMEOUT_MS = 15_000
MAX_SCROLL_STEPS = 30
MAX_FULLPAGE_HEIGHT = 9_000  # px; longer pages are cropped before being sent to the model
FULLPAGE_OUTPUT_WIDTH = 960
BURST_FRAMES = 4
BURST_INTERVAL_S = 1.0
SCROLL_JOURNEY_STEP = 480  # px per wheel step (60% of the viewport)
SCROLL_JOURNEY_MAX_STEPS = 40
SCROLL_SETTLE_MS = 700  # let scroll-triggered animations finish before each shot
MAX_SCROLL_FRAMES = 8  # each frame is ~520 input tokens; 8 keeps a review within Rs 1
FRAME_DIFF_THRESHOLD = 2.0  # mean pixel difference (0-255) below which two frames count as the same

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)

MOTION_KEYWORDS = [
    "motion design", "motion graphics", "animation", "animated", "showreel", "show reel",
    "demo reel", "reel", "3d", "cgi", "vfx", "render", "explainer", "title sequence", "kinetic",
]

# Words that, in a title/tag/heading, mark the page as motion work on their own.
STRONG_MOTION_KEYWORDS = [
    "motion", "motion design", "motion graphics", "animation", "showreel", "show reel", "demo reel",
    "reel", "3d", "cgi", "vfx", "title sequence",
]

KNOWN_TOOLS = [
    "After Effects", "Premiere Pro", "Cinema 4D", "C4D", "Blender", "Houdini", "Maya", "3ds Max",
    "Redshift", "Octane", "Arnold", "Unreal Engine", "Unity", "DaVinci Resolve", "Nuke",
    "Element 3D", "Trapcode", "Spline", "Rive", "Lottie", "Figma", "Sketch", "Adobe XD",
    "Photoshop", "Illustrator", "InDesign", "Procreate", "Framer", "Webflow", "Principle",
    "ProtoPie", "Substance Painter", "ZBrush", "Marvelous Designer", "Midjourney", "Stable Diffusion",
]

CREDIT_PATTERN = re.compile(
    r"^(?:credits?|director|art direction|animation|animator|design(?:ed)? by|sound(?: design)?|"
    r"music|3d|modeling|producer|client|agency|studio|typography|illustration)\b.{0,120}$",
    re.IGNORECASE,
)

COOKIE_BUTTON_TEXT = re.compile(
    r"^(accept( all)?( cookies)?|allow all|agree|i agree|got it|ok(ay)?|continue)$", re.IGNORECASE
)

# Runs in the page: counts media signals and pulls the readable text.
PAGE_PROBE_JS = r"""
() => {
  const motionHost = /(vimeo\.com|youtube\.com|youtu\.be|youtube-nocookie\.com|behance\.net\/.*(video|embed)|adobe\.io|player\.|wistia|loom\.com|streamable)/i;
  const iframes = [...document.querySelectorAll('iframe')];
  const motionIframes = iframes.filter(f => motionHost.test(f.src || f.dataset.src || ''));
  const videos = [...document.querySelectorAll('video')].filter(v => {
    const r = v.getBoundingClientRect();
    return r.width >= 200 && r.height >= 120;
  });
  const canvases = [...document.querySelectorAll('canvas')].filter(c => {
    const r = c.getBoundingClientRect();
    return r.width >= 300 && r.height >= 200;
  });
  const imgs = [...document.querySelectorAll('img')];
  const srcOf = i => (i.currentSrc || i.src || '').toLowerCase();
  const gifs = imgs.filter(i => /\.gif(\?|$)/.test(srcOf(i)));
  const largeImages = imgs.filter(i => i.naturalWidth >= 400 && i.naturalHeight >= 250 && !/\.gif(\?|$)/.test(srcOf(i)));
  const lottie = document.querySelectorAll('lottie-player, dotlottie-player, [data-animation-path]').length;
  const pick = sel => [...document.querySelectorAll(sel)]
      .map(e => (e.innerText || '').trim().replace(/\s+/g, ' '))
      .filter(t => t.length > 1 && t.length < 200);
  const metaDesc = (document.querySelector('meta[name="description"]') || {}).content
      || (document.querySelector('meta[property="og:description"]') || {}).content || '';
  const tagEls = [...document.querySelectorAll('a[href*="/search/projects?field"], a[href*="tools"], [class*="tag" i] a, [class*="Tag" i]')];
  return {
    title: document.title || '',
    meta_description: metaDesc,
    h1: pick('h1').slice(0, 5),
    h2: pick('h2').slice(0, 15),
    h3: pick('h3').slice(0, 15),
    tags: [...new Set(tagEls.map(e => (e.innerText || '').trim()).filter(t => t && t.length < 40))].slice(0, 40),
    body_text: (document.body ? document.body.innerText : '').slice(0, 20000),
    counts: {
      videos: videos.length,
      motion_iframes: motionIframes.length,
      other_iframes: iframes.length - motionIframes.length,
      canvases: canvases.length,
      gifs: gifs.length,
      lottie: lottie,
      large_images: largeImages.length,
    },
    page_height: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight),
  };
}
"""


# Marks elements that are invisible at load (candidates for scroll-reveal animations).
MARK_HIDDEN_JS = r"""
() => {
  let n = 0;
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) continue;
    const cs = getComputedStyle(e);
    if (cs.opacity === '0' || cs.visibility === 'hidden') { e.setAttribute('data-pa-hidden', ''); n++; }
  }
  return n;
}
"""

# Counts marked elements that have since become visible (i.e. were revealed by scrolling).
COUNT_REVEALED_JS = r"""
() => {
  for (const e of document.querySelectorAll('[data-pa-hidden]:not([data-pa-revealed])')) {
    const cs = getComputedStyle(e);
    if (parseFloat(cs.opacity) > 0.1 && cs.visibility !== 'hidden') e.setAttribute('data-pa-revealed', '');
  }
  return document.querySelectorAll('[data-pa-revealed]').length;
}
"""

# Finds scroll-pinned sections: a tall sticky panel inside a much taller scroll track (CSS sticky
# or GSAP ScrollTrigger pin-spacers). Returns [top, height] of each track.
PINNED_SECTIONS_JS = r"""
() => {
  const out = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    const isPinSpacer = e.classList.contains('pin-spacer');
    if (cs.position !== 'sticky' && !isPinSpacer) continue;
    const h = e.getBoundingClientRect().height;
    const track = isPinSpacer ? e : e.parentElement;
    if (!track || h < innerHeight * 0.5) continue;
    const tr = track.getBoundingClientRect();
    if (isPinSpacer || tr.height >= h * 1.8) out.push([Math.round(tr.top + scrollY), Math.round(tr.height)]);
  }
  return out;
}
"""


# Ranks the links on a portfolio home page by how likely they are to open a case study.
# Returns [{href, text, score, order}] best first; same-site (or Behance project) links only.
CASE_LINKS_JS = r"""
() => {
  const here = new URL(location.href);
  const skip = /(about|archive|contact|resume|cv|blog|privacy|terms|login|signin|sign-in|signup|careers|jobs|cookie|faq|pricing|shop|cart|tag|category|search|feed|rss|\.pdf$|\.(png|jpe?g|gif|zip)$)/i;
  const caseWords = /(case stud|view project|view case|read (the )?case|see project|full project|explore project|learn more)/i;
  const out = new Map();
  [...document.querySelectorAll('a[href]')].forEach((a, order) => {
    let u;
    try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
    if (!/^https?:$/.test(u.protocol)) return;
    u.hash = '';
    const href = u.href.replace(/\/$/, '');
    if (href === here.href.replace(/#.*$/, '').replace(/\/$/, '')) return;
    const behanceProject = /behance\.net\/gallery\/\d+/i.test(href);
    const sameSite = u.hostname.replace(/^www\./, '') === here.hostname.replace(/^www\./, '');
    if (!sameSite && !behanceProject) return;
    if (u.pathname === '/' || skip.test(u.pathname)) return;
    const r = a.getBoundingClientRect();
    const text = (a.innerText || a.getAttribute('aria-label') || a.title || '').trim().replace(/\s+/g, ' ');
    let score = 0;
    if (behanceProject) score += 6;
    if (a.querySelector('img, picture, video, [style*="background-image"]')) score += 3;
    if (caseWords.test(text)) score += 4;
    if (r.width * r.height > 60000) score += 2;
    if (/\/(work|works|project|projects|case-stud(y|ies)|portfolio)\//i.test(u.pathname + '/')) score += 3;
    if (a.closest('nav, header, footer')) score -= 4;
    if (score <= 0) return;
    const prev = out.get(href);
    if (!prev || score > prev.score) out.set(href, { href, text: text.slice(0, 80), score, order: prev ? prev.order : order });
  });
  return [...out.values()].sort((a, b) => b.score - a.score || a.order - b.order);
}
"""

# Case-study pages get a smaller capture budget than the home page.
CASE_STUDY_FRAMES = 4
CASE_STUDY_STEPS = 12
CASE_STUDY_TEXT_CHARS = 5000


@dataclass
class CasePage:
    url: str
    title: str
    text_excerpt: str
    frames: list[bytes] = field(default_factory=list)
    positions: list[int] = field(default_factory=list)
    # Frames from the project's main video, when it has one.
    motion_frames: list[bytes] = field(default_factory=list)


# Waits (bounded) for the images currently in the viewport to finish loading, so a screenshot
# never shows a still-loading image as an empty box or its alt text.
WAIT_VISIBLE_IMAGES_JS = r"""
async (ms) => {
  const vis = [...document.images].filter(i => {
    const r = i.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  const pending = vis.filter(i => !i.complete).map(i => new Promise(res => {
    i.addEventListener('load', res, { once: true });
    i.addEventListener('error', res, { once: true });
  }));
  await Promise.race([Promise.all(pending), new Promise(res => setTimeout(res, ms))]);
}
"""

# Images the browser finished trying to load and couldn't: the only evidence of a "broken image".
BROKEN_IMAGES_JS = r"""
() => [...document.images]
  .filter(i => i.complete && i.naturalWidth === 0 && (i.currentSrc || i.getAttribute('src')))
  .map(i => (i.alt || i.currentSrc || i.getAttribute('src') || '').slice(0, 80))
"""


class ScrapeError(Exception):
    """Raised when a page cannot be captured at all (bad URL, DNS failure, browser missing...)."""


@dataclass
class CaptureResult:
    url: str
    final_url: str
    mode: str  # "STATIC" | "MOTION"
    mode_reason: str
    signals: dict
    title: str
    meta_description: str
    headings: list[str]
    text_excerpt: str
    tools: list[str]
    credits: list[str]
    hero_png: bytes
    fullpage_png: bytes | None = None
    frames: list[bytes] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    elapsed_s: float = 0.0
    # Viewport screenshots taken while scrolling like a visitor; these show pinned/scroll-driven
    # sections that a full-page screenshot renders blank.
    scroll_frames: list[bytes] = field(default_factory=list)
    scroll_positions: list[int] = field(default_factory=list)
    motion_notes: list[str] = field(default_factory=list)
    # Alt text (or URL) of images that failed to load, as the browser reports it.
    broken_images: list[str] = field(default_factory=list)
    # Case-study pages opened from the home page (only when capture_portfolio(case_studies=N)).
    case_pages: list[CasePage] = field(default_factory=list)


BEHANCE_HOSTS = ("behance.net", "be.net")


def is_behance(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return any(host == h or host.endswith("." + h) for h in BEHANCE_HOSTS)


def validate_portfolio_url(raw: str) -> str:
    """The main link: any public portfolio — a website, Behance, Dribbble, Notion, a reel page.
    Behance profiles work too: their project links are opened as case studies."""
    return validate_url(raw)


def validate_url(raw: str) -> str:
    """Normalise and validate a user-supplied URL. Returns the cleaned URL or raises ValueError."""
    url = (raw or "").strip()
    if not url:
        raise ValueError("Please enter a URL.")
    if not re.match(r"^https?://", url, re.IGNORECASE):
        url = "https://" + url
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme not in ("http", "https") or not host:
        raise ValueError("That doesn't look like a valid web address.")
    if host in ("localhost",) or host.startswith("127.") or host.endswith(".local"):
        raise ValueError("Local addresses can't be audited. Use a public portfolio URL.")
    if "." not in host:
        raise ValueError("The URL needs a full domain, e.g. yourname.com.")
    return url


def _keyword_hits(text: str, keywords: list[str]) -> list[str]:
    text = text.lower()
    return sorted({k for k in keywords if re.search(rf"\b{re.escape(k)}\b", text)})


def classify_mode(signals: dict, text: str, tags: list[str], title_and_headings: str = "") -> tuple[str, str]:
    """Decide STATIC vs MOTION from DOM media counts and keywords.

    Title, tags and headings are a strong signal on their own (a project titled "Showreel 2024"
    is motion work even if the player hasn't loaded). Body text keywords only count alongside media."""
    c = signals
    motion_media = c["videos"] + c["motion_iframes"]
    motion_score = motion_media * 3 + c["canvases"] + c["gifs"] + c["lottie"]
    static_score = c["large_images"]

    strong_hits = _keyword_hits(" ".join(tags) + " " + title_and_headings, STRONG_MOTION_KEYWORDS)
    keyword_hits = _keyword_hits(" ".join(tags) + " " + text[:6000], MOTION_KEYWORDS)

    if strong_hits:
        return "MOTION", f"Title/tags/headings mention {', '.join(strong_hits[:4])}"
    if motion_media >= 1 and keyword_hits:
        return "MOTION", f"{motion_media} video/embed player(s) plus motion keywords ({', '.join(keyword_hits[:4])})"
    if motion_score >= 3 and motion_score >= static_score * 0.5:
        return "MOTION", f"Video/animated media dominates (motion score {motion_score} vs {static_score} still images)"
    if len(keyword_hits) >= 3 and motion_score >= 1:
        return "MOTION", f"Strong motion keywords ({', '.join(keyword_hits[:4])}) with animated media present"
    return "STATIC", f"Mostly still imagery ({static_score} large images, motion score {motion_score})"


def extract_tools(text: str, tags: list[str]) -> list[str]:
    haystack = text + "\n" + "\n".join(tags)
    found = []
    for tool in KNOWN_TOOLS:
        if re.search(rf"(?<![\w]){re.escape(tool)}(?![\w])", haystack, re.IGNORECASE):
            found.append(tool)
    if "C4D" in found and "Cinema 4D" in found:
        found.remove("C4D")
    return found


def extract_credits(text: str) -> list[str]:
    lines = [ln.strip() for ln in text.splitlines()]
    credits = [ln for ln in lines if ln and CREDIT_PATTERN.match(ln)]
    return list(dict.fromkeys(credits))[:12]


def _shrink_png(png: bytes, max_height: int = MAX_FULLPAGE_HEIGHT, width: int = FULLPAGE_OUTPUT_WIDTH) -> bytes:
    img = Image.open(io.BytesIO(png))
    if img.height > max_height:
        img = img.crop((0, 0, img.width, max_height))
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def _dismiss_overlays(page) -> None:
    """Best effort: click common cookie / consent buttons so they don't cover the screenshot."""
    try:
        buttons = page.get_by_role("button", name=COOKIE_BUTTON_TEXT)
        for i in range(min(buttons.count(), 3)):
            btn = buttons.nth(i)
            if btn.is_visible():
                btn.click(timeout=1500)
                page.wait_for_timeout(400)
                return
    except PlaywrightError:
        pass


def _frame_diff(a: bytes, b: bytes) -> float:
    """Mean absolute pixel difference (0-255) between two screenshots, on small greyscale thumbnails."""
    ia = Image.open(io.BytesIO(a)).convert("L").resize((160, 100))
    ib = Image.open(io.BytesIO(b)).convert("L").resize((160, 100))
    hist = ImageChops.difference(ia, ib).histogram()
    return sum(i * n for i, n in enumerate(hist)) / (160 * 100)


def _progressive_scroll(page) -> int:
    """Scroll down one viewport at a time so lazy-loaded images and embeds get requested.
    Returns how many initially hidden elements were revealed along the way."""
    step = VIEWPORT["height"] - 100
    last_height = 0
    revealed = 0
    for _ in range(MAX_SCROLL_STEPS):
        page.mouse.wheel(0, step)
        page.wait_for_timeout(350)
        revealed = page.evaluate(COUNT_REVEALED_JS)
        y, height = page.evaluate("() => [window.scrollY + window.innerHeight, document.documentElement.scrollHeight]")
        if y >= height - 5:
            if height == last_height:
                break
            last_height = height
            page.wait_for_timeout(800)  # give infinite-scroll / lazy content a moment
    try:
        page.wait_for_load_state("networkidle", timeout=5_000)
    except PlaywrightTimeout:
        pass
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(600)
    return revealed


def _scroll_journey(
    page, max_frames: int = MAX_SCROLL_FRAMES, max_steps: int = SCROLL_JOURNEY_MAX_STEPS
) -> tuple[list[bytes], list[int]]:
    """Scroll from the top like a visitor (mouse wheel, so smooth-scroll libraries and scroll-linked
    animations react), screenshotting the viewport at each step. Near-duplicate frames are dropped,
    so pinned 'scrollytelling' sections yield one frame per state rather than one per step."""
    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(500)
    height = page.evaluate("() => document.documentElement.scrollHeight")
    step = max(SCROLL_JOURNEY_STEP, height // max_steps)

    frames: list[bytes] = []
    positions: list[int] = []
    last_y = -1
    for _ in range(max_steps + 1):
        y = page.evaluate("() => Math.round(window.scrollY)")
        if y == last_y:
            break  # reached the bottom
        last_y = y
        try:
            page.evaluate(WAIT_VISIBLE_IMAGES_JS, 2500)
        except PlaywrightError:
            pass
        png = page.screenshot(timeout=10_000)
        if not frames or _frame_diff(frames[-1], png) >= FRAME_DIFF_THRESHOLD:
            frames.append(png)
            positions.append(y)
        page.mouse.wheel(0, step)
        page.wait_for_timeout(SCROLL_SETTLE_MS)

    if len(frames) > max_frames:  # keep first and last, sample evenly in between
        idx = [round(i * (len(frames) - 1) / (max_frames - 1)) for i in range(max_frames)]
        frames = [frames[i] for i in idx]
        positions = [positions[i] for i in idx]

    page.evaluate("() => window.scrollTo(0, 0)")
    page.wait_for_timeout(500)
    return [_shrink_png(f, max_height=VIEWPORT["height"], width=1024) for f in frames], positions


def _capture_case_page(context, href: str, title_hint: str = "") -> CasePage | None:
    """Open one case-study page and capture its scroll frames and text. None when the page is
    an empty shell or blocked. Raises PlaywrightError if it can't be opened at all."""
    page = context.new_page()
    try:
        page.goto(href, wait_until="domcontentloaded", timeout=20_000)
        try:
            page.wait_for_load_state("networkidle", timeout=8_000)
        except PlaywrightTimeout:
            pass
        _dismiss_overlays(page)
        frames, positions = _scroll_journey(page, max_frames=CASE_STUDY_FRAMES, max_steps=CASE_STUDY_STEPS)
        text = page.evaluate("() => document.body ? document.body.innerText : ''")
        if len(text.strip()) < 200 and not page.locator("img").count() and not page.locator("video").count():
            return None
        # A motion project: a few frames of its main video, across its length.
        motion: list[bytes] = []
        vids = page.locator("video")
        for i in range(min(vids.count(), 3)):
            v = vids.nth(i)
            try:
                box = v.bounding_box()
            except PlaywrightError:
                box = None
            if box and box["width"] >= 300:
                v.scroll_into_view_if_needed(timeout=3000)
                motion = _sample_video(page, v)[:6]
                break
        return CasePage(
            motion_frames=motion,
            url=page.url,
            title=(page.title() or title_hint).strip()[:120],
            text_excerpt=re.sub(r"\n{3,}", "\n\n", text)[:CASE_STUDY_TEXT_CHARS],
            frames=frames,
            positions=positions,
        )
    finally:
        page.close()


def _capture_extra_cases(context, urls: list[str], warnings: list[str]) -> list[CasePage]:
    """Case studies the person added themselves (e.g. a Behance project). Best effort: Behance
    often blocks automated browsers, and then the review goes ahead on the website alone."""
    pages: list[CasePage] = []
    for href in urls:
        try:
            case = _capture_case_page(context, href, "Your added case study")
        except PlaywrightError:
            case = None
        if case:
            pages.append(case)
        else:
            warnings.append(
                f"Couldn't open the case study you added ({href}); it may be blocking automated "
                "browsers. The review is based on your website."
            )
    return pages


def _capture_case_studies(context, home_page, limit: int, warnings: list[str]) -> list[CasePage]:
    """Open up to `limit` case-study links found on the home page and capture each one's text
    and a few scroll frames. Pages that fail to load are skipped, not fatal."""
    # The strongest candidates, then put back in page order: the first case study a visitor
    # meets is the one the RPS rubric weights most.
    links = home_page.evaluate(CASE_LINKS_JS)
    strong = sorted([l for l in links if l["score"] >= 3][: limit * 2], key=lambda l: l["order"])
    pages: list[CasePage] = []
    for link in strong:
        if len(pages) >= limit:
            break
        page = context.new_page()
        try:
            page.goto(link["href"], wait_until="domcontentloaded", timeout=20_000)
            try:
                page.wait_for_load_state("networkidle", timeout=8_000)
            except PlaywrightTimeout:
                pass
            _dismiss_overlays(page)
            # One pass does double duty: scrolling for the frames also triggers lazy content,
            # so the text is read afterwards.
            frames, positions = _scroll_journey(page, max_frames=CASE_STUDY_FRAMES, max_steps=CASE_STUDY_STEPS)
            text = page.evaluate("() => document.body ? document.body.innerText : ''")
            if len(text.strip()) < 200 and not page.locator("img").count():
                continue  # empty shell or blocked page: nothing to judge
            pages.append(
                CasePage(
                    url=page.url,
                    title=(page.title() or link["text"]).strip()[:120],
                    text_excerpt=re.sub(r"\n{3,}", "\n\n", text)[:CASE_STUDY_TEXT_CHARS],
                    frames=frames,
                    positions=positions,
                )
            )
        except PlaywrightError:
            warnings.append(f"Couldn't open the case study at {link['href']}; skipped it.")
        finally:
            page.close()
    return pages


def _has_ambient_motion(page) -> bool:
    """True if the above-the-fold view changes on its own (looping hero animation, marquee, canvas...)."""
    first = page.screenshot(timeout=10_000)
    page.wait_for_timeout(1200)
    return _frame_diff(first, page.screenshot(timeout=10_000)) >= 0.5


MOTION_SPREAD_FRAMES = 10  # across the whole reel: pacing, structure, cut rhythm
MOTION_BURST_FRAMES = 6  # a quarter-second apart: easing and spacing
MOTION_BURST_STEP_S = 0.25
MOTION_FRAME_WIDTH = 640  # sent to the model at low resolution to keep the cost down


def _sample_video(page, target) -> list[bytes]:
    """Frame-by-frame from a real <video>: seek to evenly spaced points across its whole length,
    then a short burst at one point. Empty if the element isn't a seekable video."""
    try:
        duration = target.evaluate(
            """async (v) => {
                if (v.tagName !== 'VIDEO') return 0;
                v.muted = true; v.pause();
                if (!(v.duration > 0) || !isFinite(v.duration)) {
                    await new Promise(r => { v.addEventListener('loadedmetadata', r, { once: true }); setTimeout(r, 4000); });
                }
                return isFinite(v.duration) ? v.duration : 0;
            }"""
        )
    except PlaywrightError:
        return []
    if not duration or duration < 1:
        return []

    seek = """async ([v, t]) => {
        await new Promise(r => { const done = () => r(); v.addEventListener('seeked', done, { once: true });
            v.currentTime = t; setTimeout(done, 2500); });
    }"""
    frames: list[bytes] = []
    try:
        handle = target.element_handle()
        for i in range(MOTION_SPREAD_FRAMES):
            t = duration * (0.04 + 0.92 * i / max(1, MOTION_SPREAD_FRAMES - 1))
            page.evaluate(seek, [handle, t])
            frames.append(_shrink_png(target.screenshot(timeout=5000), max_height=1200, width=MOTION_FRAME_WIDTH))
        start = duration * 0.3
        for i in range(MOTION_BURST_FRAMES):
            page.evaluate(seek, [handle, min(duration - 0.05, start + i * MOTION_BURST_STEP_S)])
            frames.append(_shrink_png(target.screenshot(timeout=5000), max_height=1200, width=MOTION_FRAME_WIDTH))
    except PlaywrightError:
        pass
    return frames


def _capture_motion_frames(page, warnings: list[str]) -> list[bytes]:
    """Find the main video / player and capture it frame by frame: spread across a real video's
    whole length plus a fast burst, or — for embedded players that can't be scrubbed — a longer
    burst while it plays."""
    target = None
    for selector in ("video", "iframe[src*='vimeo'], iframe[src*='youtube'], iframe[src*='youtu'], iframe[src*='behance']", "canvas"):
        loc = page.locator(selector)
        for i in range(min(loc.count(), 6)):
            el = loc.nth(i)
            try:
                box = el.bounding_box()
            except PlaywrightError:
                box = None
            if box and box["width"] >= 300 and box["height"] >= 160:
                target = el
                break
        if target:
            break

    if target is None:
        warnings.append("No playable media element found; captured viewport frames instead.")
    else:
        try:
            target.scroll_into_view_if_needed(timeout=3000)
            page.wait_for_timeout(800)
        except PlaywrightError:
            pass
        # Kick <video> elements into playback (muted autoplay is allowed headless).
        page.evaluate(
            "() => document.querySelectorAll('video').forEach(v => { v.muted = true; v.loop = true; v.play().catch(() => {}); })"
        )
        # For iframe players, a click on the centre usually starts playback.
        try:
            tag = target.evaluate("el => el.tagName")
            if tag == "IFRAME":
                target.click(timeout=2000)
                page.wait_for_timeout(1500)
        except PlaywrightError:
            pass

    if target is not None:
        sampled = _sample_video(page, target)
        if sampled:
            return sampled

    # Embedded players (Vimeo, YouTube, Behance) can't be scrubbed: watch a few seconds.
    frames: list[bytes] = []
    for i in range(MOTION_SPREAD_FRAMES):
        try:
            png = target.screenshot(timeout=5000) if target is not None else page.screenshot(timeout=5000)
        except PlaywrightError:
            png = page.screenshot(timeout=5000)
        frames.append(_shrink_png(png, max_height=1200, width=MOTION_FRAME_WIDTH))
        if i < MOTION_SPREAD_FRAMES - 1:
            time.sleep(0.6)
    return frames


def _launch_browser(p):
    args = ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"]
    try:
        return p.chromium.launch(headless=True, args=args)
    except PlaywrightError as exc:
        # Hugging Face / Debian fallback: use the distro Chromium from packages.txt.
        for candidate in ("/usr/bin/chromium", "/usr/bin/chromium-browser", shutil.which("chromium") or ""):
            if candidate and os.path.exists(candidate):
                return p.chromium.launch(headless=True, args=args, executable_path=candidate)
        raise ScrapeError(
            "Chromium isn't installed for Playwright. Run `python -m playwright install chromium` and try again."
        ) from exc


def _capture(
    url: str, force_mode: str | None, case_studies: int = 0, on_progress=None, extra_cases: list[str] | None = None
) -> CaptureResult:
    started = time.time()
    progress = on_progress or (lambda stage: None)
    warnings: list[str] = []

    with sync_playwright() as p:
        browser = _launch_browser(p)
        try:
            context = browser.new_context(
                viewport=VIEWPORT, user_agent=USER_AGENT, device_scale_factor=1, locale="en-US"
            )
            context.set_default_timeout(NAV_TIMEOUT_MS)
            page = context.new_page()

            try:
                response = page.goto(url, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            except PlaywrightTimeout:
                warnings.append("Page took longer than 30 s to respond; captured whatever had loaded.")
                response = None
            except PlaywrightError as exc:
                msg = str(exc).split("\n")[0]
                if "ERR_NAME_NOT_RESOLVED" in msg:
                    raise ScrapeError("That domain couldn't be found. Check the URL for typos.") from exc
                if "ERR_CONNECTION" in msg or "ERR_ADDRESS" in msg:
                    raise ScrapeError("Couldn't connect to that site. It may be down or blocking automated browsers.") from exc
                raise ScrapeError(f"The browser couldn't open that page: {msg}") from exc

            # 401/403/429 are often bot-protection responses that still render the page, so only
            # treat them as a problem if the page turns out to be nearly empty (checked below).
            soft_block_status = None
            if response is not None and response.status >= 400:
                if response.status in (401, 403, 429):
                    soft_block_status = response.status
                else:
                    raise ScrapeError(f"The page returned HTTP {response.status}. Is the portfolio public?")

            try:
                page.wait_for_load_state("networkidle", timeout=IDLE_TIMEOUT_MS)
            except PlaywrightTimeout:
                warnings.append("Page kept loading background requests; continued after 15 s.")

            progress("scrolling")
            _dismiss_overlays(page)
            hidden_at_load = page.evaluate(MARK_HIDDEN_JS)
            revealed = _progressive_scroll(page)
            _dismiss_overlays(page)

            probe = page.evaluate(PAGE_PROBE_JS)
            broken_images = page.evaluate(BROKEN_IMAGES_JS)
            signals = probe["counts"]
            pinned = page.evaluate(PINNED_SECTIONS_JS)
            ambient = _has_ambient_motion(page)
            signals.update(
                pinned_sections=len(pinned), scroll_reveals=revealed, hidden_at_load=hidden_at_load, ambient_motion=ambient
            )
            motion_notes = []
            for top, h in pinned:
                motion_notes.append(
                    f"Scroll-pinned section at y={top:,}px: {h:,}px of scrolling drives one sticky panel (scrollytelling)"
                )
            if revealed:
                motion_notes.append(f"{revealed} elements animate in on scroll (reveal / fade-in)")
            if ambient:
                motion_notes.append("Above-the-fold view animates on its own (looping hero motion)")
            body_text = probe["body_text"]
            if soft_block_status and len(body_text.strip()) < 300:
                # A "403 Forbidden" page isn't a portfolio. Stop here: reviewing it would score the
                # error page, spend a Gemini call, and use up the person's one free review.
                raise ScrapeError(
                    f"Your site turned our reviewer away (HTTP {soft_block_status}), so there was nothing to review. "
                    "If it's behind a password or bot protection, make it public and try again — this didn't use up "
                    "your free review."
                )

            if force_mode in ("STATIC", "MOTION"):
                mode, reason = force_mode, "Mode set manually"
            else:
                mode, reason = classify_mode(
                    signals, body_text, probe["tags"], " ".join([probe["title"], *probe["h1"], *probe["h2"]])
                )

            hero_png = page.screenshot(timeout=10_000)

            fullpage_png = None
            try:
                fullpage_png = _shrink_png(page.screenshot(full_page=True, timeout=20_000))
            except PlaywrightError:
                warnings.append("Full-page screenshot failed; the review relies on the scroll frames.")

            scroll_frames, scroll_positions = _scroll_journey(page)
            case_pages = []
            extra_cases = extra_cases or []
            if case_studies or extra_cases:
                progress("case_studies")
            # The site's own case studies first, in the order it shows them; the one the person
            # added comes after, and the total stays within the limit.
            if case_studies:
                case_pages = _capture_case_studies(
                    context, page, max(0, case_studies - len(extra_cases)) or case_studies, warnings
                )
            if extra_cases:
                case_pages += _capture_extra_cases(context, extra_cases, warnings)
                if case_studies:
                    case_pages = case_pages[: max(case_studies, len(extra_cases))]

            frames: list[bytes] = []
            if mode == "MOTION":
                frames = _capture_motion_frames(page, warnings)

            headings = list(dict.fromkeys(probe["h1"] + probe["h2"] + probe["h3"]))[:25]
            return CaptureResult(
                url=url,
                final_url=page.url,
                mode=mode,
                mode_reason=reason,
                signals=signals,
                title=probe["title"].strip(),
                meta_description=(probe["meta_description"] or "").strip(),
                headings=headings,
                text_excerpt=re.sub(r"\n{3,}", "\n\n", body_text)[:6000],
                tools=extract_tools(body_text, probe["tags"]),
                credits=extract_credits(body_text),
                hero_png=hero_png,
                fullpage_png=fullpage_png,
                frames=frames,
                warnings=warnings,
                elapsed_s=round(time.time() - started, 1),
                scroll_frames=scroll_frames,
                scroll_positions=scroll_positions,
                motion_notes=motion_notes,
                case_pages=case_pages,
                broken_images=broken_images,
            )
        finally:
            browser.close()


def capture_portfolio(
    url: str, force_mode: str | None = None, case_studies: int = 0, on_progress=None,
    extra_cases: list[str] | None = None,
) -> CaptureResult:
    """Capture a portfolio page. Runs Playwright in its own thread so it never collides
    with Streamlit's event loop (and so Windows gets a subprocess-capable Proactor loop)."""
    url = validate_url(url)
    box: dict = {}

    def worker():
        if sys.platform == "win32":
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        try:
            box["result"] = _capture(url, force_mode, case_studies, on_progress, extra_cases)
        except BaseException as exc:  # re-raised in the caller's thread
            box["error"] = exc

    t = threading.Thread(target=worker, daemon=True)
    t.start()
    t.join()
    if "error" in box:
        err = box["error"]
        if isinstance(err, (ScrapeError, ValueError)):
            raise err
        raise ScrapeError(f"Unexpected capture failure: {err}") from err
    return box["result"]


if __name__ == "__main__":
    # Quick CLI check: python scraper.py https://example.com
    target = sys.argv[1] if len(sys.argv) > 1 else "https://example.com"
    res = capture_portfolio(target)
    print(f"mode={res.mode} ({res.mode_reason})")
    print(f"title={res.title!r} signals={res.signals}")
    print(f"tools={res.tools} frames={len(res.frames)} warnings={res.warnings} time={res.elapsed_s}s")
