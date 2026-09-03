import { Link } from "react-router-dom";
import logo from "../assets/ninjavan-logo-white.webp";

// Shared brand header: black bar, Ninja Van logo pinned top-right, an optional
// back-link and title on the left, optional extra controls (e.g. a logout button)
// just left of the logo.
export default function AppHeader({ title, backTo, right }) {
  return (
    <header className="flex items-center justify-between bg-brand-black px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {backTo && (
          <Link to={backTo} className="shrink-0 text-sm text-white/70 hover:text-white">
            ← Back
          </Link>
        )}
        {title && <h1 className="truncate text-sm font-semibold text-white">{title}</h1>}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {right}
        <img src={logo} alt="Ninja Van" className="h-5 w-auto" />
      </div>
    </header>
  );
}
