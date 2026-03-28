alter table if exists public.feedback_surveys
  drop constraint if exists feedback_surveys_subscription_intent_check;

alter table if exists public.feedback_surveys
  add constraint feedback_surveys_subscription_intent_check
  check (subscription_intent in ('yes', 'free_only', 'no'));

alter table if exists public.feedback_surveys
  drop constraint if exists feedback_surveys_web_helpful_check;

alter table if exists public.feedback_surveys
  add constraint feedback_surveys_web_helpful_check
  check (web_helpful is null or web_helpful in ('yes', 'slightly_yes', 'somewhat', 'slightly_no', 'no'));