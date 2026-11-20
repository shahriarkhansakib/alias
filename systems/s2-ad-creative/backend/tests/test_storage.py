import pytest


@pytest.mark.asyncio
async def test_local_storage_lifecycle(temp_storage):
    key = "products/test_cutout.png"
    sample_data = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"

    # Save
    saved_key = await temp_storage.save_bytes(sample_data, key)
    assert saved_key == key

    # Exists
    exists = await temp_storage.exists(key)
    assert exists is True

    # Retrieve
    retrieved = await temp_storage.get_bytes(key)
    assert retrieved == sample_data

    # Public URL
    url = await temp_storage.get_public_url(key)
    assert url.startswith("/api/v1/storage/")
    assert "test_cutout.png" in url


@pytest.mark.asyncio
async def test_storage_not_found(temp_storage):
    with pytest.raises(FileNotFoundError):
        await temp_storage.get_bytes("non_existent_key.png")
