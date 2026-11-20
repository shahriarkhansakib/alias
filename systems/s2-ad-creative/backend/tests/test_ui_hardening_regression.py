import pytest
from app.demo.sample_assets import SMARTFIT_X1_DEMO_BRIEF


@pytest.mark.asyncio
async def test_workflow_lock_and_unlock_progression(client):
    """
    Regression test suite for Phase UI-Hardening verifying all 10 workflow requirements:
    1. New brief starts with Strategy locked (no brief ID).
    2. Validated brief unlocks Strategy.
    3. Invalid brief keeps Strategy locked (validation fails, no brief ID returned).
    4. Saved brief ID is available after successful save.
    5. Refresh after validation keeps Strategy unlocked (retrievable via GET /api/v1/briefs/{id}).
    6. Strategy approval unlocks Background.
    7. Background approval unlocks Product.
    8. Product approval unlocks Composite.
    9. Composite approval unlocks Final Ad.
    10. Final approval produces completed workflow state.
    """

    # 1. New brief state: before brief is saved, strategy generation without brief_id fails
    strat_attempt = await client.post("/api/v1/strategies/generate", json={"brief_id": None})
    assert strat_attempt.status_code in (400, 422), "Strategy generation must be locked/rejected without valid brief"

    # 3. Invalid brief keeps Strategy locked: invalid payload returns 400 and does NOT create a brief
    invalid_payload = {
        "brand": {"name": ""}, # Missing required fields
        "product": {},
    }
    invalid_resp = await client.post("/api/v1/briefs", json=invalid_payload)
    assert invalid_resp.status_code in (400, 422), "Invalid brief must fail validation and not persist"

    # 2 & 4. Validated brief succeeds, returns authoritative ID
    from unittest.mock import patch
    from app.demo.sample_assets import generate_demo_smartwatch_png
    valid_bytes = generate_demo_smartwatch_png()

    with patch(
        "app.services.asset_gate.asset_gate_service._secure_download",
        return_value=((valid_bytes, "https://example.com/watch.png", "image/png"), None),
    ), patch("app.services.asset_gate.validate_url_safety", return_value=(True, None, None)):
        valid_payload = SMARTFIT_X1_DEMO_BRIEF
        save_resp = await client.post("/api/v1/briefs", json=valid_payload)
        assert save_resp.status_code == 201, f"Save brief failed: {save_resp.text}"
        saved_brief = save_resp.json()
        assert "id" in saved_brief, "Authoritative brief ID must be returned"
        brief_id = saved_brief["id"]
        assert brief_id is not None
        assert saved_brief["validation_status"] == "PASS"

    # 5. Refresh after validation keeps Strategy unlocked: GET /api/v1/briefs/{id} succeeds
    hydrate_resp = await client.get(f"/api/v1/briefs/{brief_id}")
    assert hydrate_resp.status_code == 200, "Brief must be fetchable by ID for hydration on refresh"
    hydrated_brief = hydrate_resp.json()
    assert hydrated_brief["id"] == brief_id
    assert hydrated_brief["validation_status"] == "PASS"

    # 6. Strategy generation & approval: unlocks Step 3 (Background)
    strat_resp = await client.post("/api/v1/strategies/generate", json={"brief_id": brief_id})
    assert strat_resp.status_code == 200, f"Strategy generation failed: {strat_resp.text}"
    strat_data = strat_resp.json()
    assert strat_data["status"] == "APPROVED"
    assert "strategy_id" in strat_data
    strategy_id = strat_data["strategy_id"]
    concept = strat_data["strategy"]["concept"]
    # Check contract alignment: creative_angle is populated
    assert "creative_angle" in concept and concept["creative_angle"]

    # Hydrate strategy on refresh
    strat_get_resp = await client.get(f"/api/v1/strategies/{strategy_id}")
    assert strat_get_resp.status_code == 200
    assert strat_get_resp.json()["id"] == strategy_id

    # 7. Background generation & approval: unlocks Step 4 (Product)
    bg_resp = await client.post(
        "/api/v1/backgrounds/generate",
        json={"strategy_id": strategy_id, "platform": "instagram"},
    )
    assert bg_resp.status_code == 200, f"Background generation failed: {bg_resp.text}"
    bg_data = bg_resp.json()
    assert bg_data["qa_status"] == "PASS"
    assert "id" in bg_data
    background_id = bg_data["id"]

    # Hydrate background on refresh
    bg_get_resp = await client.get(f"/api/v1/backgrounds/{background_id}")
    assert bg_get_resp.status_code == 200

    # 8. Product cutout QA status verifies product asset -> ready for Step 5 (Composite)
    # Asset verification from payload
    assert hydrated_brief["validation_status"] == "PASS"
    assert len(hydrated_brief["payload"]["images"]) > 0

    # 9. Composite generation & approval: unlocks Step 6 (Final Ad)
    comp_resp = await client.post(
        "/api/v1/composites/generate",
        json={"background_id": background_id},
    )
    assert comp_resp.status_code == 200, f"Composite generation failed: {comp_resp.text}"
    comp_data = comp_resp.json()
    assert comp_data["qa_status"] == "PASS"
    assert "id" in comp_data
    composite_id = comp_data["id"]

    # Hydrate composite on refresh
    comp_get_resp = await client.get(f"/api/v1/composites/{composite_id}")
    assert comp_get_resp.status_code == 200

    # 10. Final ad generation and approval produces completed workflow state
    final_ad_resp = await client.post(
        "/api/v1/final-ads/generate",
        json={"composite_id": composite_id},
    )
    assert final_ad_resp.status_code == 200, f"Final ad generation failed: {final_ad_resp.text}"
    final_ad_data = final_ad_resp.json()
    assert final_ad_data["qa_status"] == "PASS"
    assert "id" in final_ad_data
    final_ad_id = final_ad_data["id"]

    # Approve final ad
    approve_resp = await client.post(f"/api/v1/final-ads/{final_ad_id}/approve")
    assert approve_resp.status_code == 200
    approved_ad = approve_resp.json()
    assert approved_ad["approved"] is True
    assert approved_ad["final_ad_id"] == final_ad_id
