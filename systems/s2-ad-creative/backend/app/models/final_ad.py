import uuid
from typing import Dict, Any, Optional
from sqlalchemy import String, Integer, Boolean, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class FinalRenderedCreativeRecord(Base, TimestampMixin):
    """
    Authoritative record for a deterministically rendered final advertisement.
    Maintains complete audit provenance from source product asset to final pixels.
    """
    __tablename__ = "final_rendered_creatives"
    __table_args__ = (
        Index("ix_final_rendered_creatives_tenant_cache", "tenant_id", "cache_key"),
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
    background_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("generated_backgrounds.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    composite_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("composited_creatives.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
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
    storage_key: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    copy_spec: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    typography_spec: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    cta_spec: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    logo_spec: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
    )
    price_badge_spec: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
    )
    readability_spec: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
        nullable=False,
    )
    provenance_chain: Mapped[Dict[str, Any]] = mapped_column(
        CompatibleJSON,
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
    attempt_number: Mapped[int] = mapped_column(
        Integer,
        default=1,
        nullable=False,
    )

    # Vision QA -- advisory, runs only after final render, never after every generation
    # None means vision QA has not run for this record yet.
    vision_qa_status: Mapped[Optional[str]] = mapped_column(
        String(20),
        index=True,
        nullable=True,
        default=None,
    )
    vision_qa_result: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
        default=None,
    )

    # Dependency invalidation: set True when an authoritative upstream input changes.
    # A stale final ad must be re-rendered before it can be approved.
    is_stale: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )

