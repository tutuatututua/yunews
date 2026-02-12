from __future__ import annotations

import logging
from typing import Any, List

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Generate embeddings using a Hugging Face embedding model.

    Required model for this project: `Qwen/Qwen3-Embedding-0.6B`.

    We use `sentence-transformers` which implements the model's recommended
    pooling and supports `normalize_embeddings=True` for cosine similarity.
    """

    def __init__(
        self,
        *,
        hf_token: str,
        model_name: str,
        device: str = "auto",
        max_length: int = 512,
    ) -> None:
        self._hf_token = hf_token
        self._model_name = model_name
        self._device = device
        self._max_length = max_length

        self._st_model: Any = None

    def embed_text(self, text: str) -> List[float]:
        vectors = self.embed_texts([text])
        return vectors[0] if vectors else []

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        self._ensure_loaded()

        model: Any = self._st_model
        vectors = model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False,
        )

        # SentenceTransformer returns either a numpy array or list depending on config.
        if hasattr(vectors, "tolist"):
            return vectors.tolist()
        return [list(map(float, v)) for v in vectors]

    def embedding_dimension(self) -> int:
        self._ensure_loaded()
        try:
            dim = int(self._st_model.get_sentence_embedding_dimension())
            if dim > 0:
                return dim
        except Exception:
            pass
        vec = self.embed_text("test")
        return len(vec)

    def _ensure_loaded(self) -> None:
        if self._st_model is not None:
            return

        try:
            from sentence_transformers import SentenceTransformer
        except Exception as e:
            raise RuntimeError(
                "Missing embedding dependencies. Install `sentence-transformers` (and its deps) plus `huggingface_hub`."
            ) from e

        # SentenceTransformer handles device internally.
        st_kwargs: dict[str, Any] = {}
        if self._hf_token:
            # sentence-transformers forwards token to Hugging Face Hub.
            st_kwargs["token"] = self._hf_token

        device = self._device
        if device == "auto":
            device = "cuda" if _has_cuda() else "cpu"

        model = SentenceTransformer(self._model_name, device=device, **st_kwargs)
        try:
            model.max_seq_length = int(self._max_length)
        except Exception:
            pass

        self._st_model = model

        logger.info("Loaded embedding model=%s device=%s", self._model_name, device)


def _has_cuda() -> bool:
    try:
        import torch

        return bool(torch.cuda.is_available())
    except Exception:
        return False
