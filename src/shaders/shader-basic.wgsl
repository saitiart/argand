// Surface render shader: transform, holes and bounding-box clipping.
// Coloring lives in domain-coloring.wgsl (prepended at pipeline creation).

struct RenderUniforms {
    mvp: mat4x4f,
    box_min: vec4f,     // xyz = box corner, w > 0.5 = clip to the box
    box_max: vec4f,     // xyz = box corner, w > 0.5 = stripe where f is not holomorphic
};

@binding(0) @group(0) var<uniform> uni: RenderUniforms;

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) @interpolate(perspective, centroid) keep: f32,   // < 0 = hole; centroid: never extrapolated
    @location(1) local: vec3f,      // position before the model matrix (box space)
    @location(2) extra: vec4f,      // x = log2|f|, yz = f/|f|, w = non-holomorphy (0..1)
};

struct FragmentOutput {
    @location(0) color: vec4f,
};

@vertex
fn vs_main(@location(0) pos: vec3f,
           @location(1) keep: f32,
           @location(2) extra: vec4f) -> VertexOutput {
    var output: VertexOutput;
    output.position = uni.mvp * vec4f(pos, 1.0);
    output.keep = keep;
    output.local = pos;
    output.extra = extra;
    return output;
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    // Color first: it takes screen-space derivatives, which must come before any discard
    let c = domain_color(in.extra);

    // Holes (NaN/inf, and circles around poles)
    if (in.keep < 0.0) {
        discard;
    }

    // Bounding box: everything outside is clipped (tiny margin so faces on the box stay)
    if (uni.box_min.w > 0.5) {
        let margin = 1e-4 * (uni.box_max.xyz - uni.box_min.xyz);
        if (any(in.local < uni.box_min.xyz - margin) || any(in.local > uni.box_max.xyz + margin)) {
            discard;
        }
    }

    // Not holomorphic (∂f/∂z̄ ≠ 0): diagonal red stripes, stronger the further from holomorphic
    var color = c;
    if (uni.box_max.w > 0.5) {
        let amount = smoothstep(0.002, 0.05, in.extra.w);
        let stripe = step(0.5, fract((in.position.x + in.position.y) / 10.0));
        color = mix(color, mix(color, vec3f(0.85, 0.12, 0.12), 0.6), amount * stripe);
    }

    return FragmentOutput(vec4f(color, 1.0));
}
