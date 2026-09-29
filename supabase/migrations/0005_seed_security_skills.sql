-- Native security skills (Fase 2 example set): independent of any model or
-- agent. These are the skills a "Security Engineer" agent definition can be
-- given — none of them are AI models, all are procedural/knowledge skills.
insert into skill_definitions (slug, name, description, category, instructions, security_level, source)
values
  ('api-security', 'API Security', 'REST/GraphQL API security review: authn/authz on every route, mass assignment, rate limiting, pagination/IDOR checks.', 'security',
   'Review each endpoint for: (1) authentication required unless explicitly public; (2) authorization scoped to the resource owner, not just "logged in"; (3) input validated server-side (never trust client-sent IDs/roles); (4) rate limiting on write/auth endpoints; (5) responses do not leak more fields than the caller is entitled to. Report findings with endpoint, method, reproduction, and remediation — never exploit beyond what is needed to prove the finding.',
   'elevated', 'custom'),
  ('owasp', 'OWASP Top 10', 'Systematic pass against the current OWASP Top 10 web application risk categories.', 'security',
   'Walk the target against each OWASP Top 10 category (access control, cryptographic failures, injection, insecure design, misconfiguration, vulnerable components, auth failures, integrity failures, logging failures, SSRF). For each applicable category, note whether it was tested, the result, and evidence. Do not test categories outside the authorized scope.',
   'elevated', 'custom'),
  ('authentication', 'Authentication Testing', 'Login, session, password-reset and MFA flow security testing.', 'security',
   'Check: credential brute-force protection/lockout, password reset token entropy and expiry, session fixation, session invalidation on logout/password change, MFA bypass paths, and secure cookie flags (HttpOnly, Secure, SameSite). Use only test accounts.',
   'elevated', 'custom'),
  ('authorization', 'Authorization Testing', 'Role/permission boundary testing (vertical and horizontal privilege escalation).', 'security',
   'For every privileged action, verify the check is server-side and scoped to the correct role AND the correct resource owner (not just "any authenticated user"). Attempt both vertical (lower role → higher-privilege action) and horizontal (user A → user B''s resource) escalation using only the provided test accounts.',
   'elevated', 'custom'),
  ('idor', 'IDOR / BOLA Testing', 'Insecure Direct Object Reference / Broken Object Level Authorization testing.', 'security',
   'Enumerate object identifiers (sequential IDs, UUIDs, slugs) referenced in requests and confirm the server rejects access to objects the current test account does not own. Use exactly two test accounts and one synthetic record per object type; never enumerate or access real user data.',
   'elevated', 'custom'),
  ('reporting', 'Security Reporting', 'Turns verified findings into a redacted, reproducible, severity-ranked report.', 'security',
   'For each finding: title, severity, confidence, affected endpoint/component, minimal reproduction steps, redacted evidence (never raw cookies/tokens/API keys/passwords/PII — replace with <REDACTED>), business impact, and remediation. Group by severity. Never include a finding that was not independently reproduced.',
   'standard', 'custom')
on conflict (slug) do nothing;

-- Best-effort link to any already-imported Agency "security" agent definitions
-- whose identity clearly maps to these skills. Silently no-ops if the agent
-- definitions have not been imported yet (see scripts/import-agency-agents.mjs);
-- re-run this block manually after importing if needed.
insert into agent_definition_skills (agent_definition_id, skill_id, sort_order)
select d.id, s.id, row_number() over (partition by d.id order by s.slug)
  from agent_definitions d
  join skill_definitions s on s.category = 'security'
 where d.division = 'security'
   and d.slug in ('penetration-tester', 'appsec-engineer')
on conflict do nothing;
