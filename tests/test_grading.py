import pytest

from applypilot import config
from applypilot.database import grade_from_score, score_from_grade
from applypilot.scoring.scorer import _parse_score_response

OLD_SCORING_SEED = """SCORING CRITERIA:
- 9-10: Perfect match. Candidate has direct experience in nearly all required skills and qualifications.
- 7-8: Strong match. Candidate has most required skills, minor gaps easily bridged.
- 5-6: Moderate match. Candidate has some relevant skills but missing key requirements.
- 3-4: Weak match. Significant skill gaps, would need substantial ramp-up.
- 1-2: Poor match. Completely different field or experience level.

IMPORTANT FACTORS:
- Weight technical skills heavily (programming languages, frameworks, tools)
- Consider transferable experience (automation, scripting, API work)
- Factor in the candidate's project experience
- Be realistic about experience level vs. job requirements (years of experience, seniority)

ELIGIBILITY IS A HARD GATE: If the job posting states a citizenship, PR, security clearance, or work-authorization requirement (e.g. "must be an Australian/NZ citizen or PR holder"), check it against the CANDIDATE PROFILE section. If the candidate doesn't meet it, cap the score at 1-2 regardless of skill match, and name the eligibility gap as the reasoning -- don't let a strong resume mask a hard disqualifier the candidate can't fix by applying."""


@pytest.mark.parametrize(
    "line, expected",
    [
        ("GRADE: GREEN", "green"),
        ("GRADE: yellow", "yellow"),
        ("GRADE: [RED]", "red"),
        ("GRADE: 8", None),
        ("GRADE:", None),
    ],
)
def test_parse_grade(line, expected):
    assert _parse_score_response(f"{line}\nKEYWORDS: python")["grade"] == expected


def test_parse_full_response():
    response = (
        "GRADE: YELLOW\n"
        "KEYWORDS: Python, AWS\n"
        "CRITERIA:\n"
        "MET | Python backend\n"
        "GAP | No Kubernetes\n"
    )
    assert _parse_score_response(response) == {
        "grade": "yellow",
        "keywords": "Python, AWS",
        "met": ["Python backend"],
        "gaps": ["No Kubernetes"],
    }


def test_missing_grade_line_is_none():
    assert _parse_score_response("SCORE: 8")["grade"] is None


@pytest.mark.parametrize("grade", ["green", "yellow", "red"])
def test_score_from_grade_stays_in_band(grade):
    assert grade_from_score(score_from_grade(grade)) == grade


def test_score_from_grade_none():
    assert score_from_grade(None) == 0


@pytest.fixture
def prompts_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PROMPTS_DIR", tmp_path)
    return tmp_path


def test_unedited_old_scoring_prompt_is_upgraded(prompts_dir):
    (prompts_dir / "scoring.md").write_text(OLD_SCORING_SEED + "\n", encoding="utf-8")
    prompts = config.load_prompts()
    assert prompts["scoring"] == config.get_prompt_seed("scoring")
    assert "GREEN" in (prompts_dir / "scoring.md").read_text(encoding="utf-8")


def test_edited_scoring_prompt_is_kept(prompts_dir):
    edited = OLD_SCORING_SEED + "\n- My own extra rule"
    (prompts_dir / "scoring.md").write_text(edited, encoding="utf-8")
    assert config.load_prompts()["scoring"] == edited


@pytest.fixture
def graded_db(tmp_path):
    from applypilot.database import close_connection, init_db

    path = tmp_path / "jobs.db"
    conn = init_db(path)
    conn.executemany(
        "INSERT INTO jobs (url, title, fit_score, fit_grade, discovered_at) VALUES (?, ?, ?, ?, ?)",
        [
            ("u/red", "red", 2, "red", "2026-10-01T00:00:00"),
            ("u/green7", "green7", 7, "green", "2026-10-02T00:00:00"),
            ("u/none", "none", None, None, "2026-10-03T00:00:00"),
            ("u/yellow", "yellow", 5, "yellow", "2026-10-04T00:00:00"),
            ("u/green9", "green9", 9, "green", "2026-10-05T00:00:00"),
        ],
    )
    conn.commit()
    yield conn
    close_connection(path)


def _titles(rows):
    return [r["title"] for r in rows]


def test_search_filters_by_grade(graded_db):
    from applypilot.database import search_jobs

    rows, total = search_jobs(graded_db, fit_grade=["green", "ungraded"], sort_by="title", sort_dir="asc")
    assert total == 3
    assert _titles(rows) == ["green7", "green9", "none"]

    rows, total = search_jobs(graded_db, fit_grade=["green"], fit_grade_mode="is_not", sort_by="title", sort_dir="asc")
    assert _titles(rows) == ["none", "red", "yellow"]


def test_search_sorts_by_grade_rank_then_score(graded_db):
    from applypilot.database import search_jobs

    rows, _ = search_jobs(graded_db, sort_by="fit_grade", sort_dir="desc")
    assert _titles(rows) == ["green9", "green7", "yellow", "red", "none"]

    rows, _ = search_jobs(graded_db, sort_by="fit_grade", sort_dir="asc")
    assert _titles(rows) == ["red", "yellow", "green7", "green9", "none"]
