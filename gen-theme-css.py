#!/usr/bin/env python3
r"""
Generates the LIGHT-theme override layer for the Nexus app.

The app was built dark-first with hardcoded Tailwind palette classes
(bg-slate-900, text-slate-400 ...) and no `dark:` variants, so a light theme
is produced by re-mapping exactly those utility classes. We scan the real
source files so the generated sheet can't miss a class.

Every rule is prefixed `html[data-theme="light"]` which out-specifies
Tailwind's own utilities (incl. state variants like .hover\:x:hover), so no
`!important` is needed and print styles are unaffected.
"""
import re, pathlib

ROOT = pathlib.Path(__file__).resolve().parent
SOURCES = ["index.html", "pos-terminal.html", "inventory-os.html",
           "vendors-payables.html", "crm-settings.html",
           "assets/nexus-sidebar.js"]

# ---------------------------------------------------------------- palettes
# Neutral surfaces: dark shade -> light shade.
SURFACES = {
    # page-level backgrounds (darkest in dark theme)
    "slate-950": "#f8fafc", "navy-950": "#f8fafc", "navy-900": "#f8fafc",
    "dark-900":  "#f8fafc",
    # card backgrounds
    "slate-900": "#ffffff", "navy-800": "#ffffff", "dark-800": "#ffffff",
    # nested surfaces / inputs
    "slate-800": "#f8fafc", "navy-700": "#f1f5f9", "dark-700": "#f1f5f9",
    # deeper nested / control chrome
    "slate-700": "#f1f5f9", "dark-600": "#f1f5f9",
    "slate-600": "#e2e8f0", "navy-600": "#e2e8f0", "dark-500": "#e2e8f0",
    "slate-500": "#cbd5e1",
}
# Text colours: dark-theme light text -> light-theme dark text.
TEXTS = {
    "white": "#0f172a",
    "slate-100": "#1e293b", "slate-200": "#334155", "slate-300": "#475569",
    "slate-400": "#64748b",  # muted body text (230 uses)
    "slate-500": "#94a3b8", "slate-600": "#a8b3c2",
    # light text ON accent backgrounds must stay dark -> handled by EXCLUDE
}
# Accent text needs darkening on white or contrast collapses.
ACCENT_TEXT = {
    "cyan-300": "#0e7490", "cyan-400": "#0e7490", "cyan-500": "#0891b2",
    "emerald-300": "#047857", "emerald-400": "#059669", "emerald-500": "#047857",
    "amber-300": "#b45309", "amber-400": "#b45309",
    "rose-300": "#be123c", "rose-400": "#e11d48",
    "purple-300": "#7e22ce", "purple-400": "#9333ea",
    "electric-400": "#0e7490", "electric-500": "#0891b2",
    "brand-400": "#0369a1", "brand-500": "#0369a1",
    "sky-400": "#0284c7", "orange-400": "#c2410c", "blue-400": "#2563eb",
    "yellow-300": "#a16207",
}
BORDERS = {
    "slate-800": "#e2e8f0", "navy-700": "#e2e8f0", "dark-600": "#e2e8f0",
    "slate-700": "#cbd5e1", "navy-600": "#cbd5e1", "dark-500": "#cbd5e1",
    "slate-600": "#cbd5e1", "slate-200": "#e2e8f0", "slate-500": "#cbd5e1",
    # accent borders: keep hue, nudge opacity up so they read on white
    "cyan-500": "#06b6d4", "cyan-400": "#06b6d4", "emerald-500": "#10b981",
    "emerald-400": "#10b981", "amber-500": "#f59e0b", "rose-500": "#f43f5e",
    "electric-500": "#00b8d4", "electric-600": "#00b8d4", "purple-500": "#a855f7",
}

# These text shades sit on coloured buttons/chips in BOTH themes; leave alone.
TEXT_EXCLUDE = {"slate-950", "slate-900", "slate-800", "slate-700"}

