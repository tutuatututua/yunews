from __future__ import annotations

import logging
import math
from typing import List

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Generate embeddings using OpenAI embeddings API.

    Default model: `text-embedding-3-small`.

    Notes:
    - Embeddings are L2-normalized for cosine similarity search.
    - The OpenAI client is created lazily.
    """

    def __init__(
        self,
        *,
        openai_api_key: str,
        model: str = "text-embedding-3-small",
        batch_size: int = 96,
    ) -> None:
        self._openai_api_key = openai_api_key
        self._model = model
        self._batch_size = max(1, int(batch_size))
        self._client = None

    def embed_text(self, text: str) -> List[float]:
        vectors = self.embed_texts([text])
        return vectors[0] if vectors else []

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        client = self._ensure_client()

        all_vectors: list[list[float]] = []
        for i in range(0, len(texts), self._batch_size):
            batch = texts[i : i + self._batch_size]
            batch = [(t if (t and str(t).strip()) else " ") for t in batch]

            resp = client.embeddings.create(model=self._model, input=batch)
            data = sorted(resp.data, key=lambda d: int(getattr(d, "index", 0)))
            all_vectors.extend([list(d.embedding) for d in data])

        # L2-normalize for cosine similarity search
        normalized: list[list[float]] = []
        for vec in all_vectors:
            norm = math.sqrt(sum((float(x) * float(x)) for x in vec))
            if norm <= 1e-12:
                normalized.append([float(x) for x in vec])
            else:
                inv = 1.0 / norm
                normalized.append([float(x) * inv for x in vec])

        return normalized

    def embedding_dimension(self) -> int:
        known: dict[str, int] = {
            "text-embedding-3-small": 1536,
            "text-embedding-3-large": 3072,
            "text-embedding-ada-002": 1536,
        }
        if self._model in known:
            return known[self._model]

        vec = self.embed_text("test")
        return len(vec)

    def _ensure_client(self):
        if self._client is not None:
            return self._client

        try:
            from openai import OpenAI
        except Exception as e:
            raise RuntimeError("Missing OpenAI dependency. Install `openai`.") from e

        self._client = OpenAI(api_key=self._openai_api_key)
        logger.info("Initialized OpenAI embeddings client model=%s", self._model)
        return self._client
