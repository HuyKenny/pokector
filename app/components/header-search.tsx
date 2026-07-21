import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";

import { type Locale, localePath } from "~/lib/i18n/locales";
import type { SuggestItem } from "~/routes/api/v1.cards.suggest";

interface Labels {
  label: string;
  placeholder: string;
  resultsLabel: string;
  viewAll: string;
  noResults: string;
  /** Active locale for result links — passed from the layout so search stays
   * in-locale even on English-only routes (/app), where the URL has no
   * `:locale` param for `useLocalePath` to read. */
  locale: Locale;
  /** Full-width input (used inside the mobile menu). */
  block?: boolean;
}

/**
 * Header typeahead: debounced FTS suggestions as you type, with card thumbnails,
 * keyboard navigation (↑/↓/Enter/Esc), and a "see all results" fallback. Enter
 * with no active item runs a full search on /cards. Works on mobile too.
 */
export function HeaderSearch({
  label,
  placeholder,
  resultsLabel,
  viewAll,
  noResults,
  locale,
  block = false,
}: Labels) {
  const fetcher = useFetcher<{ items: SuggestItem[] }>();
  const lp = (path: string) => localePath(locale, path);
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const items = fetcher.data?.items ?? [];
  const showDropdown = open && value.trim().length >= 2;

  useEffect(() => () => void (debounce.current && clearTimeout(debounce.current)), []);

  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  function onChange(v: string) {
    setValue(v);
    setActive(-1);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length >= 2) {
      setOpen(true);
      debounce.current = setTimeout(() => {
        void fetcher.load(`/api/v1/cards/suggest?q=${encodeURIComponent(v.trim())}`);
      }, 250);
    } else {
      setOpen(false);
    }
  }

  function goToCard(item: SuggestItem) {
    setOpen(false);
    setValue("");
    void navigate(lp(`/cards/${item.slug}`));
  }

  function goToResults() {
    const q = value.trim();
    if (!q) return;
    setOpen(false);
    void navigate(`${lp("/cards")}?q=${encodeURIComponent(q)}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) {
        setOpen(true);
        setActive((i) => Math.min(i + 1, items.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) goToCard(items[active]);
      else goToResults();
    } else if (e.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div ref={rootRef} className={block ? "relative w-full" : "relative"}>
      <input
        type="search"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="header-search-list"
        aria-autocomplete="list"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        className={`rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-faint ${
          block ? "w-full" : "w-36 sm:w-52"
        }`}
      />
      {showDropdown ? (
        <div className="absolute end-0 z-50 mt-1 w-80 max-w-[85vw] overflow-hidden rounded-lg border border-edge bg-surface shadow-(--shadow-card)">
          {fetcher.state === "loading" && items.length === 0 ? (
            <div className="p-3">
              <div className="skeleton h-12 w-full" aria-hidden="true" />
            </div>
          ) : items.length > 0 ? (
            <ul
              id="header-search-list"
              role="listbox"
              aria-label={resultsLabel}
              className="max-h-96 overflow-auto py-1"
            >
              {items.map((it, i) => (
                <li key={it.slug} role="option" aria-selected={i === active}>
                  <Link
                    to={lp(`/cards/${it.slug}`)}
                    onClick={() => goToCard(it)}
                    className={`flex items-center gap-3 px-3 py-2 hover:bg-surface-raised ${
                      i === active ? "bg-surface-raised" : ""
                    }`}
                  >
                    {it.imageSmallUrl ? (
                      <img
                        src={it.imageSmallUrl}
                        alt=""
                        loading="lazy"
                        className="h-12 w-9 shrink-0 rounded border border-edge object-cover"
                      />
                    ) : (
                      <span className="h-12 w-9 shrink-0 rounded border border-edge bg-surface-raised" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{it.name}</span>
                      <span className="block truncate text-xs text-fg-faint">
                        {it.setName} · #{it.number}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={goToResults}
                  className="w-full px-3 py-2 text-start text-xs font-medium text-accent hover:bg-surface-raised"
                >
                  {viewAll}
                </button>
              </li>
            </ul>
          ) : (
            <p className="p-3 text-sm text-fg-muted">{noResults}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
