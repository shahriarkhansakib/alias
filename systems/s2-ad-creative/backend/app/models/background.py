import uuid
from typing import Dict, Any, Optional
from sqlalchemy import String, Integer, Boolean, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class GeneratedBackgroundRecord(Base, TimestampMixin):
    __tablename__ = "generated_backgrounds"
    __table_args__ = (
        Index("ix_generated_backgrounds_tenant_cache", "tenant_id", "cache_key"),
    )

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
    job_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("creative_jobs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    strategy_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("creative_strategies.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    brief_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("ad_briefs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    platform: Mapped[str] = mapped_column(
        String(32),
        index=True,
        nullable=False,
    )
    width: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    height: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    aspect_ratio: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    model_name: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    prompt_spec: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    prompt_version: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )
    storage_key: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    qa_status: Mapped[str] = mapped_column(
        String(20),
        index=True,
        nullable=False,
    )
    qa_result: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    cache_key: Mapped[Optional[str]] = mapped_column(
        String(128),
        index=True,
        nullable=True,
    )
    is_cached: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

