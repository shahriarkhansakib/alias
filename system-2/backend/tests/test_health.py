import pytest


@pytest.mark.asyncio
async def test_root_endpoint(client):
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Alias Img-Gen"
    assert data["status"] == "online"
    assert "docs_url" in data


@pytest.mark.asyncio
async def test_health_endpoint(client):
    response = await client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ("healthy", "degraded")
    assert data["database"] == "healthy"
    assert data["storage"] == "healthy"
    assert "version" in data
    assert "environment" in data


@pytest.mark.asyncio
async def test_status_endpoint(client):
    response = await client.get("/api/v1/status")
    assert response.status_code == 200
    data = response.json()
    assert data["project_name"] == "Alias Img-Gen"
    assert "active_features" in data
    assert data["active_features"]["deterministic_rendering"] is True
    assert data["active_features"]["payload_gate"] is True
    assert "configuration" in data
