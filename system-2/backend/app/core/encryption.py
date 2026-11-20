import base64
import os
from typing import Optional
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from app.core.config import settings


class TokenEncryptionService:
    """
    Authenticated encryption service for OAuth and API credentials using AES-256-GCM.
    Key must be 32 bytes (256 bits), supplied via AUTH_TOKEN_ENCRYPTION_KEY or explicit parameter.
    Format of encrypted payload: base64(12-byte-nonce + ciphertext_with_16_byte_tag).
    """

    def __init__(self, key: Optional[str] = None):
        self._raw_key = self._parse_and_validate_key(key)
        self._aesgcm = AESGCM(self._raw_key)

    @classmethod
    def _parse_and_validate_key(cls, key_str: Optional[str]) -> bytes:
        if not key_str or not isinstance(key_str, str) or not key_str.strip():
            raise ValueError("AUTH_TOKEN_ENCRYPTION_KEY is required and cannot be empty.")

        key_str = key_str.strip()
        key_bytes: Optional[bytes] = None

        # 1. Hex encoding: 64 hex characters == 32 bytes
        if len(key_str) == 64:
            try:
                key_bytes = bytes.fromhex(key_str)
            except ValueError:
                pass

        # 2. Base64 encoding: ~44 characters
        if key_bytes is None:
            try:
                decoded = base64.b64decode(key_str.encode("utf-8"), validate=True)
                if len(decoded) == 32:
                    key_bytes = decoded
            except Exception:
                pass

        # 3. Raw 32 UTF-8 characters/bytes
        if key_bytes is None:
            raw = key_str.encode("utf-8")
            if len(raw) == 32:
                key_bytes = raw

        if key_bytes is None or len(key_bytes) != 32:
            raise ValueError(
                "Invalid AUTH_TOKEN_ENCRYPTION_KEY format or length: "
                "Must represent exactly 32 bytes (256 bits). "
                "Provide a 64-character hex string, 44-character base64 string, or 32-character raw key."
            )

        return key_bytes

    def encrypt(self, plaintext: str) -> str:
        """
        Encrypts plaintext string with AES-256-GCM and a random 96-bit (12-byte) nonce.
        Returns a base64 string containing: nonce (12 bytes) + ciphertext + 16-byte authentication tag.
        """
        if not isinstance(plaintext, str):
            raise TypeError("Plaintext must be a string.")
        
        nonce = os.urandom(12)  # 96-bit standard nonce for GCM
        data = plaintext.encode("utf-8")
        ciphertext_with_tag = self._aesgcm.encrypt(nonce, data, None)
        return base64.b64encode(nonce + ciphertext_with_tag).decode("utf-8")

    def decrypt(self, encrypted_str: str) -> str:
        """
        Decrypts base64-encoded AES-256-GCM ciphertext.
        Raises ValueError if tampering detected, wrong key used, or corrupted format.
        """
        if not isinstance(encrypted_str, str):
            raise TypeError("Ciphertext must be a string.")

        try:
            raw_payload = base64.b64decode(encrypted_str.encode("utf-8"))
        except Exception as e:
            raise ValueError(f"Invalid base64 encoding in ciphertext: {e}") from e

        if len(raw_payload) < 28:  # 12 nonce + 16 tag minimum
            raise ValueError("Ciphertext payload is too short to be valid AES-256-GCM.")

        nonce = raw_payload[:12]
        ciphertext_with_tag = raw_payload[12:]

        try:
            decrypted_bytes = self._aesgcm.decrypt(nonce, ciphertext_with_tag, None)
            return decrypted_bytes.decode("utf-8")
        except Exception as e:
            raise ValueError("Decryption failed: authentication tag mismatch or invalid key.") from e


_token_encryption_service: Optional[TokenEncryptionService] = None


def get_token_encryption_service() -> TokenEncryptionService:
    """
    Returns the singleton TokenEncryptionService instance configured with settings.AUTH_TOKEN_ENCRYPTION_KEY.
    In development and testing environments, a fallback key is supplied if not set in environment.
    In production, a missing or invalid key raises ValueError at startup.
    """
    global _token_encryption_service
    if _token_encryption_service is None:
        key = getattr(settings, "AUTH_TOKEN_ENCRYPTION_KEY", None)
        if not key:
            if settings.ENVIRONMENT.lower() == "production":
                raise ValueError("AUTH_TOKEN_ENCRYPTION_KEY is strictly required in production.")
            # Deterministic development/test key (32 bytes)
            key = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        _token_encryption_service = TokenEncryptionService(key)
    return _token_encryption_service
