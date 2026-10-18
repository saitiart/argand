# Complex 4D Visualizer

Interactive WebGPU visualizer for complex functions f : ℂ → ℂ. The graph of f
lives in four dimensions (Re z, Im z, Re f, Im f); here it is rotated in 4D,
projected to 3D and coloured by phase (hue = arg f, lightness = |f|).

## Run

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build into dist/
```

Needs a browser with WebGPU: Chrome / Edge 113+ or Safari 18+. On Linux, enable
`chrome://flags/#enable-unsafe-webgpu` and `chrome://flags/#enable-vulkan`.

## What it does

- **Any formula in z**, e.g. `(z^2 - a)/(z^2 + b)`. Extra letters become sliders,
  `t` is time. Includes Γ, ζ, Airy, Bessel and more.
- **4D views**: graph, Riemann sphere (with ∞ as a real point) and S²×S².
  Rotate through the 4th dimension with sliders, quaternion globes or
  Shift + drag.
- **Calculus**: exact f′ and ∂f/∂z̄, stripes where f is not holomorphic, and
  contour integrals along circles, polygons or paths drawn on a map. Shows
  ∮ f dz, the sum of residues and zeros − poles inside.

## Try

| Formula | Look for |
|---|---|
| `z^3` | one zero counted three times: colours wrap 3× around 0 |
| `1/(z^2+1)` | two poles; ∮ around i gives π |
| `gamma(z)` | poles at 0, −1, −2, …; no zeros |
| `abs(z)` | not holomorphic: striped everywhere |
| `sin(z)` on the Riemann sphere | essential singularity at ∞ |

## Controls

Drag to orbit · right drag / wheel to pan and zoom · Shift + drag to rotate in
4D · **H** hides the sidebar.

## Code

`src/main.ts` holds the GPU pipelines and main loop, `src/ui/` the sidebar,
`src/calculus.ts` the contour integrals and `src/shaders/` all WGSL (the core
geometry is in `complex4d.wgsl`).
