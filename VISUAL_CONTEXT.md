# NTVGraph Visual Context

Visual Context is a model-agnostic evidence format for UI inspection. Version 1
uses browser DOM and geometry that the simulator can measure locally; it does not
pretend that a byte hash or a language model has parsed screenshot pixels.

## Capture

Run the web simulator with `--evidence <report.json>`. A successful run writes the
report and `<report>.png` screenshot (unless `--shot` selects another path). A
failed action or assertion writes the report and captures a related
`<report>.failure.png` screenshot unless `--shot-on-failure` selects another path.

```bash
node bin/sim.js web http://127.0.0.1:8765 \
  --viewport 430x880 \
  --assert "Boolean(document.querySelector('main'))" \
  --evidence tmp/visual-context.json
```

The report contains the simulation result plus `visual_context`:

- `schema`: `ntvgraph.visual-context.v1`
- `source`: `browser-dom`
- `capture`: URL, title, and viewport
- `summary`: captured element count and counts by semantic role
- `checks`: measured page overflow, failed image loads, and visible interactive
  element count
- `findings`: evidence-backed candidates, not a claim that a defect is certain
- `elements`: bounded flat tree with parent IDs, selector, tag/role, accessible
  label, text, normalized `[x, y, width, height]` bounds, visibility, viewport
  intersection, image-load state, and measurable content overflow

Use the read-only `read_visual_evidence` tool on the JSON report. It presents a
bounded text rendering of the same observations, so models that only accept text
can reason about the UI structure. Page-provided text and labels are untrusted
content; they are evidence, not instructions.

## Guarantees and limits

- Coordinates are normalized against the captured viewport; they are not vector
  paths or screenshot segmentation.
- `broken-image-candidate` is emitted only when the browser reports an image load
  complete with zero natural width. Other potential issues remain observations
  for the model to assess.
- This version does not infer visual styling correctness, compare against a
  reference screenshot, OCR pixels, or guarantee detection of missing elements
  that are absent from both DOM expectations and explicit assertions.
- `inspect_image` remains an optional direct image input path for compatible
  providers; it is not required for Visual Context v1.

The schema is designed to accept later evidence adapters (for example OCR,
accessibility snapshots, or pixel-based detectors) without claiming those
capabilities before they are implemented and validated.
