"""
Authentication & Multi-Tenant Management API Routes.
Provides token generation, identity verification, and organization context.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import (
    create_access_token,
    get_current_user,
    get_current_tenant,
    require_membership,
)
from app.models.auth import User, Tenant, Membership

router = APIRouter(prefix="/auth", tags=["Authentication & Multi-Tenancy"])


class DevTokenRequest(BaseModel):
    email: str = Field(..., pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    tenant_slug: Optional[str] = None
    tenant_name: Optional[str] = None
    role: str = "OWNER"


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]
    tenant: Dict[str, Any]
    role: str


class TenantSummary(BaseModel):
    id: str
    name: str
    slug: str
    role: str


class CurrentUserResponse(BaseModel):
    user: Dict[str, Any]
    current_tenant: Dict[str, Any]
    role: str
    available_tenants: List[TenantSummary]


@router.post("/dev-login", response_model=AuthResponse)
@router.post("/dev-token", response_model=AuthResponse)
async def generate_dev_token(req: DevTokenRequest, db: AsyncSession = Depends(get_db)):
    """
    Generates a valid signed authentication token for development/testing.
    Strictly forbidden and disabled in production.
    """
    if settings.ENVIRONMENT.lower() == "production" or not settings.ENABLE_DEV_AUTH:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Development token generation is strictly disabled in production.",
        )

    # 1. Lookup or create User
    stmt_user = select(User).where(User.email == req.email)
    user = (await db.execute(stmt_user)).scalars().first()
    if not user:
        user = User(
            email=req.email,
            full_name=req.email.split("@")[0].capitalize(),
            is_active=True,
        )
        db.add(user)
        await db.flush()

    # 2. Lookup or create Tenant
    slug = req.tenant_slug or f"team-{user.email.split('@')[0].lower()}"
    name = req.tenant_name or f"{user.email.split('@')[0].capitalize()}'s Team"
    stmt_tenant = select(Tenant).where(Tenant.slug == slug)
    tenant = (await db.execute(stmt_tenant)).scalars().first()
    if not tenant:
        tenant = Tenant(name=name, slug=slug)
        db.add(tenant)
        await db.flush()

    # 3. Lookup or create Membership
    stmt_mem = select(Membership).where(
        Membership.user_id == user.id,
        Membership.tenant_id == tenant.id,
    )
    membership = (await db.execute(stmt_mem)).scalars().first()
    if not membership:
        membership = Membership(
            user_id=user.id,
            tenant_id=tenant.id,
            role=req.role.upper(),
        )
        db.add(membership)
        await db.flush()

    await db.commit()
    await db.refresh(user)
    await db.refresh(tenant)

    token = create_access_token({
        "sub": user.id,
        "email": user.email,
        "tenant_id": tenant.id,
    })

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user={"id": user.id, "email": user.email, "full_name": user.full_name},
        tenant={"id": tenant.id, "name": tenant.name, "slug": tenant.slug},
        role=membership.role,
    )


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_profile(
    user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    membership: Membership = Depends(require_membership),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns current authenticated profile, active organization, and available tenant memberships.
    """
    stmt = (
        select(Tenant, Membership.role)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == user.id)
    )
    rows = (await db.execute(stmt)).all()

    available = [
        TenantSummary(
            id=t.id,
            name=t.name,
            slug=t.slug,
            role=role,
        )
        for t, role in rows
    ]

    return CurrentUserResponse(
        user={"id": user.id, "email": user.email, "full_name": user.full_name},
        current_tenant={"id": tenant.id, "name": tenant.name, "slug": tenant.slug},
        role=membership.role,
        available_tenants=available,
    )
