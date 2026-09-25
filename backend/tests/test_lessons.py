"""Tests for app.services.lessons (Task 1 of the antiscam plan)."""

from __future__ import annotations

from app.services.lessons import all_lessons, lessons_for

EXPECTED_IDS = {
    "urgency",
    "credential_request",
    "money_request",
    "prize",
    "brand_impersonation",
    "suspicious_link",
    "impersonal_greeting",
    "fake_domain",
    "hidden_link",
    "insecure_site",
    "risky_streaming",
    "malicious_site",
    "malicious_ads",
    "hidden_code",
    "unsafe_forms",
}


def _word_count(text: str) -> int:
    return len(text.split())


def test_every_expected_id_exists_exactly_once() -> None:
    lessons = all_lessons()
    ids = [lesson.id for lesson in lessons]
    assert set(ids) == EXPECTED_IDS
    assert len(ids) == len(set(ids))


def test_every_field_is_non_empty() -> None:
    for lesson in all_lessons():
        assert lesson.id
        assert lesson.icon
        assert lesson.title
        assert lesson.how_to_spot
        assert lesson.example
        assert lesson.what_to_do


def test_lessons_are_short_enough() -> None:
    for lesson in all_lessons():
        total_words = _word_count(lesson.how_to_spot) + _word_count(lesson.what_to_do)
        assert total_words <= 60, f"{lesson.id} has {total_words} words"


def test_lessons_for_dedupes_and_keeps_catalog_order() -> None:
    result = lessons_for(["prize", "urgency", "prize", "credential_request"])
    assert [lesson.id for lesson in result] == ["urgency", "credential_request", "prize"]


def test_lessons_for_unknown_id_is_ignored() -> None:
    assert lessons_for(["not_a_real_id"]) == []
