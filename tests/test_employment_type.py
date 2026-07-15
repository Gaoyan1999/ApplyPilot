import pytest

from applypilot.employment_type import (
    classify_job_type,
    classify_native_job_type,
    classify_title_job_type,
)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("fulltime", "full_time"),
        ("parttime", "unknown"),
        ("internship", "intern"),
        ("contract", "contract"),
        ("temporary", "contract"),
        ("perdiem", "contract"),
        ("volunteer", "unknown"),
        ("other", "unknown"),
        ("nights", "unknown"),
        ("summer", "intern"),
        ("parttime, contract", "contract"),
        ("Full time", "full_time"),
        ("Part time", "unknown"),
        ("FULL_TIME", "full_time"),
        ("CONTRACTOR", "contract"),
        ("INTERN", "intern"),
        ("TEMPORARY", "contract"),
        ("PER_DIEM", "contract"),
    ],
)
def test_classify_native_job_type_maps_known_tokens(raw, expected):
    assert classify_native_job_type(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "   "])
def test_classify_native_job_type_returns_none_when_missing(raw):
    assert classify_native_job_type(raw) is None


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Software Engineering Intern", "intern"),
        ("Summer 2026 Internship", "intern"),
        ("Contract Recruiter", "contract"),
        ("Co-op Student, Data", "intern"),
        ("Senior Backend Engineer", "unknown"),
        (None, "unknown"),
        ("", "unknown"),
    ],
)
def test_classify_title_job_type_fallback(title, expected):
    assert classify_title_job_type(title) == expected


def test_classify_job_type_native_wins_even_when_unknown():
    """The critical precedence case: a native signal that maps to 'unknown'
    must NOT fall through to the title fallback, even if the title has an
    obvious keyword."""
    assert classify_job_type(native="part_time", title="Marketing Intern") == "unknown"


def test_classify_job_type_falls_back_to_title_when_native_absent():
    assert classify_job_type(native=None, title="Marketing Intern") == "intern"


def test_classify_job_type_prefers_native_over_title():
    assert classify_job_type(native="fulltime", title="Marketing Intern") == "full_time"
