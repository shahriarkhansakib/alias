from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, BinaryIO
from pydantic import BaseModel


class StorageProvider(ABC):
    """
    Abstract interface for object/file storage (Local filesystem or S3/R2).
    """

    @abstractmethod
    async def save_bytes(self, data: bytes, key: str, content_type: str = "image/png") -> str:
        """Saves binary data and returns a resource URI/key."""
        pass

    @abstractmethod
    async def get_bytes(self, key: str) -> bytes:
        """Retrieves binary data by key."""
        pass

    @abstractmethod
    async def get_public_url(self, key: str) -> str:
        """Returns accessible public or signed URL for the asset."""
        pass

    @abstractmethod
    async def exists(self, key: str) -> bool:
        """Checks if a given key exists in storage."""
        pass

    @abstractmethod
    async def delete(self, key: str) -> bool:
        """Deletes an object by key. Returns True if deleted or already absent."""
        pass

    @abstractmethod
    async def get_metadata(self, key: str) -> Dict[str, Any]:
        """Retrieves object metadata (size_bytes, content_type, sha256, last_modified, etc.)."""
        pass



class LLMStrategyProvider(ABC):
    """
    Abstract interface for LLM Creative Strategist.
    (AI decides the creative direction, does not render final image).
    """

    @abstractmethod
    async def generate_creative_strategy(
        self,
        brief_data: Any,
        attempt: int = 1,
        feedback: Optional[str] = None,
    ) -> Any:
        pass


class ImageGenProvider(ABC):
    """
    Abstract interface for generating visual background/scenery ONLY.
    (Must not generate product, text, price, or CTA).
    """

    @abstractmethod
    async def generate_background(
        self,
        visual_prompt: str,
        width: int,
        height: int,
        negative_prompt: Optional[str] = None,
    ) -> bytes:
        pass


class VisionQAProvider(ABC):
    """
    Abstract interface for Vision QA.
    Treats Vision QA scores as advisory signals, not absolute ground truth.
    """

    @abstractmethod
    async def evaluate_creative(
        self,
        image_bytes: bytes,
        spec: Dict[str, Any],
    ) -> Dict[str, Any]:
        pass


class JobWorker(ABC):
    """
    Abstract background job worker interface.
    Allows zero-dependency in-process async execution in dev and Celery in prod.
    """

    @abstractmethod
    async def enqueue_job(self, job_id: str, payload: Dict[str, Any]) -> None:
        pass
