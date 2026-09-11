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
// controls (language toggle, Profile, Log out) just left of it.
//
// The left side shows EITHER a greeting or a page title, never both. A driver
// opening the app already knows which app it is -- what they need confirmed is
// who they are signed in as and which outlet they are working, since both drive
// everything that follows. Inner pages (Scan orders, Profile) still pass a
// title, because there the page name is the useful thing.
export default function AppHeader({ title, greeting, place, backTo, right }) {
  return (
    <header className="flex items-center justify-between gap-3 bg-brand-black px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {backTo && (
          <Link to={backTo} className="shrink-0 text-sm text-white/70 hover:text-white">
            ← Back
          </Link>
        )}
        {greeting ? (
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-sm font-semibold text-white">{greeting}</h1>
            {place && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/80">
                <PinIcon />
                <span className="max-w-[9rem] truncate">{place}</span>
              </span>
            )}
          </div>
        ) : (
          title && <h1 className="truncate text-sm font-semibold text-white">{title}</h1>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-5">
        {right}
        <img src={logo} alt="Ninja Van" className="h-8 w-auto" />
      </div>
    </header>
  );
}
