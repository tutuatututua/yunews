from __future__ import annotations

import logging
import threading
from functools import lru_cache
from typing import Any

import torch
from sentence_transformers import SentenceTransformer

from app.settings import get_settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Embeddings via sentence-transformers (same model as ingestion pipeline)."""

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

            device = self._device
            if device == "auto":
                device = "cuda" if _has_cuda() else "cpu"

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


def _has_cuda() -> bool:
    return bool(torch.cuda.is_available())


@lru_cache(maxsize=1)
def get_embedding_service() -> EmbeddingService:
    settings = get_settings()
    return EmbeddingService(
        hf_token=settings.hf_token,
        model_name=settings.hf_embedding_model,
        device=settings.embedding_device,
        max_length=settings.embedding_max_length,
    )
