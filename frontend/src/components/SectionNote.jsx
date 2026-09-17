// The line under a heading, and the detail behind it.
//
// Every section on the dashboard had grown a paragraph that did three or four
// jobs at once: what this is, where the numbers come from, how they are
// judged, and what to watch for. Read standing up before a meeting, that is a
// wall — and the one clause you actually needed is somewhere in the middle of
// it.
//
// So: one short line that is true every time you look, and the mechanics
// behind a disclosure for the once you need them. Same shape on every
// section, so people learn it once.
export default function SectionNote({ children, more, label = "How this is worked out" }) {
  return (
    <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
      <p>{children}</p>
      {more && (
        <details className="mt-1">
          <summary className="cursor-pointer font-medium text-slate-500 hover:text-brand-black">
            {label}
          </summary>
          {/* A rule down the left, so an open disclosure reads as a note
              attached to the heading rather than as the start of the data. */}
          <ul className="mt-1.5 space-y-1 border-l-2 border-slate-200 pl-3">{more}</ul>
        </details>
      )}
    </div>
  );
}

// One bullet: a bolded label, a colon, then the sentence that earns it.
//
// The colon is rendered here rather than typed into each `term`, so the
// format cannot drift from one bullet to the next as they are edited.
export function NoteItem({ term, children }) {
  return (
    <li>
      {term && <b className="font-semibold text-slate-600">{term}:</b>} {children}
    </li>
  );
}
