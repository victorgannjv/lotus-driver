-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Which steps a trip is made of becomes a setting.
--
-- The six checkpoints were fixed in V13 because that was the shape of the run
-- as it was described to us. It is still being worked out in practice: an
-- outlet where the goods are already staged makes "Lotus goods ready" a tap
-- with nothing behind it, and a driver who is asked for a stamp that means
-- nothing learns to fire all of them at the gate -- which costs us the
-- timestamps that DO mean something.
--
-- Adoption is the phase this is in, so the answer has to be changeable in an
-- afternoon rather than in a deploy. An admin ticks the steps the run actually
-- has; the app asks for those and skips the rest.
--
-- Two are not offered:
--   arrived         -- POST /manifests/start creates the trip and stamps it in
--                      the same breath. A trip without it does not exist.
--   deliveries_done -- the server fires it when the last drop closes. Nobody
--                      is being asked for it, so there is nothing to switch off.
--
-- Switching a step off stops the app ASKING for it. Steps already recorded on
-- past trips stay exactly where they are: this setting governs what we collect
-- next, never what we have already collected, because the recorded trail is
-- the evidence a claim is built on.
--
-- An empty value would read as "ask for nothing", which no one ever means, so
-- active_checkpoints() treats empty as "all of them".

INSERT INTO app_setting (setting_key, value, notes) VALUES
  ('active_checkpoints', 'arrived,goods_ready,loaded,departed,deliveries_done,returned',
   'Steps the driver app asks for. arrived and deliveries_done cannot be switched off.');
