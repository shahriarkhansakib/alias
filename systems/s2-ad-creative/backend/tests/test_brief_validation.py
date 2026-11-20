import pytest
from app.services.payload_gate import payload_gate_service
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF


def test_valid_smartfit_brief():
    res = payload_gate_service.validate_brief(SMARTFIT_X1_DEMO_BRIEF)
    assert res.is_valid is True
    assert res.status in ("PASS", "WARNING")
    assert len(res.report.errors) == 0
    assert res.validated_payload is not None
    assert res.validated_payload["product"]["name"] == "SmartFit X1"


def test_missing_required_fields():
    # Missing product name and brand
    broken_brief = {
        "product": {"offer": {"price": 100}},
        "campaign": {"platforms": ["instagram"]},
    }
    res = payload_gate_service.validate_brief(broken_brief)
    assert res.is_valid is False
    assert res.status == "FAIL"
    assert len(res.report.errors) > 0


def test_negative_price():
    brief = dict(SMARTFIT_X1_DEMO_BRIEF)
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "product": {
            **SMARTFIT_X1_DEMO_BRIEF["product"],
            "offer": {
                **SMARTFIT_X1_DEMO_BRIEF["product"]["offer"],
                "price": -50.0,
            },
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"
    assert any("greater than or equal to 0" in err for err in res.report.errors)


def test_invalid_platform():
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "campaign": {
            **SMARTFIT_X1_DEMO_BRIEF["campaign"],
            "platforms": ["instagram", "tiktok_unsupported"],
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"


def test_invalid_brand_hex_color():
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "brand": {
            **SMARTFIT_X1_DEMO_BRIEF["brand"],
            "colors": ["not-a-hex", "#111827"],
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"
    assert any("Invalid hex color format" in err for err in res.report.errors)


def test_excessively_long_strings():
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "product": {
            **SMARTFIT_X1_DEMO_BRIEF["product"],
            "name": "A" * 200,  # Max allowed is 150
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"


def test_invalid_discount_percentage():
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "product": {
            **SMARTFIT_X1_DEMO_BRIEF["product"],
            "offer": {
                **SMARTFIT_X1_DEMO_BRIEF["product"]["offer"],
                "discount_percent": 150.0,  # Max 100
            },
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"


def test_inconsistent_offer_data():
    # original_price lower than selling price
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "product": {
            **SMARTFIT_X1_DEMO_BRIEF["product"],
            "offer": {
                "price": 5000.0,
                "original_price": 3000.0,  # Inconsistent: original is lower
                "currency": "USD",
            },
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"
    assert any("Original price" in err for err in res.report.errors)


def test_duplicate_platforms():
    brief = {
        **SMARTFIT_X1_DEMO_BRIEF,
        "campaign": {
            **SMARTFIT_X1_DEMO_BRIEF["campaign"],
            "platforms": ["instagram", "facebook", "instagram"],
        },
    }
    res = payload_gate_service.validate_brief(brief)
    assert res.is_valid is False
    assert res.status == "FAIL"
    assert any("Duplicate platforms" in err for err in res.report.errors)
