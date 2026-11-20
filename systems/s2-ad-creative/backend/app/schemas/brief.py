from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, HttpUrl, field_validator, model_validator, ConfigDict
import re

HEX_COLOR_REGEX = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")


class AdvertisingObjective(str, Enum):
    PRODUCT_SALES = "product_sales"
    BRAND_AWARENESS = "brand_awareness"
    LEAD_GENERATION = "lead_generation"
    ENGAGEMENT = "engagement"
    TRAFFIC = "traffic"


class TargetPlatform(str, Enum):
    INSTAGRAM = "instagram"
    FACEBOOK = "facebook"
    LINKEDIN = "linkedin"


class AssetType(str, Enum):
    PRIMARY_PRODUCT = "primary_product"
    DETAIL_VIEW = "detail_view"
    LIFESTYLE_REFERENCE = "lifestyle_reference"


class BrandInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=100, description="Brand name (required)")
    logo_url: Optional[str] = Field(None, max_length=1000, description="Brand logo URL (optional)")
    colors: Optional[List[str]] = Field(
        default_factory=list,
        max_length=10,
        description="Brand hex colors, e.g. ['#2563EB', '#111827']",
    )
    font_family: Optional[str] = Field(None, max_length=100, description="Preferred font family")

    @field_validator("colors")
    @classmethod
    def validate_hex_colors(cls, colors: Optional[List[str]]) -> Optional[List[str]]:
        if not colors:
            return colors
        for c in colors:
            if not HEX_COLOR_REGEX.match(c):
                raise ValueError(f"Invalid hex color format: '{c}'. Expected #RGB or #RRGGBB.")
        return colors


class ProductAssetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., min_length=1, max_length=1500, description="Product image asset URL (required)")
    asset_type: AssetType = Field(default=AssetType.PRIMARY_PRODUCT, description="Type of asset")
    description: Optional[str] = Field(None, max_length=300, description="Asset context or angle")


class OfferInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    price: float = Field(..., ge=0, description="Current selling price (required, must be >= 0)")
    original_price: Optional[float] = Field(None, ge=0, description="Original reference price for discounts")
    currency: str = Field(default="USD", min_length=1, max_length=10, description="Currency code (e.g. USD, BDT, EUR)")
    discount_percent: Optional[float] = Field(None, ge=0, le=100, description="Discount percentage (0-100)")
    promo_code: Optional[str] = Field(None, max_length=50, description="Optional coupon or promo code")

    @model_validator(mode="after")
    def validate_offer_consistency(self) -> "OfferInfo":
        if self.original_price is not None and self.original_price < self.price:
            raise ValueError(
                f"Original price ({self.original_price}) cannot be less than selling price ({self.price})."
            )
        return self


class ProductInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(..., min_length=1, max_length=150, description="Product name (required)")
    category: Optional[str] = Field(None, max_length=100, description="Product category")
    sku: Optional[str] = Field(None, max_length=50, description="SKU or product identifier")
    offer: OfferInfo = Field(..., description="Offer and pricing details (required)")
    features: List[str] = Field(
        default_factory=list,
        max_length=20,
        description="Approved factual product features (e.g. '7-day battery')",
    )

    @field_validator("features")
    @classmethod
    def validate_feature_items(cls, features: List[str]) -> List[str]:
        for item in features:
            if len(item) > 200:
                raise ValueError(f"Feature text '{item[:30]}...' exceeds maximum limit of 200 characters.")
        return features


class CopySpecification(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: Optional[str] = Field(None, max_length=120, description="Supplied headline (optional)")
    subheadline: Optional[str] = Field(None, max_length=250, description="Supplied subheadline (optional)")
    cta: Optional[str] = Field(None, max_length=35, description="Supplied CTA, e.g. 'Shop Now' (optional)")


class CampaignInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(None, max_length=150, description="Campaign identifier or name")
    objective: AdvertisingObjective = Field(
        default=AdvertisingObjective.PRODUCT_SALES,
        description="Advertising objective",
    )
    platforms: List[TargetPlatform] = Field(
        ...,
        min_length=1,
        max_length=5,
        description="Target platforms (at least one required)",
    )
    target_audience: Optional[str] = Field(None, max_length=300, description="Target demographic description")

    @field_validator("platforms")
    @classmethod
    def validate_unique_platforms(cls, platforms: List[TargetPlatform]) -> List[TargetPlatform]:
        if len(platforms) != len(set(platforms)):
            raise ValueError("Duplicate platforms specified. Each target platform must be unique.")
        return platforms


class FinalAdBriefPayload(BaseModel):
    """
    Final Ad Brief - The single source of truth entering the creative pipeline.
    Distinguishes strictly between required ground truth and optional brand assets.
    """
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    brand: BrandInfo = Field(..., description="Brand specifications (required)")
    product: ProductInfo = Field(..., description="Product data and offer (required)")
    images: List[ProductAssetInput] = Field(
        ...,
        min_length=1,
        max_length=10,
        description="Product image assets (at least 1 required)",
    )
    campaign: CampaignInfo = Field(..., description="Campaign targeting and objective (required)")
    approved_claims: List[str] = Field(
        default_factory=list,
        max_length=30,
        description="Approved claims that AI strategist is permitted to rephrase",
    )
    ad_copy: Optional[CopySpecification] = Field(
        default_factory=CopySpecification,
        validation_alias="copy",
        serialization_alias="copy",
        description="Explicit copy overrides if already provided by customer",
    )

    @field_validator("approved_claims")
    @classmethod
    def validate_claims(cls, claims: List[str]) -> List[str]:
        for claim in claims:
            if len(claim) > 300:
                raise ValueError(f"Claim exceeds maximum length of 300 characters: '{claim[:30]}...'")
        return claims
