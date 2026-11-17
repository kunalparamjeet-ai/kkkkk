-- VEKTOR AI — Seed Data (seed.sql)
-- Idempotent seed script for plans, AI providers, models, and task routing matrix.

INSERT INTO plans (id, slug, name, audience, monthly_price_usd, annual_price_usd, monthly_price_inr, monthly_credits, max_projects, rate_limit_rpm, daily_request_limit, custom_domains_enabled, features, sort_order)
VALUES
  ('plan_free', 'free', 'Free', 'For solo exploration', 0, 0, 0, 500, 3, 20, 200, FALSE, '["500 monthly credits", "20 RPM / 200 daily API requests", "Up to 3 active projects", "VEKTOR Managed Hosting"]'::jsonb, 1),
  ('plan_basic', 'basic', 'Basic', 'For solo API developers', 9, 7, 749, 1500, 8, 40, 1000, FALSE, '["1,500 monthly credits", "40 RPM / 1,000 daily API requests", "Up to 8 projects", "Full VEKTOR API Gateway access"]'::jsonb, 2),
  ('plan_starter', 'starter', 'Starter', 'For independent builders', 19, 15, 1599, 3000, 15, 60, 2500, FALSE, '["3,000 monthly credits", "60 RPM / 2,500 daily API requests", "GitHub OAuth & branch sync", "Priority VEKTOR Coding Model routing"]'::jsonb, 3),
  ('plan_pro', 'pro', 'Pro', 'For production shipping', 49, 39, 3999, 10000, 50, 180, 10000, TRUE, '["10,000 monthly credits", "180 RPM / 10,000 daily API requests", "Custom domains with SSL", "50 active projects"]'::jsonb, 4),
  ('plan_business', 'business', 'Business', 'For product teams', 129, 99, 10499, 35000, 200, 600, 50000, TRUE, '["35,000 monthly credits", "600 RPM / 50,000 daily API requests", "Multi-provider fallback routing", "Custom domains & audit logs"]'::jsonb, 5),
  ('plan_agency', 'agency', 'Agency', 'For client delivery studios', 299, 239, 24999, 100000, 1000, 1500, 150000, TRUE, '["100,000 monthly credits", "1,500 RPM / 150k daily API requests", "White-label hosted slugs", "1,000 client workspaces"]'::jsonb, 6),
  ('plan_enterprise', 'enterprise', 'Enterprise', 'For large-scale organizations', 799, 649, 64999, 350000, 10000, 5000, 1000000, TRUE, '["350,000+ monthly credits", "5,000 RPM / 1M+ daily API requests", "Self-hosted VEKTOR weights VPC", "Custom SLA & SSO/SAML"]'::jsonb, 7)
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_providers (id, name, kind, base_url, api_key_env_var, enabled, status)
VALUES
  ('prov_vektor_self_hosted', 'VEKTOR Inference Server', 'vektor_self_hosted', NULL, 'VEKTOR_INFERENCE_API_KEY', TRUE, 'unconfigured'),
  ('prov_gemini', 'Google Gemini', 'gemini', 'https://generativelanguage.googleapis.com', 'GEMINI_API_KEY', TRUE, 'available'),
  ('prov_openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'OPENAI_API_KEY', TRUE, 'unconfigured'),
  ('prov_deepseek', 'DeepSeek', 'deepseek', 'https://api.deepseek.com/v1', 'DEEPSEEK_API_KEY', TRUE, 'unconfigured')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_models (id, provider_id, model_identifier, display_name, role_tag, input_credits_per_1k, output_credits_per_1k, max_context_tokens, supports_streaming, enabled, is_preferred_coding)
VALUES
  ('vektor-orchestrator-1', 'prov_vektor_self_hosted', 'vektor-orchestrator-1', 'VEKTOR Senior Orchestrator', 'Central Orchestrator', 1.0, 2.0, 128000, TRUE, TRUE, FALSE),
  ('vektor-coder-1', 'prov_vektor_self_hosted', 'vektor-coder-1', 'VEKTOR Coding Model', 'Preferred Coding Engine', 0.8, 1.5, 128000, TRUE, TRUE, TRUE),
  ('gemini-4-hydrogen', 'prov_gemini', 'gemini-4-hydrogen', 'Gemini 4 Hydrogen', 'App Creation & UI/UX', 1.0, 2.0, 1000000, TRUE, TRUE, FALSE),
  ('gpt-4.1', 'prov_openai', 'gpt-4.1', 'OpenAI GPT-4.1', 'Complex Reasoning', 2.5, 5.0, 128000, TRUE, TRUE, FALSE),
  ('deepseek-coder', 'prov_deepseek', 'deepseek-coder', 'DeepSeek Coder', 'Technical & Debugging', 0.6, 1.2, 128000, TRUE, TRUE, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_routing_rules (task_type, primary_model_id, fallback_model_id, description)
VALUES
  ('orchestration', 'vektor-orchestrator-1', 'gemini-4-hydrogen', 'Senior request decomposition, delegation, and synthesis'),
  ('coding', 'vektor-coder-1', 'gemini-4-hydrogen', 'Fast full-stack code synthesis and file edits'),
  ('app_creation', 'gemini-4-hydrogen', 'vektor-coder-1', 'End-to-end web application scaffolding'),
  ('reasoning', 'gpt-4.1', 'gemini-4-hydrogen', 'Architectural trade-offs and multi-step logic'),
  ('design_ux', 'gemini-4-hydrogen', 'vektor-coder-1', 'Visual hierarchy, layout structure, and CSS design'),
  ('testing_debug', 'deepseek-coder', 'gemini-4-hydrogen', 'Static checks, edge cases, and verification'),
  ('publishing', 'vektor-orchestrator-1', 'gemini-4-hydrogen', 'Build packaging, bundle manifest, and deployment')
ON CONFLICT (task_type) DO NOTHING;
