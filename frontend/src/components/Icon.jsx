// Inline SVG icons. Deliberately not emoji: this is a work tool used on a wide
// spread of handsets, and emoji render differently (or not at all) across them.
// Every path inherits currentColor, so an icon takes the colour of the state it
// sits in without a second variant.
const PATHS = {
  pin: (
    <>
      <path d="M8 14.6s4.9-4.4 4.9-8a4.9 4.9 0 1 0-9.8 0c0 3.6 4.9 8 4.9 8z" />
      <circle cx="8" cy="6.5" r="1.9" />
    </>
  ),
  box: (
    <>
      <path d="M8 1.9 13.9 5v6L8 14.1 2.1 11V5z" />
      <path d="M2.1 5 8 8.1 13.9 5" />
      <path d="M8 8.1v6" />
    </>
  ),
  truck: (
    <>
      <path d="M1.4 4.3h8.2v7.2H1.4z" />
      <path d="M9.6 6.9h2.9l2.1 2.3v2.3H9.6z" />
      <circle cx="4.6" cy="12.7" r="1.3" />
      <circle cx="11.9" cy="12.7" r="1.3" />
    </>
  ),
  arrow: (
    <>
      <path d="M2.4 8h10.2" />
      <path d="M9.1 4.6 12.6 8l-3.5 3.4" />
    </>
  ),
  route: (
    <>
      <path d="M6 4.2h8.2M6 8h8.2M6 11.8h8.2" />
      <circle cx="2.7" cy="4.2" r="1.1" />
      <circle cx="2.7" cy="8" r="1.1" />
      <circle cx="2.7" cy="11.8" r="1.1" />
    </>
  ),
  check: <path d="M3.1 8.4 6.4 11.7 12.9 4.8" />,
  home: (
    <>
      <path d="M2.4 7.1 8 2.4l5.6 4.7" />
      <path d="M4 8.3v5.3h8V8.3" />
    </>
  ),
  camera: (
    <>
      <path d="M1.6 5.8h2.5l1-1.7h5.8l1 1.7h2.5v7.4H1.6z" />
      <circle cx="8" cy="9.4" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6.1" />
      <path d="M8 4.5V8l2.4 1.6" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.4 14.6 13.6H1.4z" />
      <path d="M8 6.6v3.1" />
      <circle cx="8" cy="11.6" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  chevron: <path d="M6 3.6 10.4 8 6 12.4" />,
};

export default function Icon({ name, className = "h-4 w-4" }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {path}
    </svg>
  );
}

// Checkpoint -> icon. Kept here so the timeline and the history agree.
export const CHECKPOINT_ICON = {
  arrived: "pin",
  goods_ready: "box",
  loaded: "truck",
  departed: "arrow",
  deliveries_done: "check",
  returned: "home",
};
