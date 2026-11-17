---
name: "Anders Hafreager · Personal tools"
description: "The established personal-site visual system and its analytics workspace extension."
colors:
  accent: "#0e5f74"
  accent-warm: "#b4761b"
  bg: "#f4f6f5"
  ink: "#16232a"
  ink-soft: "#55696f"
  card: "#fff"
  line: "#d9e2df"
  line-soft: "#e8efec"
  dark-accent: "#5cadc5"
  dark-accent-warm: "#e0aa4c"
  dark-bg: "#0b161b"
  dark-ink: "#e7efec"
  dark-ink-soft: "#9ab3b1"
  dark-card: "#101f26"
  dark-line: "#223b44"
  dark-line-soft: "#18303a"
typography:
  display:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "clamp(30px,6vw,46px)"
    fontWeight: 800
    letterSpacing: "-.015em"
  title:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "clamp(21px,3.4vw,26px)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-.01em"
  body:
    fontFamily: "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif"
    fontSize: "17px"
    lineHeight: 1.6
  label:
    fontFamily: "ui-monospace,'SF Mono',Menlo,Consolas,monospace"
    fontSize: "13px"
  workspace-body:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "15px"
    lineHeight: 1.5
  workspace-title:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "clamp(27px,3vw,38px)"
    letterSpacing: "-.02em"
  workspace-section:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "21px"
    letterSpacing: "-.01em"
  workspace-count:
    fontFamily: "'Avenir Next','Segoe UI',Futura,'Trebuchet MS',sans-serif"
    fontSize: "32px"
    fontWeight: 600
    letterSpacing: "-.025em"
rounded:
  control: "7px"
  site-link: "9px"
  container: "10px"
  status: "4px"
  pill: "999px"
spacing:
  label-gap: "5px"
  tag-gap: "6px"
  control-gap: "10px"
  form-gap: "12px"
  group-gap: "16px"
  compact-padding: "18px"
  panel-padding: "20px"
  site-gutter: "22px"
  section-gap: "24px"
  workspace-padding: "32px"
  section-space: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  button-secondary-hover:
    backgroundColor: "{colors.line-soft}"
  field:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
  navigation-selected:
    backgroundColor: "{colors.line-soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  tag:
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  chart-container:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.container}"
    padding: "20px 20px 8px"
  post-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.container}"
  notice:
    backgroundColor: "{colors.line-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px 16px"
---

# Design System: Anders Hafreager · Personal tools

## Overview

**Creative North Star: "Personal tools"**

An established personal site for finding Anders’s projects and tools. Its pale sage ground, deep ink, teal links and serif reading text create a restrained, readable setting for project work. The analytics workspace inherits that identity and uses the existing display stack for compact forms, tables and measurements.

This is a record of the implemented system, not a replacement identity. The source authority is assets/style.css; stats/stats.css supplies the denser workspace rules. Both follow the operating system’s light/dark preference. No raster assets were introduced by the statistics extension.

**Key Characteristics:**
- Sage-tinted ground, ink foregrounds and teal interaction.
- Display sans for hierarchy, reading serif for prose, mono for technical metadata.
- Fine borders, gently rounded surfaces and restrained depth.
- Responsive navigation, readable measurements and visible investigation state.

## Colors

Cool, quiet neutrals support a teal interaction accent and a warm metadata/focus accent. Frontmatter names mirror the CSS variables; `dark-` entries are their actual system-preference overrides, not additional competing colors.

### Primary
- **Deep teal / light teal in dark mode** (`accent`, `dark-accent`): links, selected navigation, primary actions and daily chart strokes.
- **Warm ochre / warm gold in dark mode** (`accent-warm`, `dark-accent-warm`): dates, focus outlines and error-notice borders.

### Neutral
- **Sage ground** (`bg`, `dark-bg`): page canvas.
- **Ink** (`ink`, `dark-ink`): headings and primary content.
- **Soft ink** (`ink-soft`, `dark-ink-soft`): explanatory text, labels and chart ticks.
- **Surface** (`card`, `dark-card`): project cards, controls and plot panels.
- **Fine line** (`line`, `dark-line`): borders, table rules and chart gridlines.
- **Soft surface** (`line-soft`, `dark-line-soft`): selected app backgrounds, notices, chart areas and distribution tracks.

**The Inherited Color Rule.** Use the shared semantic colors for backgrounds, text, controls and chart marks; dark mode changes their values together.

The statistics stylesheet also declares three plot variables. Only the shared accent is currently used for chart marks; the unused plot declarations are not promoted into a multi-series palette here.

## Typography

**Display Font:** the existing Avenir Next / Segoe UI / Futura / Trebuchet MS stack.
**Body Font:** the existing Iowan Old Style / Palatino / Book Antiqua / Georgia stack.
**Label/Mono Font:** the existing UI monospace / SF Mono / Menlo / Consolas stack.

The sans carries direct headings and compact tool UI; the serif carries longer reading; the mono identifies dates, categories and technical detail. These are incumbent OS-dependent stacks, not a new type selection.

### Hierarchy
- **Display:** frontmatter `display` is the personal-site title. The sign-in heading has its own observed responsive treatment (`clamp(34px, 4.5vw, 58px)`, weight 700, line height 1.12); this short display treatment is not a body-text rule.
- **Title:** frontmatter `title` is the project heading; `workspace-title` and `workspace-section` describe analytical hierarchy.
- **Body:** `body` is reading text, with project paragraphs constrained to 62ch. Below the site mobile breakpoint its size becomes 16.5px. `workspace-body` is compact analytical content; supporting table and hint text commonly uses 13px.
- **Label:** `label` is the recurring mono metadata size. Tags are smaller uppercase metadata; do not generalize that treatment into new decorative section kickers.
- **Counts:** `workspace-count` is the desktop measurement role; mobile reduces it to 28px. Measurements and tables use tabular numerals.

