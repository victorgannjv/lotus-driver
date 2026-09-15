// One definition of what a delivery status looks like and reads as.
//
// There were three copies of this map — admin Orders, the driver's manifest
// page, and a job detail screen with no colours at all — so the same outcome
// appeared in three different shades and, in one place, as a raw database
// value in lower case.
//
// FAILED IS RED. It was amber, which on this palette is the colour Lotus-owned
// delay is drawn in, so a failed delivery read as a category of attribution
// rather than a parcel that did not arrive. Red is the one colour on the page
// that means "this did not happen", and it should be spent on exactly that.
export const STATUS_STYLE = {
  registered: "bg-slate-100 text-slate-700",
  delivered: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-brand-red",
  cancelled: "bg-slate-100 text-slate-500",
};

// Sentence case. The words themselves match the `statuses` table, which is
// what the Orders filter is populated from -- a chip reading "Not delivered"
// beside a dropdown offering "Failed" is two names for one thing, and the
// person filtering has to work out they are the same.
export const STATUS_LABEL = {
  registered: "Registered",
  delivered: "Delivered",
  failed: "Failed",
  cancelled: "Cancelled",
  pending: "Pending",
  arrived: "Arrived",
};

export const statusStyle = (code) => STATUS_STYLE[code] || "bg-slate-100 text-slate-700";

// Falls back to capitalising whatever arrives, so a status added to the
// database later reads as a word rather than shouting a raw code.
export const statusLabel = (code) =>
  STATUS_LABEL[code] || (code ? code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, " ") : "—");

// A drop (trip_job) stores done/failed/pending, an order (delivery_jobs)
// stores delivered/failed/registered. Two vocabularies for the same three
// outcomes; the screen should only ever show one.
const DROP_TO_STATUS = { done: "delivered", failed: "failed", pending: "pending" };

export const dropStatus = (status) => DROP_TO_STATUS[status] || status;
export const dropLabel = (status) => statusLabel(dropStatus(status));
export const dropStyle = (status) => statusStyle(dropStatus(status));
