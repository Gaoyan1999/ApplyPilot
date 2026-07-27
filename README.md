<!-- logo here -->

> **⚠️ ApplyPilot** is the original open-source project, created by [Pickle-Pixel](https://github.com/Pickle-Pixel) and first published on GitHub on **February 17, 2026**. We are **not affiliated** with applypilot.app, useapplypilot.com, or any other product using the "ApplyPilot" name.

# ApplyPilot

**An autonomous job application pipeline with a web dashboard to search, review, and manage every job it finds.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE)

This project is forked from [Pickle-Pixel/ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot).

---

## What It Does

ApplyPilot **collects** jobs from job boards, **evaluates** (scores) each one against your resume with AI, and **tracks progress** through the whole pipeline — all from a local web dashboard.

## Web Dashboard Features

- **Search jobs** across LinkedIn, Indeed, and other job boards
- **AI scoring** of every job against your resume
- **Generate cover letters** and tailored resumes per job
- **Auto-submit applications** (in testing)
- **Track progress** — see the stage and status of every job at a glance
- **Light/dark theme**, with your filters and layout saved locally

---

## Setup

**Requirements:** Python 3.11+, Node.js, and an LLM API key (Gemini is free — get one at [aistudio.google.com](https://aistudio.google.com); OpenAI and local models also supported). Claude Code CLI and Chrome are only needed for auto-apply.

### 1. Get the code

```bash
git clone https://github.com/Gaoyan1999/ApplyPilot.git
cd ApplyPilot
```

### 2. Provide your info

Create a virtual environment with Python 3.11+ first — `applypilot` won't install (or won't be found on your `PATH`) under an older system Python:

```bash
python3.11 -m venv .venv
source .venv/bin/activate   # run this again in any new terminal session
```

Then install and run the setup wizard:

```bash
pip install -e .
pip install --no-deps python-jobspy && pip install pydantic tls-client requests markdownify regex
applypilot init
```

> `python-jobspy` (needed to search LinkedIn/Indeed) pins a numpy version that conflicts with pip's resolver, so it's installed separately with `--no-deps`.

`init` walks you through your resume, profile, and LLM API key, then generates your `profile.json`, `searches.yaml`, and `.env`.

### 3. Set up the frontend and backend

```bash
cd webapp && npm install && npm run build && cd ..
```

This builds the web dashboard once. The backend (FastAPI) is already installed from step 2 and serves the built frontend directly — no separate frontend server needed.

### 4. Use the web page

```bash
applypilot serve
```

Opens the dashboard at `http://127.0.0.1:8420`, where you can run searches, review jobs, and track progress.

### Auto-apply (optional, requires Claude Code CLI)

```bash
applypilot apply           # autonomous browser-driven submission
applypilot apply --dry-run # fill forms without submitting
```

---

## License

ApplyPilot is licensed under the [GNU Affero General Public License v3.0](LICENSE).

You are free to use, modify, and distribute this software. If you deploy a modified version as a service, you must release your source code under the same license.
