import json
import time
import secrets
from typing import Optional, List
import httpx
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import get_current_tenant, get_optional_current_user
from app.core.encryption import get_token_encryption_service
from app.core.logging import logger
from app.models.auth import Tenant, User
from app.models.publishing import ConnectedAccount, AccountStatus
from app.schemas.publishing import (
    ConnectedAccountResponse,
    FacebookOAuthAuthorizeResponse,
    FacebookOAuthCallbackResponse,
    FacebookPageSelectRequest,
    FacebookPageItem,
)
from app.publishing.providers.facebook import GRAPH_API_BASE


router = APIRouter(prefix="/publishing", tags=["Phase 9.2: Facebook Publishing & Accounts"])

OAUTH_SCOPES = ["pages_manage_posts", "pages_read_engagement", "pages_show_list"]


def _get_encryption_service():
    return get_token_encryption_service()


@router.get("/oauth/facebook/authorize", response_model=FacebookOAuthAuthorizeResponse)
async def facebook_oauth_authorize(
    page_id: Optional[str] = Query(None, description="Optional target Facebook Page ID for automatic selection"),
    tenant: Tenant = Depends(get_current_tenant),
    user: Optional[User] = Depends(get_optional_current_user),
):
    """
    Initiates Facebook OAuth authorization flow.
    Generates a cryptographically authenticated, tenant-bound state parameter to prevent CSRF and state fixation.
    """
    app_id = settings.FACEBOOK_APP_ID
    redirect_uri = settings.FACEBOOK_OAUTH_REDIRECT_URI

    if not app_id or not redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Facebook OAuth credentials are not configured on this server.",
        )

    encryption_service = _get_encryption_service()
    state_payload = {
        "tenant_id": tenant.id,
        "user_id": user.id if user else "anonymous",
        "target_page_id": page_id,
        "nonce": secrets.token_hex(16),
        "created_at": time.time(),
    }
    state = encryption_service.encrypt(json.dumps(state_payload))

    scopes_str = ",".join(OAUTH_SCOPES)
    auth_url = (
        f"https://www.facebook.com/v22.0/dialog/oauth?"
        f"client_id={app_id}&"
        f"redirect_uri={redirect_uri}&"
        f"state={state}&"
        f"scope={scopes_str}&"
        f"response_type=code"
    )

    return FacebookOAuthAuthorizeResponse(
        authorization_url=auth_url,
        state=state,
    )


def get_oauth_http_client() -> Optional[httpx.AsyncClient]:
    """Dependency hook allowing tests to inject mock HTTP clients."""
    return None


