from datetime import datetime, timezone
from typing import Dict, Any, List
from pydantic import BaseModel, Field


class SystemHealthResponse(BaseModel):
    status: str = "healthy"
    version: str
    environment: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    database: str
    storage: str
    worker: str


class SystemStatusResponse(BaseModel):
    project_name: str
    version: str
    environment: str
    active_features: Dict[str, bool]
    configuration: Dict[str, Any]
