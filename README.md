<img width="100%" alt="sin-video" src="https://github.com/user-attachments/assets/c1d3ebc0-52c6-464b-a91e-9511d25aa146" />
<img width="100%" alt="riemann" src="https://github.com/user-attachments/assets/720c4301-ad2f-432c-98a7-c7dae718369b" />
<img width="100%"  alt="params" src="https://github.com/user-attachments/assets/c1cdb78e-1d61-4e48-9091-4a2aedb5f120" />
<img width="100%"  alt="julia" src="https://github.com/user-attachments/assets/11b96fc9-a683-41f4-8449-218a8999dc45" />
<img width="100%"  alt="gamma" src="https://github.com/user-attachments/assets/7463360f-e618-48ca-855b-407d084e91b4" />
<img width="100%"  alt="comp-calc" src="https://github.com/user-attachments/assets/dcf37057-c23c-4df8-9322-2a837ed956a0" />
<img width="100%" alt="banner" src="https://github.com/user-attachments/assets/0f661ca9-c6bb-414f-8e3b-844aa89d7d3a" />
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
