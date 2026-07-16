// Shared themed dropdown controls, replacing native <select> elements whose
// popup menus render as dark OS-styled lists that clash with the Roamly
// palette. ThemedSelect is a straight listbox; SearchableSelect adds a filter
// box for long lists (e.g. Planned Study tasks). Both:
//  * match the app's card/border/primary theme variables,
//  * work with mouse, touch, and full keyboard control (arrows, Home/End,
//    Enter/Space, Escape, plus type-ahead on ThemedSelect),
//  * flip upward when there isn't room below and scroll internally,
//  * stay inside the viewport on small screens (menu width is clamped),
//  * expose listbox/option semantics for screen readers.
//
// While a menu is open the component root carries data-dropdown-open="true";
// Modal's Escape handler checks for it so Escape closes the dropdown first,
// not the dialog around it (mirroring how a native <select> eats Escape).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string; // small secondary line under the label
  accent?: string; // optional color dot before the label (subject colors)
};

const TRIGGER_CLASS =
  "flex h-full min-h-[2.5rem] w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition hover:border-primary/50 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50";
const MENU_CLASS =
  "absolute z-50 min-w-full max-w-[min(22rem,calc(100vw-2.5rem))] rounded-2xl border border-border bg-card p-1.5 shadow-xl";
const OPTION_CLASS =
  "flex w-full min-h-[2.75rem] items-center gap-2 rounded-xl px-3 py-2 text-left text-sm outline-none transition";

function optionStateClass(selected: boolean, active: boolean) {
  if (selected) return `${OPTION_CLASS} bg-primary/10 font-medium text-primary`;
  if (active) return `${OPTION_CLASS} bg-primary/5 text-foreground`;
  return `${OPTION_CLASS} text-foreground hover:bg-primary/5`;
}

// Shared close-on-outside-press behavior. Escape is handled on the elements
// themselves (not document) so an open menu inside a Modal wins the keypress.
function useOutsideClose(open: boolean, rootRef: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, rootRef, close]);
}

// Decide whether the menu opens downward or flips above the trigger, from the
// real space around the trigger at open time.
function shouldDropUp(trigger: HTMLElement | null, optionCount: number): boolean {
  if (!trigger) return false;
  const rect = trigger.getBoundingClientRect();
  const estimated = Math.min(288, optionCount * 46 + 16);
  const below = window.innerHeight - rect.bottom;
  return below < estimated + 12 && rect.top > below;
}

function OptionRow({ option, selected }: { option: SelectOption; selected: boolean }) {
  return (
    <>
      {option.accent && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: option.accent }} />}
      <span className="min-w-0 flex-1">
        <span className="block break-words leading-snug">{option.label}</span>
        {option.hint && <span className="block text-[11px] font-normal text-muted-foreground">{option.hint}</span>}
      </span>
      {selected && <Check size={15} className="shrink-0 text-primary" />}
    </>
  );
}

export function ThemedSelect({ value, options, onChange, ariaLabel, placeholder = "Choose…", className = "", disabled = false, footer }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  className?: string; // wrapper width/layout classes
  disabled?: boolean;
  footer?: ReactNode; // pinned under the list (e.g. a "new subject" action)
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const typeahead = useRef({ buffer: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = () => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); };
  useOutsideClose(open, rootRef, () => setOpen(false));

  const openMenu = () => {
    if (disabled) return;
    setDropUp(shouldDropUp(triggerRef.current, options.length));
    setActive(Math.max(0, selectedIndex));
    setOpen(true);
  };

  // Focus follows the active option so screen readers announce it.
  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.focus({ preventScroll: true });
    optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const pick = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Home") { e.preventDefault(); setActive(0); return; }
    if (e.key === "End") { e.preventDefault(); setActive(options.length - 1); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(active); return; }
    // Type-ahead: jump to the first label starting with what was typed.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.buffer = (now - state.at > 500 ? "" : state.buffer) + e.key.toLowerCase();
      state.at = now;
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(state.buffer));
      if (hit >= 0) setActive(hit);
    }
  };

  return (
    <div ref={rootRef} data-dropdown-open={open || undefined} className={`relative min-w-0 ${className}`}>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => (open ? setOpen(false) : openMenu())}
        aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openMenu(); }
        }}
        className={TRIGGER_CLASS}>
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted-foreground"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="listbox" aria-label={ariaLabel} onKeyDown={onMenuKeyDown}
          className={`${MENU_CLASS} left-0 ${dropUp ? "bottom-full mb-2" : "top-full mt-2"}`}>
          <div className="max-h-[min(16rem,45vh)] overflow-y-auto overscroll-contain">
            {options.map((option, index) => (
              <button key={option.value} ref={(el) => { optionRefs.current[index] = el; }} type="button"
                role="option" aria-selected={option.value === value} tabIndex={index === active ? 0 : -1}
                onClick={() => pick(index)} onPointerMove={() => setActive(index)}
                className={optionStateClass(option.value === value, index === active)}>
                <OptionRow option={option} selected={option.value === value} />
              </button>
            ))}
            {options.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">No options.</p>}
          </div>
          {footer && <div className="mt-1 border-t border-border pt-1">{footer}</div>}
        </div>
      )}
    </div>
  );
}

// Combobox variant with a search box pinned above the option list — for long,
// user-generated lists like Planned Study tasks. Same theming and semantics.
export function SearchableSelect({ value, options, onChange, ariaLabel, placeholder = "Choose…", searchPlaceholder = "Search…", className = "", disabled = false }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)) : options;

  const close = () => { setOpen(false); setQuery(""); triggerRef.current?.focus({ preventScroll: true }); };
  useOutsideClose(open, rootRef, () => { setOpen(false); setQuery(""); });

  const openMenu = () => {
    if (disabled) return;
    setDropUp(shouldDropUp(triggerRef.current, Math.min(options.length, 6) + 1));
    setQuery("");
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  useEffect(() => { if (open) inputRef.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(() => { optionRefs.current[active]?.scrollIntoView({ block: "nearest" }); }, [active]);
  useEffect(() => { setActive(0); }, [q]);

  const pick = (option: SelectOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); return; }
    if (e.key === "Tab") { setOpen(false); setQuery(""); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); pick(shown[active]); }
  };

  return (
    <div ref={rootRef} data-dropdown-open={open || undefined} className={`relative min-w-0 ${className}`}>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={() => (open ? close() : openMenu())}
        aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} title={selected?.label}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); openMenu(); }
        }}
        className={TRIGGER_CLASS}>
        <span className={`min-w-0 flex-1 truncate ${selected ? "" : "text-muted-foreground"}`}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div onKeyDown={onKeyDown} className={`${MENU_CLASS} left-0 right-0 ${dropUp ? "bottom-full mb-2" : "top-full mt-2"}`}>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background/40 px-2.5">
            <Search size={13} className="shrink-0 text-muted-foreground" />
            <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
              role="combobox" aria-expanded="true" aria-autocomplete="list" aria-label={`Search ${ariaLabel.toLowerCase()}`}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <div role="listbox" aria-label={ariaLabel} className="mt-1 max-h-[min(15rem,42vh)] overflow-y-auto overscroll-contain">
            {shown.map((option, index) => (
              <button key={option.value} ref={(el) => { optionRefs.current[index] = el; }} type="button"
                role="option" aria-selected={option.value === value} tabIndex={-1}
                onClick={() => pick(option)} onPointerMove={() => setActive(index)}
                className={optionStateClass(option.value === value, index === active)}>
                <OptionRow option={option} selected={option.value === value} />
              </button>
            ))}
            {shown.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">No matches.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
