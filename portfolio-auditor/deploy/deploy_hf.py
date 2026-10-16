"""Put the review engine on a free Hugging Face Docker Space.

    python -c "from huggingface_hub import login; login()"   # once, paste a WRITE token
    python deploy/deploy_hf.py          # creates or updates the Space, uploads, sets secrets

Uploads only the engine's code (never .env, the database or screenshots), and stores
GEMINI_API_KEY (read from portfolio-auditor/.env) and AUDITOR_TOKEN as private Space secrets.
Prints the address to put in Vercel as AUDITOR_URL.
"""
import os
import secrets
import sys
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent.parent
SPACE_NAME = os.getenv("SPACE_NAME", "rps-portfolio-review")
FILES = ["Dockerfile", ".dockerignore", "README.md", "requirements.txt",
         "analyzer.py", "scraper.py", "rps_review.py", "rps_api.py"]


def env_value(name):
    for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        if line.startswith(name + "="):
            return line.split("=", 1)[1].strip().strip('"')
    return ""


def main():
    api = HfApi()
    user = api.whoami()["name"]
    repo = f"{user}/{SPACE_NAME}"
    gemini = os.getenv("GEMINI_API_KEY") or env_value("GEMINI_API_KEY") or env_value("GOOGLE_API_KEY")
    if not gemini:
        sys.exit("No GEMINI_API_KEY in portfolio-auditor/.env")
    token = os.getenv("AUDITOR_TOKEN") or secrets.token_urlsafe(32)

    api.create_repo(repo, repo_type="space", space_sdk="docker", private=False, exist_ok=True)
    for f in FILES:
        api.upload_file(path_or_fileobj=str(HERE / f), path_in_repo=f, repo_id=repo, repo_type="space")
    api.add_space_secret(repo, "GEMINI_API_KEY", gemini)
    api.add_space_secret(repo, "AUDITOR_TOKEN", token)

    url = f"https://{user.lower()}-{SPACE_NAME}.hf.space"
    print("\nSpace:        https://huggingface.co/spaces/" + repo)
    print("AUDITOR_URL   " + url)
    print("AUDITOR_TOKEN " + token)
    print("\nIt builds for ~5-10 minutes. Then check " + url + "/health")


if __name__ == "__main__":
    main()
