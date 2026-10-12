import sqlite3

import pytest

from applypilot.database import (
    backfill_fit_grade,
    close_connection,
    grade_from_score,
    init_db,
)

SCORES = [None, 0, 1, 4, 5, 6, 7, 10]

EXPECTED = [
    (None, None),
    (0, None),
    (1, "red"),
    (4, "red"),
    (5, "yellow"),
    (6, "yellow"),
    (7, "green"),
    (10, "green"),
]


@pytest.mark.parametrize(
    "score, expected",
    [
        (None, None),
        (0, None),
        (1, "red"),
        (4, "red"),
        (5, "yellow"),
        (6, "yellow"),
        (7, "green"),
        (10, "green"),
    ],
)
def test_grade_from_score_boundaries(score, expected):
    assert grade_from_score(score) == expected


@pytest.fixture
def legacy_db(tmp_path):
    """A DB created before fit_grade existed: jobs table with fit_score only."""
    path = tmp_path / "legacy.db"
    raw = sqlite3.connect(path)
    raw.execute("CREATE TABLE jobs (url TEXT PRIMARY KEY, title TEXT, fit_score INTEGER)")
    raw.executemany(
        "INSERT INTO jobs (url, title, fit_score) VALUES (?, ?, ?)",
        [(f"https://example.com/{i}", f"job {i}", s) for i, s in enumerate(SCORES)],
    )
    raw.commit()
    raw.close()
    yield path
    close_connection(path)


def _grades(conn):
    rows = conn.execute("SELECT fit_score, fit_grade FROM jobs ORDER BY url").fetchall()
    return [(r["fit_score"], r["fit_grade"]) for r in rows]


def test_init_db_adds_and_backfills_fit_grade(legacy_db):
    conn = init_db(legacy_db)

    cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    assert "fit_grade" in cols
    assert _grades(conn) == EXPECTED


def test_backfill_is_idempotent_and_keeps_fit_score(legacy_db):
    conn = init_db(legacy_db)
    assert _grades(conn) == EXPECTED

    assert backfill_fit_grade(conn) == 0
    assert _grades(conn) == EXPECTED

    # Re-running init_db (every startup) must not change anything either.
    conn = init_db(legacy_db)
    assert _grades(conn) == EXPECTED


def test_backfill_does_not_overwrite_existing_grade(legacy_db):
    conn = init_db(legacy_db)
    conn.execute("UPDATE jobs SET fit_grade = 'yellow' WHERE fit_score = 10")
    conn.commit()

    backfill_fit_grade(conn)

    row = conn.execute("SELECT fit_grade FROM jobs WHERE fit_score = 10").fetchone()
    assert row["fit_grade"] == "yellow"


def test_new_db_has_fit_grade_column(tmp_path):
    path = tmp_path / "new.db"
    try:
        conn = init_db(path)
        cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
        assert "fit_grade" in cols
    finally:
        close_connection(path)
