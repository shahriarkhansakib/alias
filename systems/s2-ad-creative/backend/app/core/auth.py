"""
Authoritative Authentication and Multi-Tenant Authorization Core.
Enforces JWT verification, stable user identity, tenant membership, and strict role gates.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List
import jwt
from fastapi import Depends, HTTPException, Header, status, Query
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.auth import User, Tenant, Membership, DEFAULT_TENANT_ID, DEFAULT_USER_ID

security = HTTPBearer(auto_error=False)


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """Generates a signed JWT bearer token with claims."""
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.AUTH_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire, "iat": now})
    encoded_jwt = jwt.encode(to_encode, settings.AUTH_JWT_SECRET, algorithm=settings.AUTH_JWT_ALGORITHM)
    return encoded_jwt


def decode_access_token(token: str) -> Dict[str, Any]:
    """
    Decodes and validates token claims.
    Rejects development tokens immediately if running in production.
    """
    if token.startswith("dev_token:"):
        if settings.ENVIRONMENT.lower() == "production":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Development token is strictly prohibited in production.",
            )
        if not settings.ENABLE_DEV_AUTH:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Development authentication is disabled.",
            )
        parts = token.split(":")
        email = parts[1] if len(parts) > 1 else "developer@example.com"
        tenant_id = parts[2] if len(parts) > 2 else DEFAULT_TENANT_ID
        return {
            "sub": email,
            "email": email,
            "tenant_id": tenant_id,
            "dev_mode": True,
        }

    try:
        payload = jwt.decode(
            token,
            settings.AUTH_JWT_SECRET,
            algorithms=[settings.AUTH_JWT_ALGORITHM],
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token has expired.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authentication token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    token_query: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    FastAPI dependency: extracts and verifies the authenticated User.
    Rejects unauthenticated requests with HTTP 401.
    """
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif token_query:
        token = token_query.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please provide a valid Bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    claims = decode_access_token(token)
    email = claims.get("email") or claims.get("sub")
    sub = claims.get("sub")

    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token payload is missing subject/email identifier.",
        )

    # Lookup user by email or ID
    stmt = select(User).where((User.email == email) | (User.id == sub))
    result = await db.execute(stmt)
    user = result.scalars().first()

    if not user:
        if settings.ENVIRONMENT.lower() != "production" and settings.ENABLE_DEV_AUTH:
            # Auto-provision user in development
            user = User(
                id=sub if (sub and len(sub) == 36 and "-" in sub) else None,
                email=email,
                full_name=claims.get("name") or email.split("@")[0].capitalize(),
                is_active=True,
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authenticated user record not found in system.",
            )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account is deactivated.",
        )

    return user


async def get_optional_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    token_query: Optional[str] = Query(None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """FastAPI dependency: resolves current User if authenticated, else returns None."""
    token = None
    if credentials:
        token = credentials.credentials
    elif authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif token_query:
        token = token_query.strip()

    if not token:
        return None

    try:
        claims = decode_access_token(token)
        email = claims.get("email") or claims.get("sub")
        sub = claims.get("sub")
        stmt = select(User).where((User.email == email) | (User.id == sub))
        result = await db.execute(stmt)
        return result.scalars().first()
    except Exception:
        return None


async def get_current_tenant(
    user: User = Depends(get_current_user),
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID"),
    db: AsyncSession = Depends(get_db),
) -> Tenant:
    """
    FastAPI dependency: resolves and authoritatively verifies Tenant membership.
    Never trusts client-supplied tenant_id without database membership verification.
    """
    if x_tenant_id:
        # Client requested specific tenant context -> verify membership
        stmt = (
            select(Membership)
            .where(
                Membership.user_id == user.id,
                Membership.tenant_id == x_tenant_id,
            )
        )
        membership = (await db.execute(stmt)).scalars().first()
        if not membership:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"User is not authorized for tenant '{x_tenant_id}'.",
            )
        tenant = await db.get(Tenant, x_tenant_id)
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Requested tenant does not exist.",
            )
        return tenant

    # No specific tenant requested: find user's primary/default membership
    stmt = (
        select(Membership)
        .where(Membership.user_id == user.id)
        .order_by(Membership.created_at.asc())
    )
    membership = (await db.execute(stmt)).scalars().first()

    if membership:
        tenant = await db.get(Tenant, membership.tenant_id)
        if tenant:
            return tenant

    # In development mode, auto-provision personal organization if none exists
    if settings.ENVIRONMENT.lower() != "production" and settings.ENABLE_DEV_AUTH:
        org_slug = f"org-{user.email.split('@')[0].lower()}"
        existing_org_stmt = select(Tenant).where(Tenant.slug == org_slug)
        tenant = (await db.execute(existing_org_stmt)).scalars().first()
        if not tenant:
            tenant = Tenant(
                name=f"{user.email.split('@')[0].capitalize()}'s Team",
                slug=org_slug,
            )
            db.add(tenant)
            await db.flush()

        membership = Membership(
            user_id=user.id,
            tenant_id=tenant.id,
            role="OWNER",
        )
        db.add(membership)
        await db.commit()
        await db.refresh(tenant)
        return tenant

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="User does not have an active organization membership.",
    )


async def require_membership(
    user: User = Depends(get_current_user),
    tenant: Tenant = Depends(get_current_tenant),
    db: AsyncSession = Depends(get_db),
) -> Membership:
    """FastAPI dependency: verifies and returns the current user's membership in the active tenant."""
    stmt = (
        select(Membership)
        .where(
            Membership.user_id == user.id,
            Membership.tenant_id == tenant.id,
        )
    )
    membership = (await db.execute(stmt)).scalars().first()
    if not membership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not hold membership in this tenant.",
        )
    return membership


def require_role(allowed_roles: List[str]):
    """FastAPI dependency factory: asserts membership has one of the allowed roles."""
    async def role_checker(membership: Membership = Depends(require_membership)) -> Membership:
        if membership.role.upper() not in [r.upper() for r in allowed_roles]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation requires one of the following roles: {', '.join(allowed_roles)}.",
            )
        return membership
    return role_checker
