import pytest
from unittest.mock import patch
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF, generate_demo_smartwatch_png


@pytest.mark.asyncio
async def test_api_brief_validate_success(client):
    response = await client.post("/api/v1/briefs/validate", json=SMARTFIT_X1_DEMO_BRIEF)
    assert response.status_code == 200
    data = response.json()
    assert data["is_valid"] is True
    assert data["status"] in ("PASS", "WARNING")
    assert data["report"]["gate_name"] == "Payload Gate"
    assert "validated_payload" in data


@pytest.mark.asyncio
async def test_api_brief_validate_failure(client):
    broken_payload = {
        "brand": {"name": ""},  # empty name
        "product": {"name": "Watch", "offer": {"price": -10}},
        "campaign": {"platforms": []},
    }
    response = await client.post("/api/v1/briefs/validate", json=broken_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["is_valid"] is False
    assert data["status"] == "FAIL"
    assert len(data["report"]["errors"]) > 0


@pytest.mark.asyncio
async def test_api_get_demo_brief(client):
    response = await client.get("/api/v1/briefs/demo")
    assert response.status_code == 200
    data = response.json()
    assert data["product"]["name"] == "SmartFit X1"
    assert data["brand"]["name"] == "SmartFit"
    assert len(data["campaign"]["platforms"]) == 3


@pytest.mark.asyncio
async def test_api_get_platforms(client):
    response = await client.get("/api/v1/platforms")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 3
    platform_ids = [p["platform"] for p in data]
    assert "instagram" in platform_ids
    assert "facebook" in platform_ids
    assert "linkedin" in platform_ids
    ig = next(p for p in data if p["platform"] == "instagram")
    assert ig["target_width"] == 1080
    assert ig["target_height"] == 1350
    assert ig["aspect_ratio"] == "4:5"


@pytest.mark.asyncio
async def test_api_asset_validate_url_ssrf_blocked(client):
    # Requesting loopback should be rejected immediately
    response = await client.post(
        "/api/v1/assets/validate-url",
        json={"url": "http://127.0.0.1:8000/internal", "allow_local_demo": False},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_valid"] is False
    assert any(
        any(term in err.lower() for term in ("ssrf", "secure", "prohibited", "loopback", "private"))
        for err in data["report"]["errors"]
    )


@pytest.mark.asyncio
async def test_api_create_and_persist_brief(client):
    valid_bytes = generate_demo_smartwatch_png()

    with patch(
        "app.services.asset_gate.asset_gate_service._secure_download",
        return_value=((valid_bytes, "https://example.com/watch.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        response = await client.post(
            "/api/v1/briefs",
            json=SMARTFIT_X1_DEMO_BRIEF,
            params={"validate_asset_now": True},
        )
        assert response.status_code == 201
        data = response.json()
        assert "id" in data
        assert data["product_name"] == "SmartFit X1"
        assert data["brand_name"] == "SmartFit"
        assert data["validation_status"] in ("PASS", "WARNING")

        # Verify it can be retrieved by ID
        brief_id = data["id"]
        get_res = await client.get(f"/api/v1/briefs/{brief_id}")
        assert get_res.status_code == 200
        saved_data = get_res.json()
        assert saved_data["id"] == brief_id
        assert saved_data["price"] == 4999.0
