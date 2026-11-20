from typing import List
from fastapi import APIRouter
from app.platforms.registry import list_supported_platforms, PlatformDefinition

router = APIRouter(prefix="/platforms", tags=["Platforms"])


@router.get("", response_model=List[PlatformDefinition])
async def get_supported_platforms():
    """
    Returns authoritative platform creative specifications from the platform registry.
    Ensures frontend consumes backend-authoritative canvas dimensions, aspect ratios, and safe slots.
    """
    return list_supported_platforms()
