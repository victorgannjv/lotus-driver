import { Component } from "react";

// No failure should ever be a blank screen.
//
// A throw during render unmounts the whole React tree, and without a boundary
// what is left is an empty white page — no message, nothing to tap, and no way
// for the driver to tell a bad deploy from a dead phone. That has now happened
// twice in this app: once from a chunk that no longer existed after a deploy,
// once from a bug of mine. The bugs were fixable; the silence was the part that
// made them expensive.
//
// This catches whatever is next and says something true about it, with the one
// action that usually works.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Goes to the browser console, which is where it can be read off a
    // handset over a cable when someone reports "it went white".
    console.error("Unhandled error:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    // A failed dynamic import means the page is running against a build that
    // no longer exists on the server -- worth saying plainly, because the fix
    // is different from a real bug and the driver can apply it themselves.
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(
      String(this.state.error?.message || ""),
    );

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200">
          <h1 className="text-base font-semibold text-brand-black">
            {stale ? "The app has been updated" : "Something went wrong"}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {stale
              ? "This screen is running an older version. Reload to pick up the new one."
              : "This screen could not be opened. Reloading usually clears it."}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 w-full rounded-xl bg-brand-red px-4 py-3 text-sm font-semibold text-white"
          >
            Reload
          </button>
          <a href="/driver" className="mt-2 block py-2 text-xs font-medium text-slate-500">
            Back to my trips
          </a>
        </div>
      </div>
    );
  }
}
