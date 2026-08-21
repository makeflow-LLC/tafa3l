# Tapio Redesign — Implementation Spec

Covers three deliverables: Participant Answer Screen (light + dark, 4 states), Teacher Home (mobile), Activity Designer (desktop, Questions tab). All values exact as designed.

---

## 1. TOKENS

### 1.1 Colors

Brand
| Name | Hex | Usage |
|---|---|---|
| `brand-navy` | `#10173A` | Dark-theme background; light-theme primary text; selected-answer border (light); dark chips on canvas |
| `brand-purple` | `#6C3DF4` | Single accent: timer bar fill (light), active tab border/badge, selected type tile, manual-create button, answer option د, AI-card border |
| `brand-purple-light` | `#8B66F7` | Timer bar fill on dark theme |
| `brand-purple-tint` | `#B9A4FF` | Waiting-state text + pulse dots on dark theme; ghost button text on dark |
| `brand-cyan` | `#3BD6EE` | Teacher primary CTA fill: «إطلاق جلسة», «+ نشاط جديد», «+ سؤال جديد», «ابدأ بالمساعد الذكي». Text on cyan is always `#10173A` |

Light theme surfaces & text
| Name | Hex | Usage |
|---|---|---|
| `light-canvas` | `#EDECEA` | Page/canvas background behind frames |
| `light-surface` | `#FAF9F7` | Phone screen background |
| `light-border` | `#D8DAE6` | Frame border, image-slot border |
| `light-track` | `#E3E2EC` | Timer bar track |
| `light-slot` | `#EFEEF4` | Image placeholder fill |
| `light-neutral-fill` | `#ECEBF2` | Faded (non-involved) answer after reveal |
| `text-primary-light` | `#10173A` | All primary text on light |
| `text-muted-light` | `#6E7290` | Header secondary («/10», «pts») |
| `text-faded-light` | `#8A8FAD` | Expired timer digit, faded answer text, placeholder captions |
| `white` | `#FFFFFF` | Letter badges, text on colored answer fills, chips |

Dark theme surfaces & text
| Name | Hex | Usage |
|---|---|---|
| `dark-bg` | `#10173A` | Screen background |
| `dark-surface` | `#1A2250` | Cards, inputs, image slot, faded answers after reveal, active tab fill |
| `dark-border` | `#2A3158` | All borders, timer track, inactive pills, avatar fill, disabled letter badge fill |
| `text-primary-dark` | `#FFFFFF` | Primary text on dark |
| `text-muted-dark` | `#9BA0C0` | Secondary/meta text, inactive controls |

Feedback & answer hues (identical on both themes)
| Name | Hex | Usage |
|---|---|---|
| `answer-a-red` | `#D6403F` | Option أ fill; wrong-pick fill after reveal; delete text uses `#FF7A72` on dark |
| `answer-b-teal` | `#0E8FA0` | Option ب fill |
| `answer-c-amber` | `#C8811A` | Option ج fill |
| `answer-d-purple` | `#6C3DF4` | Option د fill |
| `correct-green` | `#1F9D55` | Correct answer fill after reveal; correct-option toggle in editor |
| `correct-green-dark` | `#4FCE85` | "إجابة صحيحة" status text on dark |
| `wrong-red-dark` | `#FF7A72` | "إجابة خاطئة" status text and «حذف» link on dark |

### 1.2 Typography

Family: `'IBM Plex Sans Arabic', system-ui, sans-serif` (weights loaded: 400, 500, 600, 700). Line-height `1.7` on all Arabic text, no exceptions. Latin digits use `font-variant-numeric: tabular-nums` wherever they update live.

| Size | Weight | Role |
|---|---|---|
| 26px | 700 | Teacher home greeting (h1) |
| 22px | 700 | Student question text (h1) |
| 19px | 700 | Timer digit; «tapio» wordmark |
| 18px | 700 | Section headings («نشاطاتي»); answer option label; letter badge glyph (17px inside 34px badge) |
| 16px | 700 | Card titles, creation-card titles, status lines (reveal), question text field |
| 15px | 600–700 | Header stats (counter/score), tab labels, nav chips (500), buttons, option rows |
| 14px | 500–700 | Nav chips, card action buttons, waiting-state line, draft title |
| 13px | 500–700 | Meta rows, secondary links, type tiles, form labels, small chips («اختيارك» 13/700) |
| 12px | 400–600 | Badge labels (canvas), auto-save note, draft meta, side-panel hint, image-slot caption (ui-monospace) |

### 1.3 Spacing (px)
Used values only: `2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 40, 48, 56`.
- Screen padding: student `20px sides / 16px bottom`; teacher mobile `20px`; designer desktop `24px`.
- Answer list gap: `10px` (v2) — minimum required gap between tap targets.
- Card internal gap: `10–12px`; between cards `10–12px`; section gap on canvas `40–56px`.

