import { Link } from "react-router-dom";
import logo from "../assets/ninjavan-logo-white.webp";

// Small inline pin rather than an emoji: this is a work tool, and an emoji
// renders differently on every handset the fleet carries.
function PinIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3 shrink-0"
         fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14.6s4.9-4.4 4.9-8a4.9 4.9 0 1 0-9.8 0c0 3.6 4.9 8 4.9 8z" />
      <circle cx="8" cy="6.5" r="1.9" />
    </svg>
  );
}

// Shared brand header: black bar, Ninja Van logo pinned top-right, optional
// controls (language toggle, Profile, Log out) alongside it.
//
// The left side shows EITHER a greeting or a page title, never both. A driver
// opening the app already knows which app it is -- what they need confirmed is
// who they are signed in as and which outlet they are working, since both drive
// everything that follows. Inner pages (Scan orders, Profile) still pass a
// title, because there the page name is the useful thing.
//
// TWO ROWS ON A PHONE. The greeting, the outlet chip, EN/BM, Profile, Log out
// and the logo need about 560px between them. On a 390px handset they used to
// overflow the viewport, which does not wrap or truncate -- it makes the whole
// page scroll sideways, so the driver saw a sliver of a header with the
// controls sitting over the greeting. The controls drop to their own row until
// there is width for them, rather than being made smaller until they are hard
// to hit with a thumb.
export default function AppHeader({ title, greeting, place, backTo, right, homeTo = null }) {
  const heading = greeting ? (
    <div className="flex min-w-0 items-center gap-2">
      <h1 className="truncate text-sm font-semibold text-white">{greeting}</h1>
      {place && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">
          <PinIcon />
          <span className="max-w-[6.5rem] truncate sm:max-w-[9rem]">{place}</span>
        </span>
      )}
    </div>
  ) : (
    title && <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
  );

  return (
    <header className="bg-brand-black px-4 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {backTo && (
            <Link to={backTo} className="shrink-0 text-sm text-white/70 hover:text-white">
              ← Back
            </Link>
          )}
          {heading}
        </div>

        {/* Joins the top row only when the viewport can hold it. Hidden rather
            than moved, so the one that is off screen leaves the accessibility
            tree with it. */}
        {right && <div className="hidden shrink-0 items-center gap-5 sm:flex">{right}</div>}

        {/* The logo goes home. It is the one thing on every screen and the
            place people instinctively tap to get back -- it did nothing.
            Unlinked on the signed-out screens, where there is no home yet. */}
        {homeTo ? (
          <Link to={homeTo} aria-label="Home" className="shrink-0">
            <img src={logo} alt="Ninja Van" className="h-7 w-auto sm:h-8" />
          </Link>
        ) : (
          <img src={logo} alt="Ninja Van" className="h-7 w-auto shrink-0 sm:h-8" />
        )}
      </div>

      {right && (
        <div className="mt-2 flex items-center justify-end gap-4 border-t border-white/10 pt-2 sm:hidden">
          {right}
        </div>
      )}
    </header>
  );
}