@router.get("/oauth/facebook/callback", response_model=FacebookOAuthCallbackResponse)
async def facebook_oauth_callback(
    code: Optional[str] = Query(None, description="Authorization code from Meta"),
    state: Optional[str] = Query(None, description="Cryptographic state parameter"),
    error: Optional[str] = Query(None, description="OAuth error code if authorization failed/denied"),
    error_description: Optional[str] = Query(None, description="OAuth error description"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    http_client: Optional[httpx.AsyncClient] = Depends(get_oauth_http_client),
):

    """
    Handles Facebook OAuth callback:
    1. Validates and decrypts state parameter to ensure CSRF protection, tenant binding, and expiration check.
    2. Exchanges code for user access token with Meta Graph API.
    3. Retrieves user's managed Facebook Pages.
    4. Deterministically selects or prompts for Page selection.
    5. Stores only AES-256-GCM encrypted Page access tokens in ConnectedAccount.
    """
    if error:
        logger.warning(f"[FacebookOAuth] Meta authorization denied: {error} - {error_description}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Facebook authorization denied: {error_description or error}",
        )

    if not code or not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing required 'code' or 'state' parameters.",
        )

    # 1. State Validation & CSRF Protection
    encryption_service = _get_encryption_service()
    try:
        decrypted_state_raw = encryption_service.decrypt(state)
        state_data = json.loads(decrypted_state_raw)
    except Exception as state_exc:
        logger.warning(f"[FacebookOAuth] Invalid or tampered state parameter: {state_exc}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or tampered OAuth state parameter.",
        )

    # Verify tenant binding
    if state_data.get("tenant_id") != tenant.id:
        logger.warning(f"[FacebookOAuth] State tenant mismatch: expected {tenant.id}, got {state_data.get('tenant_id')}")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="OAuth state does not match authenticated tenant.",
        )

    # Verify expiration (10 minutes)
    created_at = state_data.get("created_at", 0)
    if time.time() - created_at > 600:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth state has expired. Please initiate authorization again.",
        )

    target_page_id = state_data.get("target_page_id")

    # 2. Code Exchange for User Access Token
    app_id = settings.FACEBOOK_APP_ID
    app_secret = settings.FACEBOOK_APP_SECRET
    redirect_uri = settings.FACEBOOK_OAUTH_REDIRECT_URI

    token_exchange_url = f"{GRAPH_API_BASE}/oauth/access_token"
    params = {
        "client_id": app_id,
        "client_secret": app_secret,
        "redirect_uri": redirect_uri,
        "code": code,
    }

    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        token_resp = await client.get(token_exchange_url, params=params)
        if token_resp.status_code != 200:
            err_msg = token_resp.text
            try:
                err_msg = token_resp.json().get("error", {}).get("message", err_msg)
            except Exception:
                pass
            logger.error(f"[FacebookOAuth] Token exchange failed: {err_msg}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Facebook token exchange failed: {err_msg}",
            )

        token_data = token_resp.json()
        user_access_token = token_data.get("access_token")

        # 3. Retrieve User's Managed Facebook Pages
        pages_url = f"{GRAPH_API_BASE}/me/accounts"
        pages_resp = await client.get(
            pages_url,
            params={
                "access_token": user_access_token,
                "fields": "id,name,access_token,tasks,perms",
            },
        )
        if pages_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to retrieve Facebook Pages from Meta Graph API.",
            )

        pages = pages_resp.json().get("data", [])
        if not pages:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No Facebook Pages found for this account. Create or manage a Facebook Page first.",
            )

        # 4. Page Selection Logic
        selected_page = None
        if target_page_id:
            for p in pages:
                if p.get("id") == target_page_id:
                    selected_page = p
                    break
            if not selected_page:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Target Page ID '{target_page_id}' not found among authorized Facebook Pages.",
                )
        elif len(pages) == 1:
            selected_page = pages[0]
        else:
            # Multiple pages found: generate encrypted temporary selection token
            selection_payload = {
                "tenant_id": tenant.id,
                "user_token": user_access_token,
                "created_at": time.time(),
            }
            selection_token = encryption_service.encrypt(json.dumps(selection_payload))
            available = [FacebookPageItem(id=p["id"], name=p["name"]) for p in pages]
            return FacebookOAuthCallbackResponse(
                status="PAGE_SELECTION_REQUIRED",
                available_pages=available,
                selection_token=selection_token,
                message="Multiple Facebook Pages available. Please select which Page to connect.",
            )

        # 5. Store ConnectedAccount with Encrypted Page Access Token
        page_id = selected_page["id"]
        page_name = selected_page["name"]
        raw_page_token = selected_page.get("access_token")

        if not raw_page_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Meta did not return a Page Access Token for the selected Page.",
            )

        encrypted_page_token = encryption_service.encrypt(raw_page_token)

        # Check existing connection for this tenant + platform + page_id
        stmt = select(ConnectedAccount).where(
            and_(
                ConnectedAccount.tenant_id == tenant.id,
                ConnectedAccount.platform == "facebook",
                ConnectedAccount.external_user_id == page_id,
            )
        )
        account = (await db.execute(stmt)).scalars().first()

        if not account:
            account = ConnectedAccount(
                tenant_id=tenant.id,
                platform="facebook",
                external_user_id=page_id,
                account_name=page_name,
                status=AccountStatus.CONNECTED.value,
                encrypted_access_token=encrypted_page_token,
                token_type="Bearer",
                scopes=OAUTH_SCOPES,
                config_metadata={
                    "page_id": page_id,
                    "page_name": page_name,
                },
            )
            db.add(account)
        else:
            account.account_name = page_name
            account.status = AccountStatus.CONNECTED.value
            account.encrypted_access_token = encrypted_page_token
            account.scopes = OAUTH_SCOPES
            account.token_type = "Bearer"
            account.config_metadata = {
                "page_id": page_id,
                "page_name": page_name,
            }

        await db.commit()
        await db.refresh(account)

        logger.info(f"[FacebookOAuth] Successfully connected Facebook Page '{page_name}' ({page_id}) for tenant '{tenant.id}'")

        return FacebookOAuthCallbackResponse(
            status="CONNECTED",
            account=ConnectedAccountResponse.model_validate(account),
            message=f"Facebook Page '{page_name}' connected successfully.",
        )

    finally:
        if not http_client:
            await client.aclose()


