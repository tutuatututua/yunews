# yuNews – Architecture Notes

This repo is evolving toward a **service-based / clean-architecture-inspired** layout:

- **API layer** (FastAPI routers): HTTP, validation, auth dependencies
- **Service layer**: business logic / orchestration
- **Repository (data) layer**: Supabase queries / persistence details
- **Schemas**: Pydantic (backend) + TypeScript types (frontend)

The goal is **clean separation of concerns** without overengineering.

---

## Backend (FastAPI)

### Recommended structure

```
backend/app/
  api/
    deps.py                # FastAPI dependencies (DI providers)
    v1/
      router.py            # public_router / protected_router
      routers/
        recommendations.py # example: router -> service DI
        ...                # other routers (can migrate gradually)
  core/
    config.py              # Settings + get_settings()
    auth.py                # auth dependencies (API key/JWT/etc.)
    errors.py              # AppError hierarchy (safe client errors)
    exception_handlers.py  # centralized exception -> JSON mapping
    logging.py             # logging setup
    request_id.py          # middleware
    request_logging.py     # middleware
    security_headers.py    # middleware
    ...
  repositories/
    recommendations.py     # example: Supabase queries isolated here
    rag_documents.py        # Supabase RPC access for vector retrieval
    daily_summaries.py      # example: daily summaries access
    entities.py            # example: entities + summaries access
    videos.py              # example: videos + summaries access
  services/
    recommendations.py     # example: business logic + orchestration
    chat.py                # example: SSE chat orchestration
    rag_retrieval.py        # progressive broadening + dedupe logic
    daily_summaries.py      # example: daily summary shaping
    entities.py            # example: movers + per-entity chunks
    videos.py              # example: shaping + infographic logic
    ...
  schemas/
    ...                    # Pydantic response/request models
  routes/
    health.py              # public health check router
  app_factory.py           # create_app() factory (testable)
  main.py                  # ASGI entrypoint: app = create_app()
```

### What changed (implemented)

- Added an **app factory** pattern in `backend/app/app_factory.py` and updated `backend/app/main.py` to export `app = create_app()`.
- Introduced **versioned API namespace** under `backend/app/api/v1/`.
- Implemented a **DI-friendly recommendations slice**:
  - router: `backend/app/api/v1/routers/recommendations.py`
  - service: `backend/app/services/recommendations.py`
  - repository: `backend/app/repositories/recommendations.py`
- Migrated **chat** behind a `ChatService` while keeping the SSE contract and endpoints (`/chat`, `/api/chat`) unchanged:
  - router: `backend/app/api/v1/routers/chat.py`
  - service: `backend/app/services/chat.py`
- Separated **RAG retrieval** into repository + service:
  - repository: `backend/app/repositories/rag_documents.py`
  - service: `backend/app/services/rag_retrieval.py`
- Migrated **videos** to router → service → repository:
  - router: `backend/app/api/v1/routers/videos.py`
  - service: `backend/app/services/videos.py`
  - repository: `backend/app/repositories/videos.py`
- Migrated **entities** to router → service → repository:
  - router: `backend/app/api/v1/routers/entities.py`
  - service: `backend/app/services/entities.py`
  - repository: `backend/app/repositories/entities.py`
- Migrated **daily summaries** to router → service → repository:
  - router: `backend/app/api/v1/routers/daily_summaries.py`
  - service: `backend/app/services/daily_summaries.py`
  - repository: `backend/app/repositories/daily_summaries.py`
- Refactored **market data** fetching behind repo → service:
  - repository: `backend/app/repositories/market_data.py`
  - service: `backend/app/services/market_data.py`
- Abstracted the **query planner** behind an injectable service and removed direct module coupling from chat:
  - service: `backend/app/services/query_planner.py`
- Moved config to a conventional location: `backend/app/core/config.py`.
- Centralized exception handler functions in `backend/app/core/exception_handlers.py`.

### Layering rules (keep it clean)

- Routers should:
  - parse inputs (query/body/path)
  - call a service via `Depends(...)`
  - return a response envelope
- Services should:
  - implement business rules
  - orchestrate multiple repositories/external services
  - **not** know anything about HTTP/FastAPI
- Repositories should:
  - contain all Supabase/table/RPC specifics
  - return plain dicts or domain DTOs

### Auth / middleware suggestions

- Current API-key dependency approach is good for simple/private deployments.
- If you add user auth:
  - implement `get_current_user()` in `core/auth.py`
  - keep it as a **dependency** (not middleware) so public routes remain public
  - add a `core/security.py` for JWT utilities (key rotation, issuer/audience checks)

### Response formatting

- You already have a stable contract `{ data: ... }` and `{ error: ... }`.
- Keep that envelope stable; add `meta` only if you introduce pagination.

---

## Frontend (Vite + React)

### Recommended structure (feature-based)

```
frontend/src/
  api/
    client.ts             # shared HTTP client + ApiRequestError
  features/
    recommendations/
      api.ts              # feature endpoints
      queries.ts          # feature react-query hooks
      components/         # feature UI (can be migrated gradually)
      ...
  pages/                  # route-level pages
  components/             # shared UI/components
  lib/                    # pure utilities (formatting, safeUrl, errors)
  config/                 # env parsing / runtime config
  styles/                 # design tokens / css modules
  types.ts                # shared TS types
```

### What changed (implemented)

- Extracted the fetch wrapper into `frontend/src/api/client.ts`.
- Created a first feature slice for recommendations:
  - `frontend/src/features/recommendations/api.ts`
  - `frontend/src/features/recommendations/queries.ts`
- Moved chat streaming into a first-class feature module: `frontend/src/features/chat/api.ts`.

### Error handling + loading states

- Keep page-level UX simple:
  - data fetching lives in react-query hooks
  - pages decide how to render `isLoading` / `error`
  - error translation stays centralized (e.g. `src/lib/errors.ts`)

### Build / production suggestions

- Add an explicit typecheck script (optional but recommended):
  - `"typecheck": "tsc -p tsconfig.json --noEmit"`
- Prefer code-splitting by route using React Router lazy imports if/when bundles grow.

---

## Anti-patterns to avoid

- **Routes calling the database directly**: makes tests hard and couples HTTP to storage.
- **Services importing FastAPI types**: leaks transport concerns into business logic.
- **Huge all-in-one API modules**: hard to scale; split by feature and re-export.

---

## Migration strategy

This repo is intentionally migrated **incrementally**:

- Move one feature at a time into `api/` + `services/` + `repositories/` (backend) and `features/<domain>` (frontend).
- Once a feature has migrated, delete any legacy entrypoints instead of keeping shims around.
