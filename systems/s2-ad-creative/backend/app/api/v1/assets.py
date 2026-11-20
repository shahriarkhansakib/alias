from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.schemas.validation import AssetValidationResponse
from app.services.asset_gate import asset_gate_service

router = APIRouter(prefix="/assets", tags=["Asset Gate"])


class ValidateAssetUrlRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2000, description="Product image URL to inspect")
    require_transparency: bool = Field(
        default=True,
        description="Whether a genuine transparent cutout is strictly required",
    )
    allow_local_demo: bool = Field(
        default=True,
        description="Allow local development demo asset endpoints",
    )


@router.post("/validate-url", response_model=AssetValidationResponse)
async def validate_asset_url(req: ValidateAssetUrlRequest):
    """
    Runs the Asset Gate against a product asset URL:
    - SSRF prevention & private network blocking
    - Content-type & magic byte inspection
    - Decompression corruption check
    - Resolution threshold check
    - Alpha channel & cutout transparency calculation
    """
    return await asset_gate_service.validate_url_and_asset(
        url=req.url,
        require_transparency=req.require_transparency,
        allow_local_demo=req.allow_local_demo,
    )