@router.post("/oauth/facebook/select-page", response_model=FacebookOAuthCallbackResponse)
async def facebook_oauth_select_page(
    payload: FacebookPageSelectRequest,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
    http_client: Optional[httpx.AsyncClient] = Depends(get_oauth_http_client),
):

    """
    Completes Facebook Page selection when an account manages multiple Pages.
    Validates the encrypted selection token, fetches the page token, and stores the ConnectedAccount.
    """
    encryption_service = _get_encryption_service()
    try:
        decrypted_raw = encryption_service.decrypt(payload.selection_token)
        token_data = json.loads(decrypted_raw)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired selection token.",
        )

    if token_data.get("tenant_id") != tenant.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Selection token does not match authenticated tenant.",
        )

    if time.time() - token_data.get("created_at", 0) > 600:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selection token has expired. Please initiate authorization again.",
        )

    user_token = token_data.get("user_token")

    # Fetch pages using user_token to resolve page_id
    client = http_client or httpx.AsyncClient(timeout=30.0)
    try:
        pages_resp = await client.get(
            f"{GRAPH_API_BASE}/me/accounts",
            params={
                "access_token": user_token,
                "fields": "id,name,access_token,tasks,perms",
            },
        )
        if pages_resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to retrieve Pages from Meta Graph API.",
            )

        pages = pages_resp.json().get("data", [])
        selected = next((p for p in pages if p.get("id") == payload.page_id), None)
        if not selected:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Page ID '{payload.page_id}' not found among user's managed Facebook Pages.",
            )

        page_name = selected["name"]
        raw_page_token = selected.get("access_token")
        if not raw_page_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Meta did not return an access token for the selected Page.",
            )

        encrypted_page_token = encryption_service.encrypt(raw_page_token)

        stmt = select(ConnectedAccount).where(
            and_(
                ConnectedAccount.tenant_id == tenant.id,
                ConnectedAccount.platform == "facebook",
                ConnectedAccount.external_user_id == payload.page_id,
            )
        )
        account = (await db.execute(stmt)).scalars().first()

        if not account:
            account = ConnectedAccount(
                tenant_id=tenant.id,
                platform="facebook",
                external_user_id=payload.page_id,
                account_name=page_name,
                status=AccountStatus.CONNECTED.value,
                encrypted_access_token=encrypted_page_token,
                token_type="Bearer",
                scopes=OAUTH_SCOPES,
                config_metadata={"page_id": payload.page_id, "page_name": page_name},
            )
            db.add(account)
        else:
            account.account_name = page_name
            account.status = AccountStatus.CONNECTED.value
            account.encrypted_access_token = encrypted_page_token
            account.scopes = OAUTH_SCOPES
            account.token_type = "Bearer"
            account.config_metadata = {"page_id": payload.page_id, "page_name": page_name}

        await db.commit()
        await db.refresh(account)

        return FacebookOAuthCallbackResponse(
            status="CONNECTED",
            account=ConnectedAccountResponse.model_validate(account),
            message=f"Facebook Page '{page_name}' connected successfully.",
        )
    finally:
        if not http_client:
            await client.aclose()


@router.get("/accounts", response_model=List[ConnectedAccountResponse])
async def list_connected_accounts(
    platform: Optional[str] = Query(None, description="Optional platform filter (e.g. facebook)"),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
):
    """
    Lists connected social platform accounts for the active tenant.
    Never exposes raw tokens, secrets, or encrypted credential values.
    """
    stmt = select(ConnectedAccount).where(ConnectedAccount.tenant_id == tenant.id)
    if platform:
        stmt = stmt.where(ConnectedAccount.platform == platform.lower().strip())

    results = (await db.execute(stmt)).scalars().all()
    return [ConnectedAccountResponse.model_validate(acc) for acc in results]


@router.get("/accounts/{account_id}", response_model=ConnectedAccountResponse)
async def get_connected_account(
    account_id: str,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_current_tenant),
):
    """
    Retrieves a connected account by ID with strict tenant isolation.
    Returns only safe metadata; never exposes credentials.
    """
    account = await db.get(ConnectedAccount, account_id)
    if not account or account.tenant_id != tenant.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Connected account not found.",
        )

    return ConnectedAccountResponse.model_validate(account)
