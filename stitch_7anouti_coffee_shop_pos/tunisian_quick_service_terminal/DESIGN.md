---
name: Tunisian Quick-Service Terminal
colors:
  surface: '#f3faff'
  surface-dim: '#d0dce3'
  surface-bright: '#f3faff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eaf5fc'
  surface-container: '#e4f0f7'
  surface-container-high: '#deeaf1'
  surface-container-highest: '#d8e4eb'
  on-surface: '#121d22'
  on-surface-variant: '#3f484b'
  inverse-surface: '#273237'
  inverse-on-surface: '#e7f3fa'
  outline: '#6f797b'
  outline-variant: '#bfc8cb'
  surface-tint: '#1d6776'
  primary: '#004652'
  on-primary: '#ffffff'
  primary-container: '#0f5f6e'
  on-primary-container: '#94d7e8'
  inverse-primary: '#8ed1e2'
  secondary: '#855300'
  on-secondary: '#ffffff'
  secondary-container: '#fea619'
  on-secondary-container: '#684000'
  tertiary: '#004930'
  on-tertiary: '#ffffff'
  tertiary-container: '#006343'
  on-tertiary-container: '#55e4a8'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#aaedff'
  primary-fixed-dim: '#8ed1e2'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#004e5b'
  secondary-fixed: '#ffddb8'
  secondary-fixed-dim: '#ffb95f'
  on-secondary-fixed: '#2a1700'
  on-secondary-fixed-variant: '#653e00'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#f3faff'
  on-background: '#121d22'
  surface-variant: '#d8e4eb'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.02em
  label-sm:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.04em
  currency-display:
    fontFamily: Plus Jakarta Sans
    fontSize: 30px
    fontWeight: '800'
    lineHeight: 36px
    letterSpacing: -0.02em
  currency-display-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '800'
    lineHeight: 30px
    letterSpacing: -0.01em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-tablet: 1rem
  margin: 1rem
  margin-tablet: 1.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
  space-2xl: 2rem
---

## Brand & Style

This design system establishes a high-velocity, ergonomic touch environment tailored specifically for the fast-paced ecosystem of Tunisian neighborhood coffee shops, cafeterias, and snack bars. The interface reflects precision, warmth, and reliable operational efficiency. It balances pragmatic retail speed with an approachable neighborhood presence, replacing cluttered legacy cash registers with a modern tactile tool.

The visual direction combines crisp tactile surfaces with soft, atmospheric lighting. By pairing bright white card tiles with a soft coastal tint and structured functional elevations, the UI eliminates eye strain across extended shifts while maintaining clear visual hierarchy under varied interior and outdoor terrace lighting. Tactile feedback, broad thumb-reachable tap targets, and purely abstract vector iconography define the core aesthetic.

## Colors

The color palette centers on a disciplined nautical deep teal foundation, supported by intuitive status tokens calibrated for rapid recognition at arm's length.

- **Primary (`#0F5F6E`):** Represents core transactional hierarchy, primary interactive buttons, and main navigation states. Its pressed state shifts to `#093F4A`.
- **Canvas & Surfaces:** Light mode operates on a pale atmospheric wash (`#F4F8F9` shifting subtly to `#EAF2F4`), framed with high-contrast `#FFFFFF` interaction cards and micro-borders (`#E1ECEE`). Dark mode inverts to an ink-teal surface palette anchored by `#101B20` with elevated tonal panels at `#17262D`.
- **Semantic Accents:**
  - **Success / Positive (`#10B981` / `#059669`):** Paid status, completed orders, active shifts, and affirmative checkout triggers.
  - **Critical / Danger (`#EF4444` / `#DC2626`):** Voided orders, out-of-stock / 86 items, terminal disconnects, and shift closures.
  - **Warning / Pending (`#F59E0B`):** Void requests awaiting manager approval, delayed kitchen tickets, and cash drawer warnings.
  - **Currency Presentation:** All monetary amounts (DT / TND) use the high-contrast dark neutral (`#101B20` in light mode, `#F4F8F9` in dark mode) to ensure price scanning without cognitive fatigue.

## Typography

The type system pairs Plus Jakarta Sans for structural headers, brand touchpoints, and numerical totals with Inter for item lists, ticket modifiers, and functional UI metadata.

- **Numerals & Pricing:** All numeric displays enforce tabular figures (`font-variant-numeric: tabular-nums`) so that three-decimal Tunisian Dinar values (`2.500 DT`, `14.750 TND`) align systematically across bill receipts and real-time totalizers.
- **Hierarchy:** High-density counter transactions require clear visual division between item names (semi-bold) and modifier states or sizes (regular weight, subdued opacity).
- **Legibility under Motion:** Labels on catalog buttons maintain bold weights and concise titles to remain scannable during rapid hand movements and peak ordering rushes.

## Layout & Spacing

