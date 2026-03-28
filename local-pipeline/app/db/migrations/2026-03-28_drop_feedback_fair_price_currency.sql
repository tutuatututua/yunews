alter table if exists public.feedback_surveys
  drop constraint if exists feedback_surveys_currency_check;

alter table if exists public.feedback_surveys
  drop column if exists fair_price_currency;