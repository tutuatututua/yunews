from __future__ import annotations

from functools import lru_cache
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.config import get_settings
from app.core.token_quota import get_token_quota
from app.repositories.market_data import MarketDataRepository
from app.repositories.recommendations import RecommendationsRepository
from app.repositories.rag_documents import RagDocumentsRepository
from app.repositories.daily_summaries import DailySummariesRepository
from app.repositories.entities import EntitiesRepository
from app.repositories.videos import VideosRepository
from app.services.chat import ChatService
from app.services.embedding_service import get_embedding_service
from app.services.market_data import MarketDataService
from app.services.query_planner import QueryPlannerService
from app.services.rag_retrieval import RagRetrievalService
from app.services.recommendations import RecommendationsService
from app.services.daily_summaries import DailySummariesService
from app.services.entities import EntitiesService
from app.services.videos import VideosService


def get_supabase() -> Any:
    return get_supabase_client()


def get_recommendations_repo() -> RecommendationsRepository:
    return RecommendationsRepository(supabase=get_supabase())


def get_market_data_repo() -> MarketDataRepository:
    return MarketDataRepository()


@lru_cache(maxsize=1)
def _market_data_service_singleton() -> MarketDataService:
    # Stateless service; safe to cache per-process.
    return MarketDataService(repo=get_market_data_repo())


def get_market_data_service() -> MarketDataService:
    return _market_data_service_singleton()


def get_rag_documents_repo() -> RagDocumentsRepository:
    return RagDocumentsRepository(supabase=get_supabase())


def get_rag_retrieval_service() -> RagRetrievalService:
    return RagRetrievalService(repo=get_rag_documents_repo(), embedder=get_embedding_service())


def get_videos_repo() -> VideosRepository:
    return VideosRepository(supabase=get_supabase())


def get_entities_repo() -> EntitiesRepository:
    return EntitiesRepository(supabase=get_supabase())


def get_daily_summaries_repo() -> DailySummariesRepository:
    return DailySummariesRepository(supabase=get_supabase())


@lru_cache(maxsize=1)
def _recommendations_service_singleton() -> RecommendationsService:
    # Stateless service; safe to cache per-process.
    return RecommendationsService(repo=get_recommendations_repo(), market_data=get_market_data_service())


def get_recommendations_service() -> RecommendationsService:
    return _recommendations_service_singleton()


@lru_cache(maxsize=1)
def _videos_service_singleton() -> VideosService:
    return VideosService(repo=get_videos_repo())


def get_videos_service() -> VideosService:
    return _videos_service_singleton()


@lru_cache(maxsize=1)
def _entities_service_singleton() -> EntitiesService:
    return EntitiesService(repo=get_entities_repo())


def get_entities_service() -> EntitiesService:
    return _entities_service_singleton()


@lru_cache(maxsize=1)
def _daily_summaries_service_singleton() -> DailySummariesService:
    return DailySummariesService(repo=get_daily_summaries_repo())


def get_daily_summaries_service() -> DailySummariesService:
    return _daily_summaries_service_singleton()


@lru_cache(maxsize=1)
def _query_planner_service_singleton() -> QueryPlannerService | None:
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    return QueryPlannerService(openai_api_key=settings.openai_api_key, model=settings.openai_query_planner_model)


def get_query_planner_service() -> QueryPlannerService | None:
    return _query_planner_service_singleton()


def get_chat_service() -> ChatService:
    settings = get_settings()
    return ChatService(
        openai_api_key=settings.openai_api_key,
        chat_model=settings.openai_chat_model,
        planner=get_query_planner_service(),
        quota=get_token_quota(),
        retrieval=get_rag_retrieval_service(),
    )
