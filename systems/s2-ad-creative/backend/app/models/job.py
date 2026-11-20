from enum import Enum
from typing import Any, Dict, Optional, List
import uuid
from sqlalchemy import String, Integer, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin, CompatibleJSON
from app.models.auth import DEFAULT_TENANT_ID


class JobStatus(str, Enum):
    RECEIVED = "RECEIVED"
    VALIDATING = "VALIDATING"
    ASSET_CHECK = "ASSET_CHECK"
    STRATEGY_GENERATING = "STRATEGY_GENERATING"
    STRATEGY_GENERATED = "STRATEGY_GENERATED"
    STRATEGY_VALIDATED = "STRATEGY_VALIDATED"
    BACKGROUND_GENERATION = "BACKGROUND_GENERATION"
    BACKGROUND_QA = "BACKGROUND_QA"
    BACKGROUND_APPROVED = "BACKGROUND_APPROVED"
    PRODUCT_CUTOUT = "PRODUCT_CUTOUT"
    PRODUCT_QA = "PRODUCT_QA"
    COMPOSITING = "COMPOSITING"
    COMPOSITE_QA = "COMPOSITE_QA"
    COMPOSITE_APPROVED = "COMPOSITE_APPROVED"
    FINAL_RENDERING = "FINAL_RENDERING"
    FINAL_QA = "FINAL_QA"
    FINAL_AD_APPROVED = "FINAL_AD_APPROVED"
    RENDERING = "RENDERING"
    QA = "QA"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    REGENERATING = "REGENERATING"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


# Authoritative pipeline state machine transitions
ALLOWED_TRANSITIONS: Dict[JobStatus, List[JobStatus]] = {
    JobStatus.RECEIVED: [JobStatus.VALIDATING, JobStatus.FAILED],
    JobStatus.VALIDATING: [JobStatus.ASSET_CHECK, JobStatus.FAILED],
    JobStatus.ASSET_CHECK: [JobStatus.STRATEGY_GENERATING, JobStatus.STRATEGY_GENERATED, JobStatus.FAILED],
    JobStatus.STRATEGY_GENERATING: [JobStatus.STRATEGY_GENERATED, JobStatus.FAILED],
    JobStatus.STRATEGY_GENERATED: [JobStatus.STRATEGY_VALIDATED, JobStatus.FAILED],
    JobStatus.STRATEGY_VALIDATED: [JobStatus.BACKGROUND_GENERATION, JobStatus.STRATEGY_GENERATING, JobStatus.FAILED],
    JobStatus.BACKGROUND_GENERATION: [JobStatus.BACKGROUND_QA, JobStatus.REGENERATING, JobStatus.FAILED],
    JobStatus.BACKGROUND_QA: [JobStatus.BACKGROUND_APPROVED, JobStatus.REGENERATING, JobStatus.FAILED],
    JobStatus.BACKGROUND_APPROVED: [JobStatus.PRODUCT_CUTOUT, JobStatus.REGENERATING, JobStatus.FAILED],
    JobStatus.PRODUCT_CUTOUT: [JobStatus.PRODUCT_QA, JobStatus.FAILED],
    JobStatus.PRODUCT_QA: [JobStatus.COMPOSITING, JobStatus.PRODUCT_CUTOUT, JobStatus.FAILED],
    JobStatus.COMPOSITING: [JobStatus.COMPOSITE_QA, JobStatus.FAILED],
    JobStatus.COMPOSITE_QA: [JobStatus.COMPOSITE_APPROVED, JobStatus.FAILED],
    JobStatus.COMPOSITE_APPROVED: [JobStatus.FINAL_RENDERING, JobStatus.PRODUCT_CUTOUT, JobStatus.FAILED],
    JobStatus.FINAL_RENDERING: [JobStatus.FINAL_QA, JobStatus.FAILED],
    JobStatus.FINAL_QA: [JobStatus.FINAL_AD_APPROVED, JobStatus.FINAL_RENDERING, JobStatus.FAILED],
    JobStatus.FINAL_AD_APPROVED: [JobStatus.FINAL_RENDERING, JobStatus.COMPLETED],
    JobStatus.RENDERING: [JobStatus.QA, JobStatus.FINAL_QA, JobStatus.FAILED],
    JobStatus.QA: [JobStatus.AWAITING_APPROVAL, JobStatus.FINAL_AD_APPROVED, JobStatus.FAILED],
    JobStatus.AWAITING_APPROVAL: [JobStatus.APPROVED, JobStatus.FINAL_AD_APPROVED, JobStatus.REJECTED, JobStatus.REGENERATING],
    JobStatus.REGENERATING: [JobStatus.STRATEGY_GENERATING, JobStatus.STRATEGY_GENERATED, JobStatus.BACKGROUND_GENERATION, JobStatus.FAILED],
    JobStatus.APPROVED: [JobStatus.COMPLETED],
    JobStatus.REJECTED: [JobStatus.REGENERATING, JobStatus.FAILED],
    JobStatus.FAILED: [JobStatus.RECEIVED, JobStatus.STRATEGY_GENERATING, JobStatus.BACKGROUND_GENERATION, JobStatus.PRODUCT_CUTOUT, JobStatus.FINAL_RENDERING],
    JobStatus.COMPLETED: [],
}


class CreativeJob(Base, TimestampMixin):
    __tablename__ = "creative_jobs"

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
    brief_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("ad_briefs.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    strategy_id: Mapped[Optional[str]] = mapped_column(
        String(36),
        ForeignKey("creative_strategies.id", ondelete="SET NULL"),
        index=True,
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(32),
        default=JobStatus.RECEIVED.value,
        index=True,
        nullable=False,
    )
    current_stage: Mapped[str] = mapped_column(
        String(64),
        default="Payload Validation",
        nullable=False,
    )
    progress_pct: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    brief_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
    )
    stage_data: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
    )
    error_details: Mapped[Optional[Dict[str, Any]]] = mapped_column(
        CompatibleJSON,
        nullable=True,
    )


    def transition_to(
        self,
        new_status: JobStatus,
        stage_name: Optional[str] = None,
        progress_pct: Optional[int] = None,
        stage_data: Optional[Dict[str, Any]] = None,
        error_details: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Enforces authoritative state transition validation on CreativeJob.
        Raises ValueError if the transition is prohibited.
        """
        current = JobStatus(self.status)
        allowed = ALLOWED_TRANSITIONS.get(current, [])
        if new_status not in allowed:
            raise ValueError(
                f"Invalid state transition: cannot transition CreativeJob from '{current.value}' to '{new_status.value}'. "
                f"Allowed transitions from '{current.value}': {[s.value for s in allowed]}"
            )
        self.status = new_status.value
        if stage_name is not None:
            self.current_stage = stage_name
        if progress_pct is not None:
            self.progress_pct = progress_pct
        if stage_data is not None:
            current_stage_data = dict(self.stage_data or {})
            current_stage_data.update(stage_data)
            self.stage_data = current_stage_data
        if error_details is not None:
            self.error_details = error_details
