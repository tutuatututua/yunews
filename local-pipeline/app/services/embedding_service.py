from __future__ import annotations

import logging
import threading
from typing import Any, List

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Generate embeddings for RAG documents.
    """

    def __init__(
        self,
        *,
        openai_api_key: str,
        model: str = "text-embedding-3-small",
    ) -> None:
        self._openai_api_key = (openai_api_key or "").strip()
        self._model = (model or "").strip()

        if not self._openai_api_key:
            raise RuntimeError("Missing OPENAI_API_KEY for OpenAI embeddings")
        if not self._model:
            raise RuntimeError("Missing OpenAI embedding model name")

        self._openai_client: Any | None = None
        self._load_lock = threading.Lock()
        self._dimension: int | None = None

    def embed_text(self, text: str) -> List[float]:
        vectors = self.embed_texts([text])
        return vectors[0] if vectors else []

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        client = self._get_client()
        resp = client.embeddings.create(model=self._model, input=texts)
        data = getattr(resp, "data", None) or []

        out: List[List[float]] = []
        for item in data:
            emb = getattr(item, "embedding", None)
            if not emb:
                out.append([])
                continue
            vec = list(map(float, emb))
            out.append(vec)
            if self._dimension is None:
                self._dimension = len(vec)
        return out

    def embedding_dimension(self) -> int:
        if self._dimension is not None:
            return int(self._dimension)
        vec = self.embed_text("test")
        self._dimension = len(vec)
        return int(self._dimension)

    def _get_client(self) -> Any:
        if self._openai_client is not None:
            return self._openai_client

        with self._load_lock:
            if self._openai_client is not None:
                return self._openai_client

            try:
                from openai import OpenAI
            except Exception as e:
                raise RuntimeError("Missing openai dependency for OpenAI embeddings") from e

            self._openai_client = OpenAI(api_key=self._openai_api_key)
            logger.info("Loaded embeddings provider=openai model=%s", self._model)
            return self._openai_client
