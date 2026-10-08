import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import Icon from "../../components/Icon";
import SectionNote, { NoteItem } from "../../components/SectionNote";
import { formatDateTime } from "../../lib/duration";

// Where things go wrong, and who it happened to.
//
// Two questions, deliberately on one page. "Is something broken right now?" is
// answered by the health checks: a handful of yes/no tests of the system, its
// configuration and its data. "What have people actually run into?" is the
// error log: every server exception, every request the app refused, and every
// crash the driver app or these pages reported -- grouped, so fifty drivers
// hitting one bug read as one issue seen fifty times.
//
// Read-mostly. The only things an admin changes here are marking an issue
// resolved (and reopening it) and clearing resolved history; nothing on this
// page can alter trips, drivers or settings.

const SOURCE = {
  backend: { label: "Server", chip: "bg-violet-100 text-violet-800" },
  driver: { label: "Driver app", chip: "bg-sky-100 text-sky-800" },
  admin: { label: "Admin pages", chip: "bg-slate-200 text-slate-700" },
};

const KIND = {
  exception: "Server exception",
  http_error: "Request refused",
  js_error: "Script error",
  promise_rejection: "Unhandled promise",
  render_error: "Screen crashed",
  network_error: "No connection",
  gateway_error: "Gateway error",
  test: "Self-test",
};

const STATUS = {
  open: { label: "Open", chip: "bg-rose-100 text-rose-700" },
  regressed: { label: "Came back", chip: "bg-orange-100 text-orange-800" },
  resolved: { label: "Resolved", chip: "bg-emerald-100 text-emerald-800" },
};

const HEALTH = {
  ok: { tone: "bg-emerald-100 text-emerald-700", icon: "check" },
  warn: { tone: "bg-amber-100 text-amber-700", icon: "alert" },
  fail: { tone: "bg-rose-100 text-brand-red", icon: "alert" },
};

const field = "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";

// "Chrome on Android" is what someone debugging a driver's phone needs; the
// raw string is 150 characters of history.
function shortAgent(ua) {
  if (!ua) return null;
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Windows/i.test(ua) ? "Windows" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : null;
  const browser = /Edg\//i.test(ua) ? "Edge" : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\//i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : null;
  return [browser, os].filter(Boolean).join(" on ") || ua.slice(0, 40);
}