**The Role Continuity Rule.** Keep the existing display, reading and metadata stacks in their established roles; the statistics workspace uses the display stack for compact analytical content.

## Layout

The public index is a centered single reading column (880px maximum, 22px side padding). Project cards stack vertically; site links wrap, then become full-width rows at 600px. Project-body padding and header spacing become smaller at that breakpoint.

The workspace is wider (1600px maximum), with a 232px app rail and a flexible investigation column. Its content padding is 32px vertically and `clamp(18px, 3vw, 48px)` horizontally. At 900px the rail becomes horizontally scrollable navigation above the content. At 650px paired distribution tables stack. At 600px the header, forms and summary tighten, the sign-in columns stack, and content uses 18px side padding. Tabs remain horizontally scrollable; forms wrap rather than forcing page overflow. Tables retain their own horizontal overflow region.

The shared rhythm is expressed through small control gaps, medium grouping gaps and larger section space; frontmatter records repeated values, not a fabricated mathematical scale. Analytical summaries are open inline groups rather than individual boxed cards.

## Elevation & Depth

The site combines soft card shadows with fine borders. The analytics extension is flatter: tonal selection, chart areas, table rules and spacing establish hierarchy without adding card shadows to every section.

### Shadow Vocabulary
- **Shared card shadow:** `0 1px 2px rgba(22,35,42,.05), 0 8px 26px rgba(22,35,42,.07)` on public project cards and site links.
- **Dark shared card shadow:** `0 1px 2px rgba(0,0,0,.3), 0 12px 32px rgba(0,0,0,.4)` under dark system preference.
- **Selected tab:** an inset two-pixel accent underline; this communicates location rather than elevation.

**The Surface Depth Rule.** Project cards and site links carry the shared shadow. Workspace controls, notices and charts use borders and tonal separation.

## Shapes

Thin one-pixel borders and gently rounded rectangles are the recurring form. Use the recorded control, link and container radii for their established roles. Public metadata tags are pills; analytical status labels are compact rounded rectangles. Tables and tab underlines remain square. Charts clip neither their axis labels nor their contextual controls.

## Components

### Buttons

Compact and direct. Secondary buttons use surface fill, ink text and a fine border. Primary buttons use accent fill and surface text; dark mode explicitly uses the dark ground for their text. Controls have a minimum height of 44px. Hover shifts secondary buttons to the soft surface with an accent border; primary hover uses brightness 0.9. Disabled actions reduce opacity to 0.6 and use a waiting cursor.

### Inputs / Fields

Match the secondary button’s shape and surface with 8px by 12px padding. Labels sit above controls with a small gap. Numeric/date content uses tabular figures. Workspace focus is a three-pixel warm outline offset by three pixels; public links use a two-pixel warm outline. Keep native date and select affordances.

### Navigation

Public site links are rounded, subtly shadowed text blocks with a bold display label and mono description; hover raises them one pixel. The workspace app rail is flatter: selected entries use soft surface plus accent text. Investigation tabs use muted text, generous horizontal separation and an accent underline for the current tab. Narrow navigation scrolls horizontally.

### Chips / Status

Public tags are fine-bordered mono pills. Workspace status labels use soft surface and soft ink. They describe content or status; do not manufacture decorative labels around every section.

### Cards / Containers

Project cards use the shared surface, container radius, border and shadow, with reading content inset below a screenshot. Plot panels use the same surface and radius but no shadow. Notice and active-filter panels use the soft surface, control radius and fine border; errors change the border to the warm accent. Applied event filters include a visible scope statement and reset action.

### Analytical tables and daily chart

Tables use aligned tabular figures, subtle row separators and compact labels. Distribution tracks are soft-surface bars filled with accent. The daily plot uses a thin accent line, soft filled area and muted tick text. Its SVG viewBox is recomputed from the available view width, capped at 880px with a 260px minimum and 240px height; axis text uses the existing display stack at 12px. Start, midpoint and end dates avoid crowded labeling; exact daily values remain available in a disclosure table.

### Timeline

Session events form a ruled two-column list: a 90px mono timestamp column and flexible event detail, separated by 16px. Properties wrap in a mono preformatted block. Loading and completeness notices remain visible; a timeline response is invalidated when its app, date or navigation context changes.

### Motion and access

Public site links transition over 0.15s; project screenshots scale subtly over 0.5s only on hover-capable devices. Screenshot motion is removed for reduced motion. Workspace arrival is a 0.35s blur/clip reveal only when motion is allowed. Preserve the skip link and visible focus treatment.

## Do's and Don'ts

### Do:
- **Do** inherit both light and dark semantic colors from the shared stylesheet.
- **Do** use tabular numerals for analytical counts, tables, timestamps and numerical controls.
- **Do** keep filter scope visible with a clear action when event filters are applied.
- **Do** adapt chart geometry to available width, retain readable labels and provide exact values in a table.
- **Do** retain visible focus, wrapping forms and horizontally accessible navigation on narrow screens.

### Don't:
- **Don't** introduce a new palette or type family for another personal-tool route.
- **Don't** turn a stale session response into the visible result after its investigation context changes.
- **Don't** shrink a fixed desktop chart wholesale until its labels become unreadable.
- **Don't** use elevation on every workspace section; ordinary sections are separated by spacing and fine rules.
