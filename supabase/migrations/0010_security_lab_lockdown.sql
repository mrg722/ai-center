-- Security Lab lockdown: owner-only access + a second-factor PIN, since Strix
-- performs REAL, active exploitation attempts against its target (not a
-- passive scan) — see src/server/security/pin.ts. `security_pin_hash` is
-- null until the owner sets one for the first time (scrypt-hashed, same
-- scheme as user passwords — never stored or logged in plaintext).

alter table projects add column if not exists security_pin_hash text;
