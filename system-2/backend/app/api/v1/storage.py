import mimetypes
from typing import Optional
from fastapi import APIRouter, HTTPException, Response, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.auth import get_optional_current_user
from app.models.auth import User, Membership
from app.providers.storage_provider import get_storage_provider
from app.providers.storage_keys import extract_tenant_from_storage_key

router = APIRouter(prefix="/storage", tags=["Storage"])


@router.get("/{file_path:path}")
async def serve_stored_file(
    file_path: str,
    user: Optional[User] = Depends(get_optional_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Serves stored assets with strict tenant isolation.
    - Tenant-scoped assets (tenants/{tenant_id}/...) strictly require an authenticated
      user with verified membership in the target tenant.
    - Unauthorized access or foreign tenant access safely returns HTTP 404 to avoid
      leaking resource existence across tenant boundaries.
    - Public demo fixtures (demo/...) are accessible for development.
    """
    target_tenant_id = extract_tenant_from_storage_key(file_path)
    if target_tenant_id:
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required to access tenant storage objects.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        # Authorize: check membership in target_tenant_id
        stmt = (
            select(Membership)
            .where(
                Membership.user_id == user.id,
                Membership.tenant_id == target_tenant_id,
            )
        )
        membership = (await db.execute(stmt)).scalars().first()
        if not membership:
            # Safe 404 to prevent resource existence enumeration
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Requested file not found in storage",
            )

    storage = get_storage_provider()
    try:
        data = await storage.get_bytes(file_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Requested file not found in storage")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    content_type, _ = mimetypes.guess_type(file_path)
    if not content_type:
        content_type = "application/octet-stream"

    # Storage Privacy / Cache Security:
    # Tenant-private assets must NEVER receive public cache headers and must use private/no-store
    # semantics so stale/superseded creatives are not cached by browsers or intermediate proxies.
    if target_tenant_id:
        cache_header = "private, no-cache, no-store, must-revalidate"
    elif file_path.startswith("demo/"):
        cache_header = "public, max-age=86400"
    else:
        cache_header = "private, no-cache, no-store, must-revalidate"

    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": cache_header},
    )