The layout architecture prioritizes mobile-first single-hand operation on handheld Android POS terminals (such as Sunmi, iMin, or standard smartphones), scaling efficiently to 10-inch counter tablets.

- **Thumb-Zone Optimization:** Critical action buttons (Pay, Charge, Add, Tender) reside strictly within the bottom 35% of the viewport. Catalog categories and high-frequency categories occupy the upper center.
- **Touch Target Threshold:** All tap targets maintain a mandatory minimum dimension of 48×48px, with high-frequency catalog cards scaling to a minimum of 64px height.
- **Reflow Rules:**
  - **Phone (< 600px):** Single-column workflow. The current ticket minimizes into a sticky bottom summary sheet that expands into a full drawer on tap. The item grid follows a 2-column or 3-column layout.
  - **Tablet / Landscape (≥ 600px):** Split-screen layout. The catalog occupies a fluid 60% left region while the order ticket sits pinned in a 40% right-side workspace with dedicated keypad and tender buttons always visible.

## Elevation & Depth

Visual hierarchy uses physical sheet elevations combined with soft, daylight-inspired ambient drop shadows.

- **Level 0 (Flat Canvas):** The background canvas uses an architectural cool tone without shadows.
- **Level 1 (Catalog Tiles & Inactive Cards):** Card surfaces sit on `#FFFFFF` with a crisp micro-border (`1px solid #E1ECEE`) and an ambient shadow: `box-shadow: 0 2px 6px -1px rgba(15, 95, 110, 0.06), 0 1px 3px -1px rgba(0, 0, 0, 0.04)`.
- **Level 2 (Active Selections, Modals & Floating Paybars):** Sticky bottom payment summaries and modal sheets introduce focused depth: `box-shadow: 0 10px 25px -4px rgba(15, 95, 110, 0.12), 0 4px 6px -2px rgba(15, 95, 110, 0.04)`.
- **Level 3 (Alerts & Dialog Overlays):** Void authorization dialogs and cash drawer prompts cast deep structural focus: `box-shadow: 0 20px 30px -6px rgba(16, 27, 32, 0.22)`.

## Shapes

The interface embraces a balanced, friendly geometric form with `roundedness: 2` (base 0.5rem / 8px).

- **Catalog Cards & Modals:** Standard order items feature 8px corner radii (`rounded-md`), while aggregate container surfaces and bottom sheets use 16px corner radii (`rounded-lg` / `rounded-xl`).
- **Interactive Buttons & Chips:** Quick category selectors (e.g., Express, Drinks, Sandwiches) and bottom action triggers feature smooth 8px radii or full pill curves for small metadata badges.
- **Icon containers:** Vector icon backings within category tiles employ 12px squircle treatments to provide soft framing without visual clutter.

## Components

### Action Buttons & Primary Controls
- **Tender / Primary Button:** Full-width sticky button styled in deep teal (`#0F5F6E`) with bold 16px white typography, minimum height 54px. Displays the active order total aligned to the right. State changes on press to `#093F4A` with a scale-down micro-interaction (`scale: 0.98`).
- **Secondary Action Buttons:** Light teal tint (`#EAF2F4`) with deep teal text for auxiliary actions (Split Bill, Hold Ticket, Add Note).

### Category Chips & Filters
- Horizontally scrollable row positioned beneath top stats. Unselected chips have a white fill, `1px solid #E1ECEE` border, and dark gray text. Selected chips fill with `#0F5F6E` and crisp white text. Minimum height 40px for quick index-finger tapping.

### Item & Catalog Grid Cards
- Pure white container cards (`#FFFFFF`) featuring flat, line-and-fill vector icons representing categories (coffee cups, direct croissants, soda bottles, baguettes). No photographic imagery.
- Card contents: Vector illustration centered, bold title below, base price tagged distinctly in 3-decimal format (e.g., `1.800 DT`). Out-of-stock items (86'd) display an opaque grayscale overlay and a crimson corner badge (`#EF4444`).

### Order Ticket & Item Lists
- High-density list format. Each row shows quantity stepper (`-`, `qty`, `+`), product label, applied modifiers (e.g., `Sans Sucre`, `Zied Fromage`), and total line amount.
- Swipe left on a row triggers a quick red void action (`#EF4444`).

### Form Inputs & Keypads
- Integrated tactile numeric keypad for custom price entry and cash received calculations. Keypad cells measure at least 56px height with prominent, center-aligned numerals. Text inputs use an inset border (`#E1ECEE`) that transitions to a 2px `#0F5F6E` border on focus.

### Checkboxes, Radios & Switches
- 24×24px minimum footprint with high-contrast check marks. Modifiers use rounded square tags that toggle into teal with a white check when selected.

### Bottom Navigation Bar
- Pinned at base across phone screens (5 items: POS, Orders, Customers, Shift, Settings). Fixed height 64px, active items indicated by solid `#0F5F6E` icons with labeled text; inactive items displayed in muted slate (`#64748B`).