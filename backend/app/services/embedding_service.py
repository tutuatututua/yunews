from __future__ import annotations

import logging
from functools import lru_cache
import threading
from typing import Any, Protocol

from app.settings import get_settings

logger = logging.getLogger(__name__)


class BaseEmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...

    def dimension(self) -> int:
        ...


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
                    "Install sentence-transformers/torch to enable Qwen (HF) embeddings."
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

    return SentenceTransformerEmbeddingService(
        hf_token=settings.hf_token,
        model_name=settings.hf_embedding_model,
        max_length=settings.embedding_max_length,
    )
