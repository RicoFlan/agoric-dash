# Visual Design System — Base UI Kit

## 1. Color System

### Base (Dark Theme)

--color-bg-primary:    #0B0F14
--color-bg-secondary:  #121821
--color-surface:       #161D26
--color-border:        #232C38

### Text

--color-text-primary:   #E6EDF3
--color-text-secondary: #AAB6C4
--color-text-muted:     #6B7785

### Accent (Primary — Teal)

--color-accent:         #2ED3B7
--color-accent-hover:   #26BFA5
--color-accent-active:  #1FA38C
--color-accent-subtle:  #123C3A

### Semantic

--color-success: #2ECC71
--color-warning: #F5A623
--color-error:   #E0565B

---

## 2. Typography

### Font Stack

-apple-system, BlinkMacSystemFont, Inter, Helvetica Neue, Arial, sans-serif

### Monospace (Optional)

JetBrains Mono, SFMono-Regular, monospace

Use for:
- code
- IDs
- structured data

### Type Scale

H1: 24px
H2: 20px
H3: 18px
Body: 14px
Small: 12px

### Heading colors (dashboard)

Map to existing tokens: **section rails** → `text-[var(--color-accent)]`, **in-card chart titles** → `text-[var(--color-text-primary)]`, **uppercase KPI labels** → `text-[var(--color-text-secondary)]`. (Aliases `--heading-*` in `globals.css` match these for non-Tailwind CSS.)

Line height:
- Body: 1.4
- Headings: tighter

---

## 3. Spacing

Base unit: 4px

Scale:
4px
8px
12px
16px
24px
32px
48px

Usage:
- Default spacing: 16–24px
- Card padding: 20–24px
- Section spacing: 32–48px

Design should feel spacious.

---

## 4. Shape & Structure

### Border Radius

Default: 6px
Cards: 8px

### Borders

1px solid #232C38

Use borders as the primary structure instead of heavy shadows.

---

## 5. Depth

Use subtle layering only.

Card shadow (optional):
0 1px 2px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.25)

Prefer:
- contrast
- layering

Avoid:
- heavy shadows
- glow effects

---

## 6. Components

### Buttons

Primary:
- Background: accent color
- Text: #0B0F14
- Padding: 10px 16px
- Radius: 6px

Hover:
- Slightly darker accent
- Slight lift (translateY(-1px))

Secondary:
- Background: transparent
- Border: 1px solid #232C38
- Text: #E6EDF3

Hover:
- Background: #161D26

Tertiary:
- No border
- Accent text color

---

### Cards

- Background: #161D26
- Border: 1px solid #232C38
- Radius: 8px
- Padding: 20–24px

---

## 7. Icons

Style:
- Outline only
- Consistent stroke width

Libraries:
- Lucide
- Heroicons (outline)

Colors:
- Default: #AAB6C4
- Active: accent color

---

## 8. Interaction

Motion:
- Minimal
- Subtle only

Behavior:
- Fast
- Responsive

Hover:
- Slight color shift
- Optional lift
- No aggressive effects

---

## 9. Principles

Do:
- Keep UI minimal
- Use spacing for hierarchy
- Prioritize clarity
- Maintain consistency

Avoid:
- Bright/neon colors
- Heavy gradients
- Over-rounded elements
- Excessive animation
- Playful UI patterns
