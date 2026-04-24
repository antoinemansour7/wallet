# Layout Reference

> Auto-extracted from live DOM. Use this to understand how the site is structured spatially.

## Spacing System

**Base grid:** 4px

**Scale:** `2, 4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28, 30, 32, 38` px

| Spacing | Semantic Use |
|---------|-------------|
| 4px | Tight — within a component |
| 8px | Medium — between sibling items |
| 16px | Wide — between sections |
| 32px | Vast — major section breaks |

## Flex Layouts

| Element | Direction | Justify | Align | Gap | Children |
|---------|-----------|---------|-------|-----|----------|
| `div.Background_wrapper___W2dAv.ws-content-default-theme` | row | end | — | 8px | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | column | end | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 1 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | row | — | — | — | 2 |
| `section.Section_section___ntyFI.Background_wrapper___W2dAv` | column | center | — | — | 3 |
| `div.Hero_container___IgkpT` | column | end | center | — | 3 |
| `div.ExplodedMenu_container___OMUzx` | column | — | — | — | 5 |
| `div#skip-to-main-content.SkipToMainContent_container___p4kas` | row | center | center | — | 1 |
| `span.WealthsimpleEyebrowContent_logoWrapper___HRJBF.ws-text-` | row | — | end | 8px | 1 |
| `span.WealthsimpleEyebrowContent_logoWrapper___HRJBF.ws-text-` | row | — | end | 8px | 1 |
| `span.WealthsimpleEyebrowContent_logoWrapper___HRJBF.ws-text-` | row | — | end | 8px | 1 |

## Grid Layouts

| Element | Template Columns | Gap | Children |
|---------|-----------------|-----|----------|
| `header.Header_header___qG6Dp` | `1040.72px 351.281px` | — | 4 |
| `nav.Footer_linksGrid___6y6Hx` | `170.656px 170.672px 170.672px 170.656px 170.672px ` | normal 32px | 6 |
| `div.Grid_grid___05MQq.ProductHero_contentContainer___0PO3q` | `464px 696px` | 24px | 1 |
| `div.Grid_grid___05MQq.ProductHero_contentContainer___0PO3q` | `464px 696px` | 24px | 1 |
| `div.Grid_grid___05MQq.ProductHero_contentContainer___0PO3q` | `464px 696px` | 24px | 1 |
| `div.Grid_grid___05MQq.ProductHero_contentContainer___0PO3q` | `464px 696px` | 24px | 1 |
| `div.Grid_grid___05MQq.ProductHero_contentContainer___0PO3q` | `464px 696px` | 24px | 1 |

## Structural Containers

### `<main>` (`main#main`)

```
display:          block
children:         10
```

### `<footer>` (`footer.Footer_wrapper___JfSQP`)

```
display:          block
padding:          0px 40px
max-width:        1264px
children:         4
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   column
justify-content:  end
align-items:      —
padding:          0px 0px 80px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          80px 0px
children:         1
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          160px 0px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          160px 0px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          block
padding:          160px 0px
children:         1
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          160px 0px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          160px 0px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   row
justify-content:  —
align-items:      —
padding:          160px 0px
children:         2
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          block
padding:          96px 0px 0px
children:         1
```

### `<section>` (`section.Section_section___ntyFI.Background_wrapper___W2dAv`)

```
display:          flex
flex-direction:   column
justify-content:  center
align-items:      —
padding:          160px 0px
children:         3
```

## Layout Rules

- **Container max-width:** `1264px` — always center with `margin: auto`
- Primary layout system: **Flexbox**
- Secondary layout system: **CSS Grid** (used for card grids and multi-column layouts)
- Every spacing value must be a multiple of **4px**
- Never use arbitrary margin/padding values outside the spacing scale

