<img width="100%" alt="sin-video" src="https://github.com/user-attachments/assets/c1d3ebc0-52c6-464b-a91e-9511d25aa146" />
<img width="100%" alt="riemann" src="https://github.com/user-attachments/assets/720c4301-ad2f-432c-98a7-c7dae718369b" />
<img width="100%"  alt="params" src="https://github.com/user-attachments/assets/c1cdb78e-1d61-4e48-9091-4a2aedb5f120" />
<img width="100%"  alt="julia" src="https://github.com/user-attachments/assets/11b96fc9-a683-41f4-8449-218a8999dc45" />
<img width="100%"  alt="gamma" src="https://github.com/user-attachments/assets/7463360f-e618-48ca-855b-407d084e91b4" />
<img width="100%"  alt="comp-calc" src="https://github.com/user-attachments/assets/dcf37057-c23c-4df8-9322-2a837ed956a0" />
<img width="100%" alt="banner" src="https://github.com/user-attachments/assets/0f661ca9-c6bb-414f-8e3b-844aa89d7d3a" />
# Complex 4D Grapher

Interactive WebGPU visualizer for complex functions f : ℂ → ℂ. The graph of f
is inherently 4D (Re z, Im z, Re f, Im f); here it is rotated in 4D,
projected to 3D and coloured by phase (hue = arg f, lightness = |f|). It is based on the code written for a paper you can 
find in <https://github.com/saitiart/complex-function-renderer>, although it still doesn't include parametric equations. 

**You can also directly read the paper here <https://dl.acm.org/doi/epdf/10.1145/3822516.3834886>**

## Running

```bash
npm install
npm run dev
```

Needs a browser with WebGPU: Chrome / Edge 113+ or Safari 18+. On Linux, enable
`chrome://flags/#enable-unsafe-webgpu` and `chrome://flags/#enable-vulkan`. All of 
my tests were done using the Brave Browser, and some Firefox. Brave Browser is more performant

## Some Features

- **4D Freedom** Full 4D rotation, allowing a better/more-intuitive understanding of complex functions
- **Riemann and Custom Projections** Options to show a given function as a Riemann projection or a custom S2xS2 Fibration, highlighting the modularity of the pipeline
- **Complex Calculus** Options to project the complex derivative of a function, and the contour integral. Try rotating around the 4th dimension to understand the Argand plot of the chosen function
- **Domain Control** Control the domain such as Re and Im scale and domain center.
- **Other** Control resolution if FPS fall down, Quaternion rotations if you are interested in visualizing them + interactive interface, different techniques to cap poles, and **WIP** method to discard poles using certain radius.

## Controls

Drag to orbit, right drag / wheel to pan and zoom and Shift + drag rotates in
4D, although sliders are recommended · **H** hides the sidebar or just click on it. 

## Code

`src/main.ts` holds the WebGPU pipelines and main loop, `src/ui/` the sidebar,
`src/calculus.ts` the contour integrals and `src/shaders/` all WGSL, with the main 
rendering logic being in `complex4d.wgsl`.

## Future Plans

If anybody finds this sort of thing useful, I can dedicate time to seriously work on it, starting at least with implementing parametric equations and many bug fixes and improvements. 

