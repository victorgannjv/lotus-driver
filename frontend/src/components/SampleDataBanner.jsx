import { useEffect, useState } from "react";
import { api } from "../api";
import Icon from "./Icon";

// Shown on every admin page while sample data is loaded, not just on the
// Settings tab that loaded it.
//
// This app's only real output is a number someone takes to Lotus. A dashboard
// carrying four weeks of invented trips looks exactly like a dashboard carrying
// four weeks of real ones, and a screenshot taken during a demo does not
// remember which it was. The banner is the difference between a showcase and a
// figure nobody can defend later.
export default function SampleDataBanner() {
  const [state, setState] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get("/admin/config/demo")
      .then((d) => { if (!cancelled) setState(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!state?.loaded) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-amber-100 px-4 py-2.5 text-sm text-amber-900 ring-1 ring-amber-300">
      <Icon name="alert" className="h-4 w-4 shrink-0" />
      <span>
        <b>Sample data is loaded.</b> Figures below include {state.trips} example trips and are not
        a record of real work.
      </span>
      <a href="/admin/config/sample" className="font-semibold underline">Remove it</a>
    </div>
  );
}
