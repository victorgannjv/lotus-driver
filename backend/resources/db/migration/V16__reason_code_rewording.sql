-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- Rewords the delay reasons and fills the gaps in the list.
--
-- Two problems with the seed set in V13.
--
-- First, the wording. The driver is the one tapping these buttons, and half
-- the Ninja Van list read as a verdict on him personally -- "Driver arrived
-- late", "Driver on break", "Paperwork error". A driver asked to confess in
-- those words picks the vaguest option he can find instead, and a reason
-- nobody picks honestly is worth less than no reason at all. The attribution
-- is unchanged -- these rows are still fault_party='njv' and still come out of
-- the claim -- but they now name the SITUATION rather than the person.
--
-- Second, coverage. The list had holes (held at the gate, no vehicle at the
-- hub, receiver not in) and overlaps ("Accident on route" and "Road closure"
-- compete for the same tap; "Lotus staff shortage" swallowed "goods not
-- staged"). Overlapping options split one real cause across two codes and
-- make the ranking on the dashboard meaningless.
--
-- Codes are never deleted -- trip_checkpoint and delivery_events point at
-- them, and those rows are dispute evidence. A merged code is retired
-- (is_active = 0) so it stops being offered while its history still reads.

-- ---------------------------------------------------------------------------
-- Lotus side. Each one is a distinct thing that can be happening at the
-- outlet: nothing to load, nowhere to load, nobody to release it, no papers,
-- no system, wrong goods, told to wait, or stuck on the return.
-- ---------------------------------------------------------------------------
UPDATE reason_code SET label = 'Order not picked or staged yet',
       applies_to_gap = 'waiting_for_lotus,loading', sort_order = 10  WHERE code = 'LOT_NOT_STAGED';
UPDATE reason_code SET label = 'No loading bay free / queue at the dock',
       applies_to_gap = 'waiting_for_lotus',         sort_order = 20  WHERE code = 'LOT_NO_BAY';
UPDATE reason_code SET label = 'No outlet staff to release the goods',
       applies_to_gap = 'waiting_for_lotus,loading', sort_order = 30  WHERE code = 'LOT_STAFF';
UPDATE reason_code SET label = 'Invoice or DO not ready',
       applies_to_gap = 'waiting_for_lotus,loading', sort_order = 40  WHERE code = 'LOT_DOC';
UPDATE reason_code SET label = 'Lotus system or scanner down',
       applies_to_gap = 'any',                       sort_order = 50  WHERE code = 'LOT_SYSTEM';
UPDATE reason_code SET label = 'Order short, damaged or wrong items',
       applies_to_gap = 'loading',                   sort_order = 60  WHERE code = 'LOT_SHORT_GOODS';
UPDATE reason_code SET label = 'No empty basket or cage to take back',
       applies_to_gap = 'return_leg',                sort_order = 80  WHERE code = 'LOT_NO_BASKET';

INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order) VALUES
  ('LOT_GATE',   'Held at the gate or security check',      'lotus', 'waiting_for_lotus', 25),
  ('LOT_HOLD',   'Outlet asked us to wait',                 'lotus', 'any',               70),
  ('LOT_RETURN', 'Waiting to hand back returns at the outlet','lotus','return_leg',       85);

-- ---------------------------------------------------------------------------
-- Our side. Same facts, stated as circumstances rather than accusations, and
-- the two everyday causes the seed set had no home for: no truck ready at the
-- hub, and stops added to a trip after it was planned.
-- ---------------------------------------------------------------------------
UPDATE reason_code SET label = 'Trip started late from our side',
       applies_to_gap = 'any',                    sort_order = 110 WHERE code = 'NJV_LATE';
UPDATE reason_code SET label = 'Vehicle broke down or needed repair',
       applies_to_gap = 'any',                    sort_order = 120 WHERE code = 'NJV_VEHICLE';
UPDATE reason_code SET label = 'Not enough space on the truck',
       applies_to_gap = 'loading,departure_lag',  sort_order = 130 WHERE code = 'NJV_CAPACITY';
UPDATE reason_code SET label = 'Rest or meal break',
       applies_to_gap = 'any',                    sort_order = 145 WHERE code = 'NJV_BREAK';
UPDATE reason_code SET label = 'Correcting our own manifest or scan',
       applies_to_gap = 'any',                    sort_order = 150 WHERE code = 'NJV_PAPERWORK';
UPDATE reason_code SET label = 'Fewer drivers on today than planned',
       applies_to_gap = 'any',                    sort_order = 160 WHERE code = 'NJV_SHORTHANDED';

INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order) VALUES
  ('NJV_NO_VEHICLE', 'No vehicle ready at the hub',        'njv', 'any',                   115),
  ('NJV_LOADPLAN',   'Re-arranging the load on the truck', 'njv', 'loading,departure_lag', 140),
  ('NJV_APP',        'Our app or scanner not working',     'njv', 'any',                   155),
  ('NJV_EXTRA_STOP', 'Extra stops added to this trip',     'njv', 'delivery_round',        165);

-- ---------------------------------------------------------------------------
-- Outside anyone's control. 'Accident on route' is retired into 'Road closed,
-- diverted or blocked': from the cab they are the same stationary queue, and
-- offering both only split the count.
-- ---------------------------------------------------------------------------
UPDATE reason_code SET label = 'Heavy traffic',
       applies_to_gap = 'delivery_round,return_leg', sort_order = 210 WHERE code = 'EXT_TRAFFIC';
UPDATE reason_code SET label = 'Severe weather or flooding',
       applies_to_gap = 'any',                       sort_order = 220 WHERE code = 'EXT_WEATHER';
UPDATE reason_code SET label = 'Road closed, diverted or blocked ahead',
       applies_to_gap = 'delivery_round,return_leg', sort_order = 230 WHERE code = 'EXT_ROAD';

UPDATE reason_code SET is_active = 0 WHERE code = 'EXT_ACCIDENT';

INSERT INTO reason_code (code, label, fault_party, applies_to_gap, sort_order) VALUES
  ('EXT_RECEIVER', 'Receiver not available at the drop',           'external', 'delivery_round', 240),
  ('EXT_SITE',     'Site access restricted (guard, lift, parking)', 'external', 'delivery_round', 250);
