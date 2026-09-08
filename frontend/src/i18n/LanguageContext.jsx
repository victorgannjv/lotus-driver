import { createContext, useContext, useMemo, useState } from "react";
import { translations } from "./translations";

const STORAGE_KEY = "lotus_driver_lang";
const LanguageContext = createContext(null);

function readStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && translations[stored] ? stored : "en";
  } catch {
    return "en";
  }
}

function lookup(dict, key) {
  return key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), dict);
}

function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match));
}

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang);

  function setLang(next) {
    if (!translations[next]) return;
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private browsing, etc.) -- the choice just won't persist.
    }
  }

  const t = useMemo(() => {
    return (key, vars) => {
      const value = lookup(translations[lang], key) ?? lookup(translations.en, key) ?? key;
      return interpolate(value, vars);
    };
  }, [lang]);

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
