-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- The vehicle and the handheld app are Lotus-provided, so failures of either
-- are Lotus's cost, not ours.
--
-- V13 and V16 had these under Ninja Van on the assumption that a truck and a
-- scanner are our kit. They are not on this contract. Attributing our
-- counterparty's equipment failure to ourselves is the most expensive kind of
-- mistake this app can make: it hands back time we are entitled to claim, and
-- it does it silently, because a conceded minute never appears in a dispute.
--
-- Changed in place rather than retired-and-replaced. Fault attribution is
-- computed on read, so moving the party re-scores every past trip that used
-- these codes -- which is the correct outcome. They were always Lotus's
-- minutes; we were simply counting them wrong.
--
-- The codes keep their NJV_ prefix. Renaming a primary key would orphan the
-- trip_checkpoint rows that reference it, and the prefix is internal -- no
-- screen in the app shows it. The label and the party are what anyone reads.

-- Lotus supplies the vehicle: a breakdown, a truck that never turned up, and a
-- truck too small for the load are all consequences of what they provided.
UPDATE reason_code SET fault_party = 'lotus',
       label = 'Vehicle breakdown (Lotus vehicle)',
       applies_to_gap = 'any',                   sort_order = 86 WHERE code = 'NJV_VEHICLE';
UPDATE reason_code SET fault_party = 'lotus',
       label = 'No vehicle ready for the run',
       applies_to_gap = 'any',                   sort_order = 87 WHERE code = 'NJV_NO_VEHICLE';
UPDATE reason_code SET fault_party = 'lotus',
       label = 'Vehicle too small for the load',
       applies_to_gap = 'loading,departure_lag', sort_order = 88 WHERE code = 'NJV_CAPACITY';

-- Lotus supplies the app and the scanner, so an app failure and their system
-- being down are the same fault from the driver's seat. Offering both split one
-- cause across two codes; NJV_APP is retired into LOT_SYSTEM, which widens to
-- name all three.
UPDATE reason_code SET label = 'Lotus system, app or scanner down'
       WHERE code = 'LOT_SYSTEM';
UPDATE reason_code SET is_active = 0, fault_party = 'lotus' WHERE code = 'NJV_APP';

-- ---------------------------------------------------------------------------
-- What is genuinely ours once the equipment is Lotus's: our people, our
-- planning, our paperwork. A shorter list than before, and honestly so.
-- ---------------------------------------------------------------------------
UPDATE reason_code SET label = 'Trip started late from our side',
       applies_to_gap = 'any',                   sort_order = 110 WHERE code = 'NJV_LATE';
UPDATE reason_code SET label = 'Fewer drivers on today than planned',
       applies_to_gap = 'any',                   sort_order = 120 WHERE code = 'NJV_SHORTHANDED';
UPDATE reason_code SET label = 'Re-arranging the load on the truck',
       applies_to_gap = 'loading,departure_lag', sort_order = 140 WHERE code = 'NJV_LOADPLAN';
UPDATE reason_code SET label = 'Rest or meal break',
       applies_to_gap = 'any',                   sort_order = 150 WHERE code = 'NJV_BREAK';
UPDATE reason_code SET label = 'Correcting our own manifest or paperwork',
       applies_to_gap = 'any',                   sort_order = 160 WHERE code = 'NJV_PAPERWORK';
UPDATE reason_code SET label = 'Extra stops added to this trip',
       applies_to_gap = 'delivery_round',        sort_order = 170 WHERE code = 'NJV_EXTRA_STOP';

-- The one gap left on our side: a driver who cannot finish the run, which is
-- not the same as being short-handed from the start of the day.
INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order) VALUES
  ('NJV_RELIEF', 'Waiting for a replacement driver', 'njv', 'any', 130);
