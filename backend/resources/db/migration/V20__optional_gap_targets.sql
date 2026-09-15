-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Time allowances become optional, and start switched off.
--
-- The per-step allowances (15m waiting for Lotus, 30m loading, and so on) were
-- seeded in V13 as working numbers while the contract was still being read.
-- They are not agreed with Lotus. What IS agreed is the delivery window --
-- 09:30-12:00 and the rest -- and that is what a claim is actually built on.
--
-- Leaving unagreed numbers switched on makes the app assert things it cannot
-- defend: a trip flagged red against a 15-minute bar nobody signed is an
-- argument Lotus wins by asking where the 15 came from. Worse, it teaches ops
-- to read red as "disputable" when the only disputable fact is the window.
--
-- So: a master switch, off; and a switch per allowance, so a number can be
-- turned on individually once it has actually been negotiated. The rows keep
-- their values -- nothing is deleted, and turning the feature on restores
-- exactly the behaviour that existed before this migration.
--
-- Everything downstream already copes: resolve_target returning None makes
-- over_target false, which removes the flag, the reason prompt and the
-- attribution in one move rather than needing a branch in each.

ALTER TABLE gap_target ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1;

INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('gap_targets_enabled', 'false',
   'Master switch for per-step time allowances. Off until the targets are agreed with Lotus; delivery windows decide lateness on their own.');
