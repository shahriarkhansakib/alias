from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class ValidationStatus(str, Enum):
    PASS = "PASS"
    WARNING = "WARNING"
    FAIL = "FAIL"


class ValidationSeverity(str, Enum):
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"


class ValidationCheckItem(BaseModel):
    code: str = Field(..., description="Machine-readable check code, e.g. 'ASSET_DOWNLOAD_SUCCESS'")
    message: str = Field(..., description="Human-readable explanation of check result")
    severity: ValidationSeverity = Field(..., description="Check severity level")
    passed: bool = Field(..., description="True if check passed or warning non-blocking")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Diagnostic metadata (e.g. width, height, mime)")


class ValidationReport(BaseModel):
    status: ValidationStatus = Field(..., description="Overall gate evaluation status: PASS, WARNING, or FAIL")
    gate_name: str = Field(..., description="Name of the gate (e.g. 'Payload Gate', 'Asset Gate')")
    summary: str = Field(..., description="High-level human-readable verdict")
    checks: List[ValidationCheckItem] = Field(default_factory=list, description="Granular check items")
    errors: List[str] = Field(default_factory=list, description="List of blocking error messages")
    warnings: List[str] = Field(default_factory=list, description="List of non-blocking warning messages")


class BriefValidationResponse(BaseModel):
    is_valid: bool
    status: ValidationStatus
    report: ValidationReport
    validated_payload: Optional[Dict[str, Any]] = None


class AssetValidationResponse(BaseModel):
    is_valid: bool
    status: ValidationStatus
    report: ValidationReport
    asset_metadata: Optional[Dict[str, Any]] = None
