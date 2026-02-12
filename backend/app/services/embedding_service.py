from __future__ import annotations

import logging
from functools import lru_cache
import threading
from typing import Any, Protocol

from openai import OpenAI

from app.settings import get_settings

logger = logging.getLogger(__name__)


class BaseEmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...

    def dimension(self) -> int:
        ...


class OpenAIEmbeddingService:
    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = api_key
        self._model = model
        self._client = OpenAI(api_key=api_key)

    def embed(self, text: str) -> list[float]:
        text = (text or "").strip()
        if not text:
            return []

        resp = self._client.embeddings.create(
            model=self._model,
            input=text,
        )
        if not resp.data:
            return []
        return list(map(float, resp.data[0].embedding or []))

    def dimension(self) -> int:
        # Avoid an extra paid request; callers in this codebase don't require the exact value.
        return 0


class SentenceTransformerEmbeddingService:
    """Embeddings via sentence-transformers (large dependency; optional).

    This is useful for Docker/EC2 deployments that want local embeddings.
    It is generally unsuitable for Vercel due to torch/transformers size.
    """

    def __init__(
        self,
        *,
        hf_token: str | None,
        model_name: str,
        device: str = "auto",
        max_length: int = 1024,
    ) -> None:
        self._hf_token = (hf_token or "").strip()
        self._model_name = model_name
        self._device = device
        self._max_length = int(max_length)

        self._st_model: Any | None = None
        self._load_lock = threading.Lock()

    def embed(self, text: str) -> list[float]:
        if not text:
            return []
        model = self._get_model()
        vectors = model.encode([text], normalize_embeddings=True, show_progress_bar=False)
        if hasattr(vectors, "tolist"):
            vectors = vectors.tolist()
        if not vectors:
            return []
        return list(map(float, vectors[0]))

    def dimension(self) -> int:
        model = self._get_model()
        try:
            return int(model.get_sentence_embedding_dimension())
        except Exception:
            return len(self.embed("test"))

    def _get_model(self) -> Any:
        if self._st_model is not None:
            return self._st_model

        with self._load_lock:
            if self._st_model is not None:
                return self._st_model

            try:
                import torch  # type: ignore
                from sentence_transformers import SentenceTransformer  # type: ignore
            except Exception as e:
                raise RuntimeError(
                    "sentence-transformers backend is not installed. "
                    "Install sentence-transformers/torch or switch EMBEDDING_PROVIDER=openai."
                ) from e

            device = self._device
            if device == "auto":
                device = "cuda" if bool(torch.cuda.is_available()) else "cpu"

            kwargs: dict[str, Any] = {}
            if self._hf_token:
                kwargs["token"] = self._hf_token

            model = SentenceTransformer(self._model_name, device=device, **kwargs)
            try:
                model.max_seq_length = self._max_length
            except Exception:
                pass

            self._st_model = model
            logger.info("Loaded embeddings model=%s device=%s", self._model_name, device)
            return model


@lru_cache(maxsize=1)
def get_embedding_service() -> BaseEmbeddingService:
    settings = get_settings()

    provider = (settings.embedding_provider or "openai").strip().lower()
    if provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai")
        return OpenAIEmbeddingService(api_key=settings.openai_api_key, model=settings.openai_embedding_model)

    if provider in {"hf", "sentence-transformers", "sbert"}:
        return SentenceTransformerEmbeddingService(
            hf_token=settings.hf_token,
            model_name=settings.hf_embedding_model,
            device=settings.embedding_device,
            max_length=settings.embedding_max_length,
        )

    raise ValueError(f"Unknown EMBEDDING_PROVIDER: {settings.embedding_provider!r}")
