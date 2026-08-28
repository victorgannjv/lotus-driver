-- Bootstrap the admin allowlist. This row's email is matched against the
-- X-Forwarded-Email header injected by the Substrait platform's Google SSO proxy
-- once SSO is enabled for this app (portal Access tab, a manual post-deploy step) --
-- there is no password login for admins. Further admins can be added later via
-- POST /api/admin/users once at least one admin can sign in.
INSERT INTO users (role, email, name, status) VALUES
  ('admin', 'victor.gan@ninjavan.co', 'Victor Gan', 'active');