TOKEN = re.compile(
    r'(?<![\w-])((?:[a-z][a-z-]*:)*)(bg|text|border|ring|shadow|from|to|via|'
    r'divide|placeholder|fill|stroke|outline|decoration|accent|caret)-'
    r'([a-z]+(?:-[0-9]+)?)(?:/([0-9]+))?(?![\w-])'
)
VARIANT_PSEUDO = {
    "hover": ":hover", "focus": ":focus", "active": ":active",
    "focus-visible": ":focus-visible", "disabled": ":disabled",
    "selection": "::selection",
    "group-hover": None,   # needs .group ancestor
}
# Tailwind utility prefix -> real CSS property
CSS_PROP = {
    "bg": "background-color", "text": "color", "border": "border-color",
    "ring": "--tw-ring-color", "outline": "outline-color",
    "placeholder": "--tw-placeholder-color", "divide": "border-color",
    "from": "--tw-gradient-from", "to": "--tw-gradient-to",
    "via": "--tw-gradient-via", "fill": "fill", "stroke": "stroke",
    "decoration": "text-decoration-color", "accent": "accent-color",
    "caret": "caret-color", "selection": "background-color",
}


def esc(cls: str) -> str:
    """CSS selector for a Tailwind class name."""
    return "." + cls.replace("/", r"\/").replace(":", r"\:")


def build():
    corpus = ""
    for rel in SOURCES:
        p = ROOT / rel
        if p.exists():
            corpus += p.read_text(encoding="utf-8")

    seen = set()
    rules = []
    for m in TOKEN.finditer(corpus):
        variants, prop, color, alpha = m.groups()
        color = color.lower()
        cls = m.group(0)
        if cls in seen:
            continue

        # pick the new value for this colour under this property
        if prop in ("bg", "from", "to", "via", "fill", "selection"):
            new = SURFACES.get(color)
        elif prop in ("text", "placeholder", "decoration"):
            if color in TEXT_EXCLUDE:
                continue
            new = TEXTS.get(color) or ACCENT_TEXT.get(color)
        elif prop in ("border", "ring", "outline", "divide"):
            new = BORDERS.get(color)
        elif prop == "shadow":
            new = None  # shadows keep default (soft on light already)
        else:
            new = None
        if not new:
            continue

        # tinted backgrounds (/10 etc.) are faint on white -> keep alpha but
        # darken the base a touch so the chip still reads as coloured
        if alpha and prop in ("bg", "border", "ring", "divide"):
            pass  # alpha preserved; value already legible on light
        seen.add(cls)

        # ---- build selector ----
        parts = variants.split(":")[:-1] if variants else []
        sel = 'html[data-theme="light"] '
        group_prefix = ""
        pseudo_suffix = ""
        for v in parts:
            if v == "group-hover":
                group_prefix = ".group "
            elif v in VARIANT_PSEUDO and VARIANT_PSEUDO[v]:
                pseudo_suffix += VARIANT_PSEUDO[v]
        # state pseudo-classes attach to the class itself (.x:hover), never as
        # a descendant selector (:hover .x) which would target the wrong node
        sel += group_prefix + esc(cls) + pseudo_suffix
        # divide-* paints the border of sibling rows, not the container
        if prop == "divide":
            sel += " > :not([hidden]) ~ :not([hidden])"

        # opacity suffix: Tailwind's class carries it, but our override sets a
        # solid colour, so re-apply the same alpha to stay faithful to intent
        decl_color = new
        if alpha:
            decl_color = f"color-mix(in srgb, {new} {alpha}%, transparent)"

        rules.append((cls, sel, f"{CSS_PROP.get(prop, prop)}: {decl_color}"))

    # de-dup by selector, keep first
    out, used = [], set()
    for cls, sel, decl in rules:
        if sel in used:
            continue
        used.add(sel)
        out.append((cls, sel, decl))
    return out


BEGIN = '/* == BEGIN GENERATED UTILITIES (see gen-theme-css.py — do not hand-edit) == */'
END = '/* == END GENERATED UTILITIES == */'


def regenerate():
    """Rewrite only the marked block inside assets/nexus-theme.css, in place.

    Everything outside the markers — the header, and the hand-tuned component
    / sidebar / chart rules — is left exactly as it is.
    """
    path = ROOT / "assets" / "nexus-theme.css"
    css = path.read_text(encoding="utf-8")
    if BEGIN not in css or END not in css:
        raise SystemExit("generated-block markers are missing from assets/nexus-theme.css")

    rules = build()
    body = "\n".join(f"{sel}{{{decl}}}" for _, sel, decl in rules)
    block = BEGIN + "\n" + body + "\n" + END

    head, _, rest = css.partition(BEGIN)
    _, _, tail = rest.partition(END)
    path.write_text(head + block + tail, encoding="utf-8")
    print(f"regenerated {len(rules)} utility overrides in {path.relative_to(ROOT)}")


if __name__ == "__main__":
    regenerate()
