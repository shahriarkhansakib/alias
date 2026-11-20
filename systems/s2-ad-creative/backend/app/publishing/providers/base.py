from enum import Enum
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
from pydantic import BaseModel, ConfigDict


class PublishingActionClass(str, Enum):
    RETRY = "RETRY"
    RECONCILE = "RECONCILE"
    REAUTHENTICATE = "REAUTHENTICATE"
    DO_NOT_RETRY = "DO_NOT_RETRY"
    BLOCK = "BLOCK"


class PublishingProviderResult(BaseModel):
    """
    Standardized result returned by publishing providers.
    """
    model_config = ConfigDict(extra="forbid")

    success: bool
    status: str
    external_post_id: Optional[str] = None
    post_url: Optional[str] = None
    raw_response: Dict[str, Any] = {}
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    action_class: Optional[PublishingActionClass] = None
    provider_request_id: Optional[str] = None
    retry_after_seconds: Optional[int] = None
    provider_error_code: Optional[int] = None
    provider_error_subcode: Optional[int] = None
    is_mock: bool = False
    is_ambiguous: bool = False  # Set to True on network timeouts where external creation status is unknown



class PublishingProvider(ABC):
    """
    Abstract interface for social media publishing providers.
    Isolates external platform API specifics from the core publishing service.
    """

    @abstractmethod
    async def publish(
        self,
        record_id: str,
        platform: str,
        asset_bytes: bytes,
        caption: Optional[str] = None,
        platform_metadata: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        """Publishes media to the external platform."""
        pass

    @abstractmethod
    async def get_publish_status(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> PublishingProviderResult:
        """Queries status of an existing external post."""
        pass

    @abstractmethod
    async def reconcile(
        self,
        idempotency_key: str,
        account_id: Optional[str] = None,
        expected_caption: Optional[str] = None,
    ) -> Optional[PublishingProviderResult]:
        """
        Reconciles post state using provider-side idempotency after an ambiguous failure/crash.
        Returns the existing post result if found, or None if no post was created.
        """
        pass


    @abstractmethod
    async def delete_or_unpublish(
        self,
        external_post_id: str,
        account_id: Optional[str] = None,
    ) -> bool:
        """Deletes or unpublishes a previously published post if supported."""
        pass
