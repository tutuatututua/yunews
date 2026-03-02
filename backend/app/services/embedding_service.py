from __future__ import annotations

from functools import lru_cache
import threading
from typing import Any, Protocol

from app.core.errors import UpstreamError
from app.core.config import get_settings


class BaseEmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...

    def dimension(self) -> int:
        ...


class OpenAIEmbeddingService:
    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = (api_key or "").strip()
        self._model = (model or "").strip()

        if not self._api_key:
            raise ValueError("Missing OPENAI_API_KEY for OpenAI embeddings")
        if not self._model:
            raise ValueError("Missing OpenAI embedding model name")

        self._client: Any | None = None
        self._load_lock = threading.Lock()
        self._dimension: int | None = None

    def embed(self, text: str) -> list[float]:
        text = (text or "").strip()
        if not text:
            return []

        client = self._get_client()
        resp = client.embeddings.create(
            model=self._model,
            input=[text],
        )
        data = getattr(resp, "data", None) or []
        if not data:
            return []

        emb = getattr(data[0], "embedding", None)
        if not emb:
            return []

        vec = list(map(float, emb))
        if self._dimension is None:
            self._dimension = len(vec)
        return vec

    def dimension(self) -> int:
        if self._dimension is not None:
            return int(self._dimension)
        return len(self.embed("test"))

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        with self._load_lock:
            if self._client is not None:
                return self._client

            try:
                from openai import OpenAI  # type: ignore
            except Exception as e:
                raise RuntimeError("openai package is required for OpenAI embeddings") from e

            self._client = OpenAI(api_key=self._api_key)
            return self._client


@lru_cache(maxsize=1)
def get_embedding_service() -> BaseEmbeddingService:
    settings = get_settings()

    class DisabledEmbeddingService:
        def __init__(self, *, reason: str) -> None:
            self._reason = (reason or "").strip() or "Embedding service disabled"

        def embed(self, text: str) -> list[float]:
            raise UpstreamError(
                message="Embedding service unavailable",
                details={"reason": self._reason},
            )

        def dimension(self) -> int:
            return 0

    api_key = str(settings.openai_api_key or "").strip()
    model = str(settings.openai_embedding_model or "").strip()

    if not api_key:
        return DisabledEmbeddingService(reason="Missing OPENAI_API_KEY")
    if not model:
        return DisabledEmbeddingService(reason="Missing OPENAI_EMBEDDING_MODEL")

    return OpenAIEmbeddingService(
        api_key=api_key,
        model=model,
    )
