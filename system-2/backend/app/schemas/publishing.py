from datetime import datetime
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, ConfigDict, Field
from app.models.publishing import PublishingStatus


class PublishRequest(BaseModel):
    """
    Request payload to initiate publishing of an approved final advertisement.
    Strictly forbids unexpected fields.
    """
    model_config = ConfigDict(extra="forbid")

    final_ad_id: str = Field(..., description="ID of the approved FinalRenderedCreativeRecord")
    platform: str = Field(..., description="Target publishing platform (e.g. facebook, instagram, linkedin)")
    caption: Optional[str] = Field(None, max_length=4000, description="Post text caption")
    platform_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Platform-specific parameters (e.g. hashtags, placement)")
    idempotency_key: Optional[str] = Field(None, max_length=128, description="Optional client-provided idempotency key")
    account_id: Optional[str] = Field(None, max_length=128, description="Target connected account ID")


class PublishRetryRequest(BaseModel):
    """
    Request payload to retry a failed publishing attempt.
    """
    model_config = ConfigDict(extra="forbid")

    reason: Optional[str] = Field(None, max_length=256, description="Optional operator reason for retrying")


class PublishingRecordResponse(BaseModel):
    """
    Public response representation of a PublishingRecord.
    Contains zero access tokens, secrets, or internal credentials.
    """
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str
    tenant_id: str
    final_ad_id: str
    platform: str
    status: str
    provider: str
    external_account_id: Optional[str] = None
    external_post_id: Optional[str] = None
    post_url: Optional[str] = None
    caption: Optional[str] = None
    platform_metadata: Dict[str, Any]
    idempotency_key: str
    requested_at: datetime
    published_at: Optional[datetime] = None
    last_attempt_at: Optional[datetime] = None
    attempt_count: int
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    provenance_chain: Dict[str, Any]


class PublishingReconcileResponse(BaseModel):
    """
    Result of a reconciliation operation against the external provider.
    """
    model_config = ConfigDict(extra="forbid")

    reconciled: bool
    previous_status: str
    current_status: str
    external_post_id: Optional[str] = None
    post_url: Optional[str] = None
    message: str


class PlatformPublishingCapability(BaseModel):
    """
    Describes publishing capabilities, constraints, and provider status for a social platform.
    """
    model_config = ConfigDict(extra="forbid")

    platform: str
    display_name: str
    supported_media_types: List[str]
    supported_aspect_ratios: List[str]
    max_caption_length: int
    supports_hashtags: bool
    max_hashtags: Optional[int] = None
    supports_links: bool
    provider_type: str
    integration_status: str  # "MOCK" | "NOT_CONFIGURED" | "AVAILABLE"


class ConnectedAccountResponse(BaseModel):
    """
    Public safe representation of a connected social media account.
    Exposes zero tokens, secrets, or encrypted credential values.
    """
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: str
    tenant_id: str
    platform: str
    account_name: str
    external_user_id: str
    status: str
    expires_at: Optional[datetime] = Field(None, validation_alias="token_expires_at")
    scopes: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class FacebookOAuthAuthorizeResponse(BaseModel):
    """
    Response returned by /api/v1/publishing/oauth/facebook/authorize
    """
    model_config = ConfigDict(extra="forbid")

    authorization_url: str
    state: str


class FacebookPageItem(BaseModel):
    """
    Metadata for an available Facebook Page for selection.
    """
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str


class FacebookOAuthCallbackResponse(BaseModel):
    """
    Result of Facebook OAuth callback exchange.
    Exposes only safe account metadata or available pages for selection.
    """
    model_config = ConfigDict(extra="forbid")

    status: str  # "CONNECTED" | "PAGE_SELECTION_REQUIRED"
    account: Optional[ConnectedAccountResponse] = None
    available_pages: Optional[List[FacebookPageItem]] = None
    selection_token: Optional[str] = None
    message: str


class FacebookPageSelectRequest(BaseModel):
    """
    Request payload to complete Facebook Page selection when multiple pages exist.
    """
    model_config = ConfigDict(extra="forbid")

    selection_token: str = Field(..., description="Encrypted temporary selection token from callback")
    page_id: str = Field(..., description="Selected Facebook Page ID")

