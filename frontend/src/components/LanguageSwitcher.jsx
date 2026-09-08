import { LANGUAGES } from "../i18n/translations";
import { useLanguage } from "../i18n/LanguageContext";

// Compact EN/BM toggle for the driver header -- kept out of AppHeader itself since
// the admin surface (which reuses AppHeader) stays English-only.
export default function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex shrink-0 items-center rounded-full bg-white/10 p-0.5 text-xs font-medium">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          onClick={() => setLang(l.code)}
          className={`rounded-full px-2 py-1 ${lang === l.code ? "bg-white text-brand-black" : "text-white/70 hover:text-white"}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
