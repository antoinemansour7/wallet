# Interaction Reference

> Micro-interactions extracted from live DOM. Recreate these exactly for authentic feel.

## Coverage

| Component Type | Count | States Captured |
|----------------|-------|----------------|
| Button | 3 | default, hover, focus |
| Link | 3 | default, hover, focus |

## Transition System

These transition declarations were extracted from interactive elements:

```css
transition: border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997);
transition: all;
```

Apply these to all interactive elements. Never invent new durations or easings.

## Button Interactions

### Button 1 — `Open search`

**States:**

- Default: `../screens/states/button-1-default.png`
- Hover: `../screens/states/button-1-hover.png`
- Focus: `../screens/states/button-1-focus.png`

**On hover:**

```css
/* background-color: color(srgb 0.988235 0.988235 0.988235 / 0.2) → */ background-color: oklab(0.317101 0.00222545 0.00251587 / 0.100459);
```

**Transition:** `border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997)`

### Button 2 — `Menu`

**States:**

- Default: `../screens/states/button-2-default.png`
- Hover: `../screens/states/button-2-hover.png`
- Focus: `../screens/states/button-2-focus.png`

**On hover:**

```css
/* background-color: color(srgb 0.988235 0.988235 0.988235 / 0.2) → */ background-color: oklab(0.317841 0.00222306 0.00251312 / 0.100514);
```

**Transition:** `border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997)`

### Button 3 — `Open chat`

**States:**

- Default: `../screens/states/button-3-default.png`
- Hover: `../screens/states/button-3-hover.png`
- Focus: `../screens/states/button-3-focus.png`

**On hover:**

```css
/* background-color: rgb(255, 255, 255) → */ background-color: oklab(0.999994 0.0000455677 0.0000200868 / 0.800864);
```

**Transition:** `border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997)`

## Link Interactions

### Link 1 — `a`

**States:**

- Default: `../screens/states/link-1-default.png`
- Hover: `../screens/states/link-1-hover.png`
- Focus: `../screens/states/link-1-focus.png`

**On hover:**

```css
/* outline: rgb(50, 48, 47) none 3px → */ outline: rgb(50, 48, 47) none 0px;
```

**On focus:**

```css
/* outline: rgb(50, 48, 47) none 3px → */ outline: rgb(0, 95, 204) auto 1px;
/* outline-color: rgb(50, 48, 47) → */ outline-color: rgb(0, 95, 204);
```

**Transition:** `all`

### Link 2 — `Log in`

**States:**

- Default: `../screens/states/link-2-default.png`
- Hover: `../screens/states/link-2-hover.png`
- Focus: `../screens/states/link-2-focus.png`

**On hover:**

```css
/* background-color: color(srgb 0.988235 0.988235 0.988235 / 0.2) → */ background-color: oklab(0.316599 0.00222708 0.00251773 / 0.100422);
```

**Transition:** `border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997)`

### Link 3 — `Get started`

**States:**

- Default: `../screens/states/link-3-default.png`
- Hover: `../screens/states/link-3-hover.png`
- Focus: `../screens/states/link-3-focus.png`

**On hover:**

```css
/* background-color: rgb(50, 48, 47) → */ background-color: oklab(0.310881 0.00224558 0.0025389 / 0.800728);
```

**Transition:** `border-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997), background-color 0.35s cubic-bezier(0.241, 0.969, 0.635, 0.997)`

## Interaction Rules

- Accent color `#ff8a71` is used for focus rings, active states, and hover highlights
- Hover effects include **color transitions** — use the extracted values, not approximations
- Focus states use **outline** (not box-shadow) — always match the extracted focus ring
- Transition durations in use: `0.35s`
- Always respect `prefers-reduced-motion` — set all transitions to `0s` when enabled

