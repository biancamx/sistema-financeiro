# Layout rules

- Keep the layer scale in `src/styles/global.css`: content `0`, sticky tables `10`, bars `20`, floating controls `30`, popovers `40`, modals/drawers `50`, and toasts `60`. Use the matching `--z-*` variable.
- Wrap wide tables in `.table-wrap` or `.table-responsive`; wrappers must stay `min-width: 0`, `max-width: 100%`, and own horizontal scrolling. Sticky cells need an opaque background and the table layer.
- Render only the selected view, or place multiple views in normal document flow; do not overlap mutually exclusive states.
- Avoid `100vw`; use container-relative widths. Every absolutely positioned element needs a clearly positioned ancestor.
- Give fixed controls safe-area offsets and enough page bottom padding so they do not cover the last content.
