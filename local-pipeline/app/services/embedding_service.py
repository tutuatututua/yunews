from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any, List, Optional

import numpy as np

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Generate embeddings using the Qwen3-0.6B HuggingFace model.

    Implementation detail:
    - Loads `AutoModel` and mean-pools the last hidden state (masked by attention).
    - Produces a fixed-length float vector per input.

    Notes:
    - This is CPU/GPU heavy; for cron usage, consider caching model weights and
      running on a machine with sufficient RAM.
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

        self._tokenizer: Any = None
        self._model: Any = None
        self._torch: Any = None

    def embed_text(self, text: str) -> List[float]:
        vectors = self.embed_texts([text])
        return vectors[0] if vectors else []

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []
        self._ensure_loaded()

        torch: Any = self._torch
        tokenizer: Any = self._tokenizer
        model: Any = self._model

        with torch.no_grad():
            encoded = tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=self._max_length,
                return_tensors="pt",
            )
            encoded = {k: v.to(model.device) for k, v in encoded.items()}

            outputs = model(**encoded)
            last_hidden = outputs.last_hidden_state  # (B, T, H)
            attention_mask = encoded.get("attention_mask")  # (B, T)

            if attention_mask is None:
                pooled = last_hidden.mean(dim=1)
            else:
                mask = attention_mask.unsqueeze(-1).expand(last_hidden.size()).float()
                summed = (last_hidden * mask).sum(dim=1)
                counts = mask.sum(dim=1).clamp(min=1e-9)
                pooled = summed / counts

            pooled = pooled.detach().cpu().numpy().astype(np.float32)

        # Normalize for cosine similarity search
        norms = np.linalg.norm(pooled, axis=1, keepdims=True)
        pooled = pooled / np.clip(norms, 1e-12, None)

        return [row.tolist() for row in pooled]

    def embedding_dimension(self) -> int:
        self._ensure_loaded()
        # Try to infer from model config
        dim = getattr(self._model.config, "hidden_size", None)
        if isinstance(dim, int) and dim > 0:
            return dim
        # Fallback by embedding a tiny string
        vec = self.embed_text("test")
        return len(vec)

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return

        try:
            import torch
            try:
                from huggingface_hub import login  # type: ignore
            except Exception:  # pragma: no cover
                from huggingface_hub._login import login  # type: ignore
            from transformers import AutoModel, AutoTokenizer
        except Exception as e:
            raise RuntimeError(
                "Missing embedding dependencies. Install `transformers`, `torch`, and `huggingface_hub`."
            ) from e

        self._torch = torch

        # Login is optional for public models; token enables higher rate limits and private access.
        if self._hf_token:
            try:
                login(token=self._hf_token, add_to_git_credential=False)
            except Exception:
                logger.warning("HuggingFace login failed; continuing")

        tokenizer = AutoTokenizer.from_pretrained(self._model_name, use_auth_token=self._hf_token or None)
        model = AutoModel.from_pretrained(self._model_name, use_auth_token=self._hf_token or None)

        if self._device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            device = self._device

        model = model.to(device)
        model.eval()

        self._tokenizer = tokenizer
        self._model = model

        logger.info("Loaded embedding model=%s device=%s", self._model_name, device)