### 1.4 Border radius (px)
| Value | Usage |
|---|---|
| `99px` (pill) | Buttons, chips, timer track/fill, dots, avatar |
| `28px` | Phone frame |
| `20px` | Desktop designer frame |
| `16px` | Answer options, cards, draft bar |
| `14px` | Tab steps, question text field |
| `12px` | Image slot, option rows, type tiles, correct/remove toggles, question-number pills |
| `10px` | Letter badges |

### 1.5 Shadows
None. All surfaces flat; elevation expressed by fill + 1px border only.

---

## 2. SCREEN INVENTORY

1. **Participant Answer Screen — Active** (student phone, 390×780). Vertical flex: header stats row → timer row → centered block (image slot 110px + question) → answer stack pinned to bottom 56% of screen (thumb zone).
2. **Participant Answer Screen — Selected / Waiting**. Same skeleton; chosen option outlined + chip «اختيارك», other options at 35% opacity (30% dark), waiting line with 3 pulsing dots under the question.
3. **Participant Answer Screen — Revealed, Correct**. Timer at 0 with empty track; correct option keeps green fill + ✓ circle + outline; others recolored to neutral fill; status line «إجابة صحيحة +120»; score in header already incremented.
4. **Participant Answer Screen — Revealed, Wrong**. Correct option green + ✓; the user's pick keeps its hue + ✕ circle; uninvolved options neutral; status line «إجابة خاطئة +0 — الصحيح: ب الجزائر».
   (All four states exist in a light and a dark theme; structure identical.)
5. **Teacher Home** (mobile, 390 wide, scrolls). Vertical flex: top bar (avatar+name / EN chip+wordmark) → nav chip row (wrap) → greeting block → 2 creation cards (AI, manual) → dashed draft-resume bar → «نشاطاتي» activity card list.
6. **Activity Designer — Questions tab** (desktop, 1000 wide). Vertical: top bar (back / title+autosave / guide) → 3-step tab bar → question navigator row (label / pills 1–10 / new-question CTA) → two columns (RTL): main column (question text field, options list, media buttons) + fixed 280px side panel (question-type grid 2×5, hint box).

---

## 3. COMPONENTS

### 3.1 Answer Option (student)
Sizing: full width, `min-height 60px`, padding `8px 12px`, radius `16px`, internal gap `12px`, list gap `10px`. Contains: letter badge (start), label (flex:1 when trailing element exists), optional trailing element.
- **Letter badge**: 34×34px, radius 10px, fill `#FFFFFF`, glyph 17px/700 in the option's hue. Letters أ ب ج د — color is never the only differentiator.
- Variants by slot: أ `#D6403F`, ب `#0E8FA0`, ج `#C8811A`, د `#6C3DF4`; label text `#FFFFFF` 18px/600.
- States:
  - *default*: solid hue fill, no border.
  - *pressed* (implied): darken fill one step, no size change.
  - *selected (waiting)*: 3px solid border — `#10173A` light / `#FFFFFF` dark — + trailing chip «اختيارك» (13px/700, pill, inverted: navy fill/white text on light; white fill/navy text on dark). `box-sizing: border-box` so height is unchanged.
  - *unselected while waiting*: opacity `.35` light / `.30` dark.
  - *correct (revealed)*: fill `#1F9D55`, 3px border as selected, trailing ✓ circle 30×30px white fill, glyph in green.
  - *wrong pick (revealed)*: keeps its hue fill, trailing ✕ circle 30×30px white fill, glyph in hue.
  - *neutral (revealed, uninvolved)*: fill `#ECEBF2`, text `#8A8FAD`, badge white/`#8A8FAD` (light); fill `#1A2250`, text `#9BA0C0`, badge `#2A3158`/`#9BA0C0` (dark).

### 3.2 Timer (number + shrinking bar)
Row: digit + track, gap 10px. Digit: LTR, 19px/700, tabular-nums, fixed width 30px, centered; `#10173A`/`#FFFFFF` while running, `#8A8FAD`/`#9BA0C0` at 0. Track: flex:1, height 6px, pill, `#E3E2EC` light / `#2A3158` dark. Fill: height 100%, pill, `#6C3DF4` light / `#8B66F7` dark, width = remaining/total %. Fill anchors to the inline-start (right in RTL) and shrinks toward it.

### 3.3 Header stat
15px/600, tabular-nums, forced LTR. Counter `3/10` («/10» in muted). Score: `pts` prefix 12px muted + value. One at each end of the header row.

### 3.4 Waiting indicator
3 dots 6×6px (7×7 in v1), pill, accent color, `tapio-pulse` animation staggered 0 / .2s / .4s + 14px/600 accent text, gap 8px.

### 3.5 Image slot (question media)
Full width, fixed height 110px, radius 12px, 1px solid border, flat fill (`#EFEEF4`+`#D8DAE6` light; `#1A2250`+`#2A3158` dark), centered caption `IMAGE · صورة السؤال` 12px ui-monospace muted. Present in all states; drop when a question has no media and let the question block center.

