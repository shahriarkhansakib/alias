import uuid
from typing import Optional, Dict, Any
from sqlalchemy import String, Integer, Float, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class AssetValidationRecord(Base, TimestampMixin):
    __tablename__ = "asset_validation_records"

    id: Mapped[str] = mapped_column(
        String(36),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
        index=True,
    )
    tenant_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        index=True,
        nullable=True,
        default=DEFAULT_TENANT_ID,
    )
    url: Mapped[str] = mapped_column(String(1500), index=True, nullable=False)
    storage_key: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    detected_mime: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    width: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    height: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    aspect_ratio: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    has_alpha_channel: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    transparency_percent: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    file_size_bytes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(20), default="PASS", index=True, nullable=False)
    validation_report: Mapped[Optional[Dict[str, Any]]] = mapped_column(CompatibleJSON, nullable=True)
