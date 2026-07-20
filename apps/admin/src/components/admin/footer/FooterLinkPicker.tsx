"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Link2, Globe, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface LinkableDestination {
  label: string;
  href: string;
}

export interface LinkableDestinations {
  pages: LinkableDestination[];
  static: LinkableDestination[];
}

type Category = "pages" | "static" | "external";

const CATEGORY_LABELS: Record<Category, string> = {
  pages: "Halaman",
  static: "Rute Statis",
  external: "URL Eksternal",
};

interface FooterLinkPickerProps {
  value: string;
  onChange: (href: string, autoLabel?: string) => void;
  destinations: LinkableDestinations | null;
  className?: string;
}

// Detect if a value looks like an external URL.
function isExternalUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

// Infer which category a given href belongs to (for trigger display).
function inferCategory(href: string): Category {
  if (!href) return "pages";
  if (isExternalUrl(href)) return "external";
  if (href.startsWith("/pages/")) return "pages";
  return "static";
}

export function FooterLinkPicker({
  value,
  onChange,
  destinations,
  className,
}: FooterLinkPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<Category>(() =>
    inferCategory(value)
  );
  const [externalInput, setExternalInput] = React.useState(value);

  // Keep external input in sync when value changes externally (e.g. initial
  // load or reset). Only sync for external category to avoid clobbering.
  React.useEffect(() => {
    if (category === "external") {
      setExternalInput(value);
    }
  }, [value, category]);

  // When category switches to external, prefill the input with current value.
  React.useEffect(() => {
    if (open && category === "external") {
      setExternalInput(value);
    }
  }, [open, category, value]);

  function handleSelect(href: string, autoLabel: string) {
    onChange(href, autoLabel);
    setOpen(false);
  }

  function handleExternalSubmit() {
    const trimmed = externalInput.trim();
    if (trimmed) {
      onChange(trimmed, undefined);
      setOpen(false);
    }
  }

  const triggerLabel = value ? value : "Pilih link…";
  const loading = destinations === null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-10 justify-between font-normal w-full min-w-[180px]",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Link2 className="h-4 w-4 shrink-0 opacity-50" />
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[380px] p-0"
        align="start"
      >
        {/* Category tabs */}
        <div className="flex items-center border-b px-1 py-1 gap-1 flex-wrap">
          {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                "px-2.5 py-1 text-xs rounded-md font-medium transition-colors",
                category === cat
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : category === "external" ? (
          <div className="p-3 space-y-2">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Globe className="h-3.5 w-3.5" />
              URL eksternal (https://...)
            </label>
            <Input
              autoFocus
              value={externalInput}
              onChange={(e) => setExternalInput(e.target.value)}
              placeholder="https://example.com"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleExternalSubmit();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              onClick={handleExternalSubmit}
              disabled={!externalInput.trim()}
              className="w-full"
            >
              Terapkan
            </Button>
          </div>
        ) : (
          <Command>
            <CommandInput placeholder="Cari…" />
            <CommandList>
              <CommandEmpty>Tidak ada hasil.</CommandEmpty>
              {category === "pages" && (
                <CommandGroup heading="Halaman Statis">
                  {destinations!.pages.length === 0 ? (
                    <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                      Belum ada halaman yang dipublikasikan.
                    </div>
                  ) : (
                    destinations!.pages.map((d) => (
                      <CommandItem
                        key={d.href}
                        value={`${d.label} ${d.href}`}
                        onSelect={() => handleSelect(d.href, d.label)}
                      >
                        <span className="flex-1 truncate">{d.label}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {d.href}
                        </span>
                        <Check
                          className={cn(
                            "h-4 w-4 ml-1 shrink-0",
                            value === d.href ? "opacity-100" : "opacity-0"
                          )}
                        />
                      </CommandItem>
                    ))
                  )}
                </CommandGroup>
              )}
              {category === "static" && (
                <CommandGroup heading="Rute Statis Storefront">
                  {destinations!.static.map((d) => (
                    <CommandItem
                      key={d.href}
                      value={`${d.label} ${d.href}`}
                      onSelect={() => handleSelect(d.href, d.label)}
                    >
                      <span className="flex-1 truncate">{d.label}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {d.href}
                      </span>
                      <Check
                        className={cn(
                          "h-4 w-4 ml-1 shrink-0",
                          value === d.href ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
              <CommandGroup>
                <CommandItem
                  value="__external__"
                  onSelect={() => setCategory("external")}
                >
                  <Globe className="h-4 w-4 mr-2" />
                  <span>URL Eksternal…</span>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}