function Tile({ label, value, sub, alert }) {
  return (
    <div className={`rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 ${alert ? "border-l-4 border-brand-red" : ""}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1.5 text-3xl font-semibold tabular-nums text-brand-black">{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}
              className="font-semibold text-brand-red disabled:text-slate-300">← Previous</button>
      <span className="text-xs text-slate-500">Page {page} of {pages}</span>
      <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}
              className="font-semibold text-brand-red disabled:text-slate-300">Next →</button>
    </div>
  );
}

// ------------------------------------------------------------ health checks

function HealthPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  const run = useCallback(() => {
    setRunning(true);
    setError(null);
    api
      .get("/admin/diagnostics/health")
      .then(setData)
      .catch((e) => setError(e.detail || "Could not run the checks."))
      .finally(() => setRunning(false));
  }, []);

  useEffect(run, [run]);

  const checks = data?.checks || [];
  const rank = { fail: 0, warn: 1, ok: 2 };
  const problems = checks.filter((c) => c.status !== "ok").sort((a, b) => rank[a.status] - rank[b.status]);
  const passing = checks.filter((c) => c.status === "ok");
  const fails = problems.filter((c) => c.status === "fail").length;

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-brand-black">System health</h2>
          <SectionNote
            more={<>
              <NoteItem term="System">The server, the database, the migrations it should be on, and the secrets it needs.</NoteItem>
              <NoteItem term="Configuration">Things an admin has to set up before the app can behave: outlets, windows, reasons, an outlet for every driver.</NoteItem>
              <NoteItem term="Data">Rows the app should never have produced -- a trip with no arrival, steps out of order, a trip left open. Each is a bug in how the app was used, or in the app.</NoteItem>
              <NoteItem term="Sample data">Sample-data drivers are ignored by the data checks.</NoteItem>
            </>}
            label="What is checked"
          >
            Yes/no tests of the system, its setup and its data. A failing check usually explains a bug report before anyone files it.
          </SectionNote>
        </div>
        <div className="flex items-center gap-3">
          {data && (
            <span className="text-xs text-slate-400">Checked {formatDateTime(data.checked_at)}</span>
          )}
          <button type="button" onClick={run} disabled={running}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-50">
            {running ? "Checking…" : "Run checks again"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!data && !error && <p className="mt-3 text-sm text-slate-500">Running checks…</p>}

      {data && (
        <div className="mt-3">
          <p className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${HEALTH[data.overall].tone}`}>
            <Icon name={HEALTH[data.overall].icon} className="h-3.5 w-3.5" />
            {problems.length === 0
              ? `All ${checks.length} checks passed`
              : `${problems.length} of ${checks.length} need attention${fails ? ` (${fails} failing)` : ""}`}
          </p>

          <ul className="space-y-2">
            {problems.map((c) => (
              <li key={c.key} className="flex gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${HEALTH[c.status].tone}`}>
                  <Icon name={HEALTH[c.status].icon} className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-brand-black">
                    {c.label}
                    <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{c.group}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">{c.detail}</p>
                  {c.items.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.items.map((it) => (
                        <Link key={it.label} to={it.href}
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200">
                          {it.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {passing.length > 0 && (
            <details className="mt-3 text-sm" open={problems.length === 0}>
              <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-brand-black">
                {passing.length} passing check{passing.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 space-y-1.5">
                {passing.map((c) => (
                  <li key={c.key} className="flex items-center gap-2 text-xs text-slate-600">
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${HEALTH.ok.tone}`}>
                      <Icon name="check" className="h-2.5 w-2.5" />
                    </span>
                    <b className="font-semibold text-slate-700">{c.label}</b>
                    <span className="min-w-0 truncate text-slate-500">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}

// -------------------------------------------------------------- error log

// Everything a developer needs to be handed, in one paste.
function reportText(e) {
  return [
    `[E-${e.id}] ${KIND[e.kind] || e.kind} (${SOURCE[e.source]?.label || e.source}) at ${e.created_at}`,
    e.message,
    [e.method, e.path, e.status_code && `-> ${e.status_code}`].filter(Boolean).join(" "),
    `Who: ${e.who || "unknown"}   Build: ${e.app_build || "n/a"}`,
    `Device: ${e.user_agent || "n/a"}`,
    "",
    e.detail || "(no stack trace)",
  ].join("\n");
}

function EventDetail({ e }) {
  const [copied, setCopied] = useState(false);
  const agent = shortAgent(e.user_agent);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(e));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the text is still selectable in the box below.
    }
  }

  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-500">
        <b className="font-semibold text-slate-700">E-{e.id}</b>
        <span>{formatDateTime(e.created_at)}</span>
        {e.who && <span>{e.who}</span>}
        {agent && <span>{agent}</span>}
        {e.app_build && <span>build {e.app_build}</span>}
        <button type="button" onClick={copy} className="ml-auto font-semibold text-brand-red hover:underline">
          {copied ? "Copied" : "Copy report"}
        </button>
      </div>
      {e.detail && (
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
          {e.detail}
        </pre>
      )}
    </div>
  );
}

function Chips({ source, kind, status }) {
  return (
    <>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SOURCE[source]?.chip || "bg-slate-100"}`}>
        {SOURCE[source]?.label || source}
      </span>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
        {KIND[kind] || kind}
      </span>
      {status && (
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS[status].chip}`}>
          {STATUS[status].label}
        </span>
      )}
    </>
  );
}

function where(item) {
  return [item.method, item.path, item.status_code && `→ ${item.status_code}`].filter(Boolean).join(" ");
}

function IssueCard({ issue, days, onChanged }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const resolved = issue.status === "resolved";

  useEffect(() => {
    if (!open || events) return;
    api
      .get(`/admin/diagnostics/events?fingerprint=${issue.fingerprint}&days=${days}&page_size=10`)
      .then((d) => setEvents(d.events))
      .catch(() => setEvents([]));
  }, [open, events, issue.fingerprint, days]);

  async function toggleResolved() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/admin/diagnostics/issues/${issue.fingerprint}/${resolved ? "reopen" : "resolve"}`);
      onChanged();
    } catch (e) {
      setError(e.detail || "Could not update the issue.");
    } finally {
      setBusy(false);
    }
  }

  const edge = resolved ? "border-l-emerald-600" : issue.level === "error" ? "border-l-brand-red" : "border-l-amber-400";

  return (
    <li className={`rounded-xl border border-slate-200 border-l-4 bg-white ${edge}`}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chips source={issue.source} kind={issue.kind} status={issue.status} />
          </div>
          <p className="mt-1.5 line-clamp-3 break-words text-sm font-semibold text-brand-black">{issue.message}</p>
          {where(issue) && <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{where(issue)}</p>}
          <p className="mt-1 text-xs text-slate-500">
            Seen {issue.occurrences}×
            {issue.people > 0 && <> by {issue.people} {issue.people === 1 ? "person" : "people"}</>}
            {" · "}last {formatDateTime(issue.last_seen)}
            {issue.first_seen !== issue.last_seen && <> · first {formatDateTime(issue.first_seen)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            {open ? "Hide" : "Details"}
          </button>
          <button type="button" onClick={toggleResolved} disabled={busy}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    resolved ? "border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                             : "bg-brand-black text-white hover:bg-slate-800"}`}>
            {resolved ? "Reopen" : "Mark resolved"}
          </button>
        </div>
      </div>
      {error && <p className="px-4 pb-2 text-xs text-red-600">{error}</p>}
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-3">
          {!events ? (
            <p className="text-xs text-slate-500">Loading occurrences…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate-500">No occurrences in this period.</p>
          ) : (
            <>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Latest {events.length} occurrence{events.length === 1 ? "" : "s"}
              </p>
              {events.map((e) => <EventDetail key={e.id} e={e} />)}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function EventRow({ e }) {
  const [open, setOpen] = useState(false);
  const resolved = !!e.resolved_at;
  return (
    <li className={`rounded-xl border border-slate-200 border-l-4 bg-white ${
      resolved ? "border-l-emerald-600" : e.level === "error" ? "border-l-brand-red" : "border-l-amber-400"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left">
        <Icon name="chevron" className={`h-3 w-3 shrink-0 text-slate-400 ${open ? "rotate-90" : ""}`} />
        <span className="w-32 shrink-0 text-xs text-slate-500">{formatDateTime(e.created_at)}</span>
        <Chips source={e.source} kind={e.kind} />
        <span className="min-w-0 flex-1 basis-60 truncate text-sm text-brand-black">{e.message}</span>
        {e.who && <span className="shrink-0 truncate text-xs text-slate-400">{e.who}</span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-3">
          <p className="break-words text-sm font-semibold text-brand-black">{e.message}</p>
          {where(e) && <p className="break-all font-mono text-[11px] text-slate-500">{where(e)}</p>}
          <EventDetail e={e} />
        </div>
      )}
    </li>
  );
}

const PERIODS = [
  { value: "1", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

function ErrorLog({ reloadKey, onChanged }) {
  const [params, setParams] = useSearchParams();
  const get = (k, d = "") => params.get(k) || d;
  const tab = get("tab", "issues");
  const source = get("source");
  const level = get("level");
  const status = get("status", "open");
  const days = get("days", "7");
  const q = get("q");
  const page = Math.max(1, Number(get("page", "1")) || 1);

  const patch = useCallback((changes, { keepPage = false } = {}) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(changes)) {
        if (v === "" || v == null) next.delete(k);
        else next.set(k, String(v));
      }
      if (!keepPage) next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);

  // Typing searches after a pause, not on every keystroke.
  const [qInput, setQInput] = useState(q);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => { if (qInput !== q) patch({ q: qInput }); }, 350);
    return () => clearTimeout(t);
  }, [qInput, q, patch]);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(false);

  const query = (() => {
    const out = new URLSearchParams({ days, page: String(page) });
    if (source) out.set("source", source);
    if (level) out.set("level", level);
    if (q) out.set("q", q);
    if (tab === "issues") out.set("status", status);
    return out.toString();
  })();

  useEffect(() => {
    setData(null);
    setError(null);
    api
      .get(`/admin/diagnostics/${tab === "issues" ? "issues" : "events"}?${query}`)
      .then(setData)
      .catch((e) => setError(e.detail || "Could not load the error log."));
  }, [tab, query, reloadKey]);

  async function clearResolved() {
    if (!window.confirm("Delete every resolved entry from the log? Open issues are kept.")) return;
    setClearing(true);
    try {
      await api.post("/admin/diagnostics/clear-resolved");
      onChanged();
    } catch (e) {
      setError(e.detail || "Could not clear the log.");
    } finally {
      setClearing(false);
    }
  }

  const list = data ? (tab === "issues" ? data.issues : data.events) : null;
  const tabClass = (t) =>
    `rounded-md px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-white text-brand-black shadow-sm" : "text-slate-500"}`;

  return (
    <section id="error-log" className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-brand-black">Error log</h2>
          <SectionNote
            label="What gets logged"
            more={<>
              <NoteItem term="Server">Every unhandled exception, and every request the app refused in a way a person would notice: bad input, forbidden, "do the earlier step first", photo too large, throttled.</NoteItem>
              <NoteItem term="Driver app / Admin pages">Crashes and uncaught errors reported by the browser itself, and requests that never reached the server (no signal, a gateway answering instead). A phone with no signal holds its reports and sends them when it is back online, dated when they happened.</NoteItem>
              <NoteItem term="Not logged">Expired logins and unknown URLs -- routine, and they bury real problems. Request bodies are never stored, so no passwords, photos or form contents are logged. (An error message written by the database can still quote a value, such as a duplicate email -- that is why only admins can read this page.)</NoteItem>
              <NoteItem term="Issues">The same problem is one issue however many times it happens. Mark it resolved when it is fixed; if it happens again it comes back as "Came back".</NoteItem>
              <NoteItem term="Kept">The last 30 days, up to 20,000 entries.</NoteItem>
            </>}
          >
            Everything that went wrong for anyone, grouped by problem. A driver who sees "Reference E-123" can quote it and you can find that exact entry.
          </SectionNote>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-200/70 p-1">
          <button type="button" className={tabClass("issues")} onClick={() => patch({ tab: "" })}>Issues</button>
          <button type="button" className={tabClass("events")} onClick={() => patch({ tab: "events" })}>Every event</button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
               placeholder="Search message, path or person…"
               className={`${field} min-w-0 flex-1 basis-56`} />
        <select value={source} onChange={(e) => patch({ source: e.target.value })} className={field} aria-label="Where it happened">
          <option value="">Everywhere</option>
          {Object.entries(SOURCE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
        </select>
        <select value={level} onChange={(e) => patch({ level: e.target.value })} className={field} aria-label="Severity">
          <option value="">Errors and warnings</option>
          <option value="error">Errors only</option>
          <option value="warning">Warnings only</option>
        </select>
        {tab === "issues" && (
          <select value={status} onChange={(e) => patch({ status: e.target.value === "open" ? "" : e.target.value })}
                  className={field} aria-label="Status">
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">Open and resolved</option>
          </select>
        )}
        <select value={days} onChange={(e) => patch({ days: e.target.value === "7" ? "" : e.target.value })}
                className={field} aria-label="Period">
          {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <button type="button" onClick={clearResolved} disabled={clearing}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Clear resolved
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {!list && !error && <p className="mt-4 text-sm text-slate-500">Loading…</p>}

      {list && (
        <>
          <p className="mb-2 mt-4 text-xs text-slate-500">
            {data.total} {tab === "issues" ? (data.total === 1 ? "issue" : "issues") : (data.total === 1 ? "event" : "events")}
          </p>
          {list.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              {tab === "issues" && status === "open" && !source && !level && !q
                ? "No open issues in this period. Nothing has gone wrong that someone has not dealt with."
                : "Nothing matches these filters."}
            </p>
          ) : (
            <ul className="space-y-2">
              {tab === "issues"
                ? list.map((i) => <IssueCard key={i.fingerprint} issue={i} days={days} onChanged={onChanged} />)
                : list.map((e) => <EventRow key={e.id} e={e} />)}
            </ul>
          )}
          <Pager page={data.page} pages={data.pages} onPage={(p) => patch({ page: p }, { keepPage: true })} />
        </>
      )}
    </section>
  );
}

// -------------------------------------------------------------- self-test

function SelfTest({ onChanged }) {
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  async function browserTest() {
    setBusy("browser");
    setResult(null);
    try {
      // Straight to the endpoint rather than through the reporter, which
      // deduplicates and does not hand back the id this wants to show.
      const res = await fetch("/api/diagnostics/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "admin", kind: "test", level: "warning",
          message: "Diagnostics self-test: a report sent on purpose from the admin page",
          page: window.location.pathname,
          build: typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`The server answered HTTP ${res.status}`);
      setResult({ ok: true, text: body.id
        ? `Browser report received and logged as E-${body.id}.`
        : "Browser report received, but it was not stored (rate-limited, or no database)." });
    } catch (e) {
      setResult({ ok: false, text: `Browser report failed: ${e.message}. A browser that cannot report here cannot report real errors either.` });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  async function serverTest() {
    setBusy("server");
    setResult(null);
    try {
      await api.post("/admin/diagnostics/test-backend-error");
      setResult({ ok: false, text: "The server did not raise the test error -- something is swallowing exceptions." });
    } catch (e) {
      setResult(e.status === 500 && /Reference E-\d+/.test(e.detail || "")
        ? { ok: true, text: `Server raised the test error and logged it. It answered: "${e.detail}"` }
        : { ok: false, text: `Unexpected answer: ${e.detail || e.message}` });
    } finally {
      setBusy(null);
      onChanged();
    }
  }

  return (
    <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-base font-semibold text-brand-black">Check the error log itself</h2>
      <SectionNote>
        Sends a harmless test error from the browser and from the server, so you know a real one would reach the log.
        Test entries appear above as "Self-test" and "RuntimeError: Diagnostics self-test" -- mark them resolved.
      </SectionNote>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={browserTest} disabled={!!busy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-50">
          {busy === "browser" ? "Sending…" : "Send a test report from this browser"}
        </button>
        <button type="button" onClick={serverTest} disabled={!!busy}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-brand-black hover:bg-slate-50 disabled:opacity-50">
          {busy === "server" ? "Raising…" : "Raise a test error on the server"}
        </button>
      </div>
      {result && (
        <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-brand-red"}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- page

export default function Diagnostics() {
  const [summary, setSummary] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [, setParams] = useSearchParams();

  useEffect(() => {
    api.get("/admin/diagnostics/summary").then(setSummary).catch(() => setSummary(null));
  }, [reloadKey]);

  const changed = useCallback(() => setReloadKey((n) => n + 1), []);

  // The three boxes under the tiles double as shortcuts into the log.
  function focus(source) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("source", source);
      next.delete("page");
      return next;
    }, { replace: true });
    document.getElementById("error-log")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const s = summary;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-brand-black">Diagnostics</h1>
        <SectionNote>
          Find out what is broken, for whom, and since when -- across the server, the driver app and these admin pages.
        </SectionNote>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Errors · 24h" value={s ? s.errors_24h : "–"}
              sub={s ? `${s.open_errors_24h} not yet resolved` : " "} alert={!!s && s.open_errors_24h > 0} />
        <Tile label="Warnings · 24h" value={s ? s.warnings_24h : "–"}
              sub="Requests refused, dropped connections" />
        <Tile label="Open issues · 7 days" value={s ? s.open_issues : "–"}
              sub="Distinct problems, not occurrences" />
        <Tile label="Last entry logged" value={s ? (s.last_logged_at ? formatDateTime(s.last_logged_at).split(" · ")[1] || "" : "None") : "–"}
              sub={s?.last_logged_at ? formatDateTime(s.last_logged_at).split(" · ")[0] : s ? "Nothing logged yet" : " "} />
      </div>

      {s && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(SOURCE).map(([key, meta]) => {
            const b = s.by_source[key];
            return (
              <button key={key} type="button" onClick={() => focus(key)}
                      className="rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 hover:ring-slate-300">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.chip}`}>{meta.label}</span>
                <p className="mt-2 text-sm text-brand-black">
                  <b className={b.errors_24h ? "text-brand-red" : ""}>{b.errors_24h}</b> error{b.errors_24h === 1 ? "" : "s"}
                  {", "}<b>{b.warnings_24h}</b> warning{b.warnings_24h === 1 ? "" : "s"}
                  <span className="text-slate-400"> · 24h</span>
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {b.errors_7d} error{b.errors_7d === 1 ? "" : "s"}, {b.warnings_7d} warning{b.warnings_7d === 1 ? "" : "s"} in 7 days
                </p>
              </button>
            );
          })}
        </div>
      )}

      <ErrorLog reloadKey={reloadKey} onChanged={changed} />
      <HealthPanel />
      <SelfTest onChanged={changed} />
    </div>
  );
}
