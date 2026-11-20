import uuid
from typing import Optional, Dict, Any
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class CreativeStrategyRecord(Base, TimestampMixin):
    __tablename__ = "creative_strategies"

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
    brief_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("ad_briefs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    version_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="APPROVED", index=True, nullable=False)
    model_provider: Mapped[str] = mapped_column(String(50), default="mock", nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), default="mock-strategist-v1", nullable=False)
    template_id: Mapped[str] = mapped_column(String(64), nullable=False)
    strategy_spec: Mapped[Dict[str, Any]] = mapped_column(CompatibleJSON, nullable=False)
    claim_validation_report: Mapped[Dict[str, Any]] = mapped_column(CompatibleJSON, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
