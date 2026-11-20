import uuid
from typing import Optional, Dict, Any, List
from sqlalchemy import String, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class AdBrief(Base, TimestampMixin):
    __tablename__ = "ad_briefs"

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
    brand_name: Mapped[str] = mapped_column(String(100), index=True, nullable=False)
    product_name: Mapped[str] = mapped_column(String(150), index=True, nullable=False)
    campaign_name: Mapped[Optional[str]] = mapped_column(String(150), nullable=True)
    price: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    platforms: Mapped[List[str]] = mapped_column(CompatibleJSON, nullable=False)
    validation_status: Mapped[str] = mapped_column(String(20), default="PASS", index=True, nullable=False)
    payload: Mapped[Dict[str, Any]] = mapped_column(CompatibleJSON, nullable=False)
    validation_report: Mapped[Optional[Dict[str, Any]]] = mapped_column(CompatibleJSON, nullable=True)
