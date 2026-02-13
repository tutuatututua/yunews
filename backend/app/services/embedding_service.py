from __future__ import annotations

import logging
from functools import lru_cache
import threading
from typing import Any, Protocol

import httpx

from app.settings import get_settings

logger = logging.getLogger(__name__)


class BaseEmbeddingService(Protocol):
    def embed(self, text: str) -> list[float]:
        ...

    def dimension(self) -> int:
        ...


def _normalize_vector(v: Any) -> list[float]:
    if v is None:
        return []
    if hasattr(v, "tolist"):
        v = v.tolist()
    if not isinstance(v, list):
        return []
    try:
        return [float(x) for x in v]
    except Exception:
        return []


def _extract_embedding_from_response(data: Any) -> list[float]:
    """Best-effort parser for common HF/TEI/OpenAI-style embeddings responses."""

    # OpenAI-compatible: {"data": [{"embedding": [...]}, ...]}
    if isinstance(data, dict):
        if isinstance(data.get("data"), list) and data["data"]:
            first = data["data"][0]
            if isinstance(first, dict) and "embedding" in first:
                return _normalize_vector(first.get("embedding"))

        # Common keys
        for k in ("embedding", "embeddings", "vector"):
            if k in data:
                raw = data.get(k)
                if isinstance(raw, list) and raw and isinstance(raw[0], list):
                    return _normalize_vector(raw[0])
                return _normalize_vector(raw)

    # Direct vector
    if isinstance(data, list):
        if not data:
            return []
        # Sometimes nested: [[...]]
        if isinstance(data[0], list):
            return _normalize_vector(data[0])
        return _normalize_vector(data)

    return []


class OpenAIEmbeddingService:
    def __init__(self, *, api_key: str, model: str) -> None:
        self._api_key = (api_key or "").strip()
        self._model = (model or "").strip()
        self._cached_dim: int | None = None

    def embed(self, text: str) -> list[float]:
        if not text:
            return []
        if not self._api_key:
            raise RuntimeError("OPENAI_API_KEY is required for embeddings_backend=openai")

        from openai import OpenAI  # lazy import

        client = OpenAI(api_key=self._api_key)
        resp = client.embeddings.create(model=self._model, input=text)
        vec = list(map(float, resp.data[0].embedding)) if resp.data else []
        if vec and self._cached_dim is None:
            self._cached_dim = len(vec)
        return vec

    def dimension(self) -> int:
        if self._cached_dim is not None:
            return int(self._cached_dim)
        # Compute once.
        return len(self.embed("test"))


class HFHostedEmbeddingService:
    def __init__(
        self,
        *,
        endpoint_url: str,
        hf_token: str | None,
        model_name: str | None,
        timeout_seconds: float = 30.0,
    ) -> None:
        self._endpoint_url = endpoint_url.strip()
        self._hf_token = (hf_token or "").strip()
        self._model_name = (model_name or "").strip() or None
        self._timeout_seconds = float(timeout_seconds)
        self._cached_dim: int | None = None

    def embed(self, text: str) -> list[float]:
        if not text:
            return []
        if not self._endpoint_url:
            raise RuntimeError("HF_EMBEDDINGS_ENDPOINT_URL is required for embeddings_backend=hf_hosted")

        headers: dict[str, str] = {}
        if self._hf_token:
            headers["Authorization"] = f"Bearer {self._hf_token}"

        # Heuristic: if endpoint looks OpenAI-compatible, use that schema.
        is_openai_compat = "/v1/embeddings" in self._endpoint_url
        if is_openai_compat:
            payload: dict[str, Any] = {"input": text}
            if self._model_name:
                payload["model"] = self._model_name
        else:
            payload = {"inputs": text}

        with httpx.Client(timeout=self._timeout_seconds) as client:
            resp = client.post(self._endpoint_url, json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        vec = _extract_embedding_from_response(data)
        if not vec:
            raise RuntimeError(
                "HF embeddings endpoint returned an unexpected response shape. "
                "Expected an embedding vector (OpenAI-compatible /v1/embeddings or a JSON list)."
            )

        if self._cached_dim is None:
            self._cached_dim = len(vec)
        return vec

    def dimension(self) -> int:
        if self._cached_dim is not None:
            return int(self._cached_dim)
        return len(self.embed("test"))


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
                    "Install sentence-transformers/torch to enable local Hugging Face embeddings."
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

    backend = (settings.embeddings_backend or "").strip().lower()

    if backend in ("hf_hosted", "hf", "huggingface", "hf_endpoint"):
        if not settings.hf_embeddings_endpoint_url:
            raise RuntimeError(
                "embeddings_backend=hf_hosted requires HF_EMBEDDINGS_ENDPOINT_URL"
            )
        return HFHostedEmbeddingService(
            endpoint_url=settings.hf_embeddings_endpoint_url,
            hf_token=settings.hf_token,
            model_name=settings.hf_embedding_model,
            timeout_seconds=settings.hf_embeddings_request_timeout_seconds,
        )

    if backend in ("openai", "oai"):
        if not settings.openai_api_key:
            raise RuntimeError("embeddings_backend=openai requires OPENAI_API_KEY")
        return OpenAIEmbeddingService(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )

    if backend in ("sentence_transformers", "local_hf", "local"):
        return SentenceTransformerEmbeddingService(
            hf_token=settings.hf_token,
            model_name=settings.hf_embedding_model,
            max_length=settings.embedding_max_length,
        )

    raise RuntimeError(
        "Invalid EMBEDDINGS_BACKEND. Expected one of: openai, hf_hosted, sentence_transformers"
    )
