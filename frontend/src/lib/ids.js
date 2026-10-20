// The id a person reads and quotes for a driver: "D-12".
//
// Jobs are "J-" and trips are "T-" followed by their database id, and a driver
// is the same. The id is permanent and unique and never reused, so it still
// means the same person after a rename, and "D-12" in a message can be found
// with a search box. Gaps in the numbering are expected (staff accounts share
// the table), which is why nothing should read meaning into the number.
export const driverCode = (id) => (id == null ? "" : `D-${id}`);
