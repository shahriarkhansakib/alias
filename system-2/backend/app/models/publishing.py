import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Any, Optional, List
from sqlalchemy import String, Integer, Text, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class PublishingStatus(str, Enum):
    PUBLISH_QUEUED = "PUBLISH_QUEUED"
    PUBLISHING = "PUBLISHING"
    PUBLISHED = "PUBLISHED"
    PUBLISH_FAILED = "PUBLISH_FAILED"


class AccountStatus(str, Enum):
    ACTIVE = "ACTIVE"
    CONNECTED = "CONNECTED"
    DISCONNECTED = "DISCONNECTED"
    EXPIRED = "EXPIRED"
    NOT_CONFIGURED = "NOT_CONFIGURED"


# Validated state transitions for the publishing lifecycle.
# Publishing state transitions are strictly separate from creative-generation states.
PUBLISHING_ALLOWED_TRANSITIONS: Dict[PublishingStatus, List[PublishingStatus]] = {
    PublishingStatus.PUBLISH_QUEUED: [
        PublishingStatus.PUBLISHING,
        PublishingStatus.PUBLISH_FAILED,
    ],
    PublishingStatus.PUBLISHING: [
        PublishingStatus.PUBLISHED,
        PublishingStatus.PUBLISH_FAILED,
        PublishingStatus.PUBLISH_QUEUED,  # transient retry backoff
    ],
    PublishingStatus.PUBLISH_FAILED: [
        PublishingStatus.PUBLISH_QUEUED,  # explicit retry
        PublishingStatus.PUBLISHED,       # successful reconciliation with external provider
    ],
    PublishingStatus.PUBLISHED: [],  # terminal: published artifacts cannot be mutated or re-queued
}


class PublishingRecord(Base, TimestampMixin):
    """
    Authoritative record for a social-media publishing action.
    Strictly downstream of FINAL_AD_APPROVED.
    Maintains full cryptographic and relational provenance back to the source brief.
    """
    __tablename__ = "publishing_records"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        index=True,
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
        default=DEFAULT_TENANT_ID,
    )
    final_ad_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("final_rendered_creatives.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    platform: Mapped[str] = mapped_column(
        String(32),
        index=True,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        index=True,
        nullable=False,
        default=PublishingStatus.PUBLISH_QUEUED.value,
    )
    provider: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="mock",
    )
    external_account_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        index=True,
        nullable=True,
    )
    external_post_id: Mapped[Optional[str]] = mapped_column(
        String(256),
        index=True,
        nullable=True,
    )
    post_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    caption: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    platform_metadata: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
        default=dict,
    )
    idempotency_key: Mapped[str] = mapped_column(
        String(128),
        index=True,
        nullable=False,
    )
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    published_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    attempt_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )
    provider_response: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
        default=dict,
    )
    error_code: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    error_message: Mapped[Optional[str]] = mapped_column(
        String(1000),
        nullable=True,
    )
    provenance_chain: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
        default=dict,
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "idempotency_key", name="uq_publishing_tenant_idempotency"),
    )

    def transition_to(
        self,
        target_status: PublishingStatus,
        error_code: Optional[str] = None,
        error_message: Optional[str] = None,
    ) -> None:
        """
        Transitions the record to a new status enforcing state machine invariants.
        Raises ValueError on invalid transitions.
        """
        current = PublishingStatus(self.status)
        allowed = PUBLISHING_ALLOWED_TRANSITIONS.get(current, [])
        if target_status not in allowed:
            raise ValueError(
                f"Invalid publishing transition: cannot transition from '{current.value}' to '{target_status.value}'."
            )

        now = datetime.now(timezone.utc)
        self.status = target_status.value
        self.last_attempt_at = now

        if target_status == PublishingStatus.PUBLISHING:
            self.attempt_count = (self.attempt_count or 0) + 1
        elif target_status == PublishingStatus.PUBLISHED:
            self.published_at = now
            self.error_code = None
            self.error_message = None
        elif target_status == PublishingStatus.PUBLISH_FAILED:
            self.error_code = error_code
            self.error_message = error_message


class ConnectedAccount(Base, TimestampMixin):
    """
    Customer tenant boundary for connected external platform accounts.
    Never stores plain OAuth secrets or tokens in client-facing payloads.
    Explicitly tracks NOT_CONFIGURED when OAuth integration is pending.
    """
    __tablename__ = "connected_accounts"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        index=True,
    )
    tenant_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
        default=DEFAULT_TENANT_ID,
    )
    platform: Mapped[str] = mapped_column(
        String(32),
        index=True,
        nullable=False,
    )
    account_name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )
    external_user_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default=AccountStatus.NOT_CONFIGURED.value,
    )
    config_metadata: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
        default=dict,
    )
    encrypted_access_token: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    encrypted_refresh_token: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    token_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    token_type: Mapped[Optional[str]] = mapped_column(
        String(32),
        nullable=True,
    )
    scopes: Mapped[List[str]] = mapped_column(
        CompatibleJSON,
        nullable=False,
        default=list,
    )
