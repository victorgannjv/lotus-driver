-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Marks a user as sample data.
--
-- Showcase trips run through the real tables and the real scoring code -- a
-- demo built on a separate mock path proves the mock works, not the product.
-- The safety comes from ownership instead: every demo row hangs off a user
-- with is_demo = 1, so "remove the sample data" is a complete and checkable
-- delete rather than a guess about which rows were pretend.
--
-- A real driver can never be caught by it: the flag is only ever set by the
-- seeder, and the reset only ever deletes rows whose owner carries it.
--
-- Additive migration -- nothing existing is touched, and every existing user
-- defaults to 0.

ALTER TABLE users ADD COLUMN is_demo TINYINT(1) NOT NULL DEFAULT 0;

CREATE INDEX idx_users_demo ON users (is_demo);
