# NexTore Designer

> Category: Enterprise & SaaS

A calm, precise enterprise design system for NexTore Designer: indigo as the single interactive accent, slate neutrals for long working sessions, generous spacing, and a type scale built on Inter with Noto for CJK. It is designed to look at home inside NexTore admin surfaces while staying expressive enough for generated decks and prototypes.

## 1. Visual Theme & Atmosphere

NexTore Designer is a workspace, not a marketing page. The canvas is near-white (`#F9FAFB`), surfaces are pure white, and text is a deep slate (`#111827`) rather than black, so dense screens stay comfortable for hours. A single indigo (`#4F46E5`) carries every interactive affordance — links, primary buttons, focus rings, selected states — and nothing else competes with it. Secondary information recedes into muted slate (`#6B7280`), while borders stay quiet (`#E5E7EB`).

The system values clarity over decoration: one accent, one border weight, a small radius scale (6–12px), and elevation that reads as a soft lift rather than a shadow. Motion is short and functional (120–200ms) and never bounces. Components are compact, touch targets stay at least 40px, and every state is expressed with color plus a second cue (weight, icon, or border) so it survives grayscale and color-vision differences.

**Key Characteristics:**
- One indigo accent (`#4F46E5`) for all interaction; no secondary brand hue
- Slate text (`#111827`) and muted (`#6B7280`) instead of pure black
- Quiet 1px borders (`#E5E7EB`) and a 6–12px radius scale
- Inter for UI, Inter Tight for display, Source Serif 4 for editorial, JetBrains Mono for code
- Noto Sans/Serif HK and SC for Traditional and Simplified Chinese
- 4px spacing grid with 16/24/32px section rhythm
- 120–200ms ease-out motion; no bounce, no parallax

## 2. Color Palette & Roles

### Primary
- **NexTore Indigo** (`#4F46E5`): Primary buttons, links, focus rings, selected navigation, key data highlights.
- **Indigo Hover** (`#4338CA`): Hover and pressed states for indigo controls.
- **Indigo Soft** (`#EEF2FF`): Selected rows, info callouts, subtle accent fills.

### Neutrals
- **Ink** (`#111827`): Headings and primary body text.
- **Slate** (`#374151`): Secondary body text and labels.
- **Muted** (`#6B7280`): Metadata, placeholders, helper text.
- **Border** (`#E5E7EB`): Dividers, card outlines, input borders.
- **Surface** (`#FFFFFF`): Cards, panels, dialogs.
- **Canvas** (`#F9FAFB`): Page background behind surfaces.

### Status
- **Success** (`#059669`) with soft `#ECFDF5`: completed runs, saved state.
- **Warning** (`#D97706`) with soft `#FFFBEB`: degraded or needs attention.
- **Danger** (`#DC2626`) with soft `#FEF2F2`: destructive actions and errors.

## 3. Typography

- **UI sans:** `Inter` — 14px body, 13px meta, 16px form controls.
- **Display:** `Inter Tight` — 28–48px headings with -0.02em tracking.
- **Editorial:** `Source Serif 4` — long-form documents and pull quotes.
- **Code:** `JetBrains Mono` — code blocks, IDs, token names.
- **CJK:** `Noto Sans SC` / `Noto Serif SC` for Simplified, `Noto Sans HK` / `Noto Serif HK` for Traditional.

Load fonts from `/vendor/fonts@1.0.0/fonts.css` (offline, host-resolved). Never import Google Fonts. The type scale is 12 / 13 / 14 / 16 / 20 / 24 / 32 / 40 / 48px; headings use 600 weight, body 400, labels 500.

## 4. Spacing, Radius, Elevation

- Spacing grid: 4px. Section rhythm: 16 / 24 / 32 / 48px.
- Radius: 6px controls, 10px cards, 12px dialogs, 999px pills.
- Borders: 1px `#E5E7EB`; focus uses a 2px indigo ring plus a soft halo.
- Elevation: `0 1px 2px rgba(17,24,39,0.06)` for cards, `0 8px 24px rgba(17,24,39,0.10)` for dialogs. No colored shadows.

## 5. Components

- **Buttons:** 36px height, 6px radius, 500 weight. Primary = indigo fill/white text; secondary = white fill/ink text/1px border; ghost = transparent with hover `#F3F4F6`. Destructive = danger fill only for irreversible actions.
- **Inputs:** 36px height, 6px radius, 1px border, 13px horizontal padding; focus ring indigo; error border danger plus a message below.
- **Cards:** white surface, 1px border, 10px radius, 16–24px padding, no shadow by default.
- **Navigation:** left rail with 40px rows, selected row uses indigo-soft fill and ink text; icons 18px.
- **Tables:** 40px rows, 1px row separators, muted headers in 12px uppercase with 0.04em tracking.
- **Badges:** pill, 12px text, 500 weight, soft status fill with the matching status text color.

## 6. Motion

- Durations: 120ms for hover/press, 180ms for menus, 200ms for dialogs.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` (ease-out). No bounce, no spring overshoot.
- Respect `prefers-reduced-motion`: replace transitions with instant state changes.

## 7. Do / Don't

- Do keep one indigo accent per screen; use neutral hierarchy for everything else.
- Do use 1px quiet borders instead of heavy shadows.
- Do pair every status color with an icon or label.
- Don't use gradients as page backgrounds; reserve them for a single hero moment if at all.
- Don't introduce a second accent hue or a colored shadow.
- Don't go below 12px text or 40px touch targets.

## 8. Token Reference

```css
:root {
  --accent: #4F46E5;
  --accent-hover: #4338CA;
  --accent-soft: #EEF2FF;
  --text: #111827;
  --text-secondary: #374151;
  --muted: #6B7280;
  --border: #E5E7EB;
  --surface: #FFFFFF;
  --canvas: #F9FAFB;
  --success: #059669;
  --warning: #D97706;
  --danger: #DC2626;
  --radius-control: 6px;
  --radius-card: 10px;
  --radius-dialog: 12px;
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-display: 'Inter Tight', 'Inter', system-ui, sans-serif;
  --font-serif: 'Source Serif 4', Georgia, serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --font-cjk: 'Noto Sans SC', 'Noto Sans HK', 'PingFang SC', sans-serif;
}
```
