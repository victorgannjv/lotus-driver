-- Flyway migration (OceanBase / MySQL dialect). All DDL lives here, never in code.
--
-- A checkpoint no longer refuses to stamp without a photo.
--
-- The time is the evidence. A checkpoint is a timestamp, and a timestamp
-- recorded at the moment it happened is worth more than one recorded ten
-- minutes later because the driver was fighting a camera in a dark loading
-- bay with no signal. Refusing the stamp did not produce a photo -- it
-- produced a late stamp, or no stamp at all, and the late stamp is the thing
-- a claim is built on.
--
-- So the photo becomes optional at the checkpoints and can be added
-- afterwards, for as long as the trip is open. What does NOT change: the
-- proof photo on a delivery stays required. That one is the evidence, not a
-- supporting detail -- there is no timestamp that proves a parcel reached a
-- door.
--
-- Nothing is lost by this. Any step can be made mandatory again from
-- Settings > Driver app > "Steps that need a photo"; this only changes which
-- ones start that way.

UPDATE app_setting
   SET value = '',
       notes = 'Checkpoints that refuse to stamp without a photo. Empty by default: the driver can stamp now and attach the photo while the trip is still open. Delivery proof photos are required regardless and are not governed by this.'
 WHERE setting_key = 'photo_required_checkpoints';