### 3.6 Buttons (teacher)
All pill (99px), font 13–15px/600–700.
- **Primary (cyan)**: fill `#3BD6EE`, text `#10173A` 700. Heights: 48px (cards), 44px (compact bars).
- **Primary (purple)**: fill `#6C3DF4`, text `#FFFFFF` 700, 48px.
- **Secondary/outline**: transparent fill, 1px `#2A3158` border, text `#FFFFFF` 600, 44–48px.
- **Ghost outline (accent)**: 1px `#6C3DF4` border, text `#B9A4FF`, 44px («متابعة»).
- **Text links**: 13px/600 `#9BA0C0`; destructive «حذف» `#FF7A72`. Minimum tap area still 44px.
- States: hover = fill/border lightened one step; pressed = darkened one step; disabled = 45% opacity. Never browser defaults; focus-visible = 2px `#6C3DF4` outline, offset 2px.

### 3.7 Nav chip
Pill, padding 9px 16px, 14px. Default: 1px `#2A3158` border, white text /500. Primary variant: `#3BD6EE` fill, navy text /700, «+» prefix.

### 3.8 Activity card
Fill `#1A2250`, 1px `#2A3158`, radius 16px, padding 16px, internal gap 12px. Rows: title (16/700 white) → meta (13 muted; digits LTR) → 2 equal primary/secondary buttons (gap 8) → secondary text-link row (gap 16): استنساخ · انشر في المكتبة · حذف.

### 3.9 Creation card
Same surface as activity card; AI variant carries 1px `#6C3DF4` border. Title 16/700, body 13 muted, one full-width 48px button.

### 3.10 Draft resume bar
Full width, 1px **dashed** `#2A3158`, radius 16px, padding 14px 16px; text block (14/600 + 12 muted) + trailing 44px ghost button.

### 3.11 Avatar
36×36px circle, fill `#2A3158`; placeholder caption 10px ui-monospace muted until a real photo is supplied.

### 3.12 Tab step (designer)
Equal thirds, min-height 52px, radius 14px, centered label 15px + numbered circle 24×24px (LTR digit). Inactive: 1px `#2A3158` border, muted text, circle `#2A3158`. Active: 2px `#6C3DF4` border, fill `#1A2250`, white 700, circle `#6C3DF4`.

### 3.13 Question number pill
34×34px, radius 10px, LTR digits, row gap 6px. Active: `#6C3DF4` fill, white 700. Inactive: 1px `#2A3158` border, `#9BA0C0` 600.

### 3.14 Question type tile
2-column grid, gap 8px, radius 12px, padding 10px 12px, centered 13px. Inactive: 1px `#2A3158`, muted 500. Selected: 2px `#6C3DF4`, fill `#1A2250`, white 700. Ten types, fixed order: اختيار من متعدد، صح/خطأ، استطلاع رأي، مقياس، سحابة كلمات، إجابة مفتوحة، أكمل الفراغ، رتّب بالترتيب، طابق بين طرفين، شريحة عرض.

### 3.15 Option editor row
Row gap 10px: correct-toggle 44×44px (radius 12) + text field (flex:1, fill `#1A2250`, 1px border, radius 12, padding 11px 16px, 15px) + remove 44×44px. Correct state: toggle fill `#1F9D55` white ✓ and field border turns `#1F9D55`. Empty row: placeholder text in `#9BA0C0`.

### 3.16 Text field / textarea (designer)
Fill `#1A2250`, 1px `#2A3158`, radius 14px, padding 14px 16px, text 16/500 white, min-height 72px for question text.

---

## 4. RTL NOTES

- Root of every screen: `dir="rtl"`. Reading order, flex order, text alignment all mirror automatically — build with logical properties (`inline-start`), never `left/right`.
- **Must mirror**: letter badge sits at inline-start of the answer option; trailing chips/✓/✕ at inline-end; back button at inline-start of the top bar with a left-pointing glyph (→ renders as "back" in RTL context — use a logical back icon); side panel in the designer sits at inline-end; timer bar fill anchors inline-start and shrinks toward it.
- **Must NOT mirror**: digits and digit groups. All numbers are Latin (0-9) inside `dir="ltr"` spans: timer digit, score, `3/10` counter, question-number pills row (1…10 left-to-right), step-circle numerals, dates' numeric parts, `+120` / `+0` deltas. `pts` label precedes its value inside the LTR span.
- Percent/points deltas: whole token LTR (`+120`), placed inline within RTL sentences.
- ✓ and ✕ glyphs are direction-neutral; do not flip.
- `tabular-nums` on every live-updating number to prevent width jitter.

---

## 5. MOTION

- **Waiting dots** (`tapio-pulse`): opacity .35 → 1 → .35, keyframes at 0/50/100%, duration `1.2s`, linear default easing, infinite; three dots staggered by `0s / 0.2s / 0.4s`.
- **Timer bar**: width updates once per second; animate with `transition: width 1s linear` so depletion reads continuous.
- **Answer press** (implied): fill darkens one step on press, `~80ms ease-out`; no scale, no shadow.
- **Selection**: 3px border + chip appear instantly (no transition) — speed over polish during a live countdown.
- **Reveal**: state swap is a hard cut; optional 150ms ease-out fade on the status line. No confetti, no bounces.
