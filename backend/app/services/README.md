Service layer guidelines

- Keep routers thin: request parsing + response envelopes only.
- Put Supabase query composition + shaping/merging logic here.
- Raise `app.core.errors.AppError` (or subclasses) for expected failures.
- Let unexpected exceptions bubble to the global exception handler.
