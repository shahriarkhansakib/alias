import asyncio
import os
import shutil
import tempfile
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.main import app
from app.core.database import Base, get_db
from app.core.config import settings
from app.core.auth import create_access_token
from app.models.auth import User, Tenant, Membership, DEFAULT_TENANT_ID, DEFAULT_USER_ID
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.providers.storage_provider import LocalStorageProvider


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="function")
async def test_db_session():
    test_db_url = "sqlite+aiosqlite:///:memory:"
    engine = create_async_engine(
        test_db_url,
        connect_args={"check_same_thread": False},
    )
    async_session = async_sessionmaker(
        bind=engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        # Seed authoritative default tenant, user, and membership
        default_tenant = Tenant(
            id=DEFAULT_TENANT_ID,
            name="Default Organization",
            slug="default-org",
        )
        default_user = User(
            id=DEFAULT_USER_ID,
            email="developer@example.com",
            full_name="Default Developer",
            is_active=True,
        )
        default_membership = Membership(
            id="default-membership-0000",
            user_id=DEFAULT_USER_ID,
            tenant_id=DEFAULT_TENANT_ID,
            role="OWNER",
        )
        session.add_all([default_tenant, default_user, default_membership])
        await session.commit()

        yield session

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def client(test_db_session):
    async def override_get_db():
        yield test_db_session

    app.dependency_overrides[get_db] = override_get_db

    default_token = create_access_token({
        "sub": DEFAULT_USER_ID,
        "email": "developer@example.com",
        "tenant_id": DEFAULT_TENANT_ID,
    })

    headers = {
        "Authorization": f"Bearer {default_token}",
        "X-Tenant-ID": DEFAULT_TENANT_ID,
    }

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", headers=headers) as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function")
async def unauth_client(test_db_session):
    """Client without authorization header for testing authentication enforcement."""
    async def override_get_db():
        yield test_db_session

    app.dependency_overrides[get_db] = override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


@pytest.fixture
def temp_storage():
    temp_dir = tempfile.mkdtemp()
    provider = LocalStorageProvider(base_dir=temp_dir)
    yield provider
    shutil.rmtree(temp_dir, ignore_errors=True)
