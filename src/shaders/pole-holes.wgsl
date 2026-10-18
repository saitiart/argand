// Second compute pass: round holes around poles (graph mode only).
//
// Runs after complex4d.wgsl on the same vertex buffer. For each grid point it
// estimates f' and f'' from its neighbours (no extra evaluations of f), then:
//
//   d = |f / f'|            distance to the nearest zero or pole
//                           (exact |z - z0| at a simple pole, |z - z0|/n for order n)
//   q = 1 - f f'' / f'^2    = (f/f')' : +1/m near a zero of order m,
//                                       -1/n near a pole of order n
//
// A point is near a pole when Re q < 0 (or |f| is huge), and it is cut when
// d < r. keep = d/r - 1 changes linearly with distance, so after interpolation
// the hole edges are round circles of radius r around each pole. It is clamped
// to [-1, 1] so it only varies near the edge (steep values would overshoot when
// the rasterizer evaluates them at triangle edges).
//
// Right next to a pole the central difference straddles it and underestimates
// |f'|, so d also uses the steepest one-sided difference (which sees the pole).
//
// Large-but-regular values (z^2 far out, exp z) have large d and are never cut;
// the bounding box clips them instead.

@group(0) @binding(0) var<storage, read_write> verts: array<VertexData>;
@group(0) @binding(1) var<uniform> cp: ComplexParams;

const HUGE_LOG2: f32 = 20.0;   // |f| > 2^20 counts as "near a pole" even if q is unreliable

fn hole_is_non_finite(x: f32) -> bool {
    return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u;
}

fn hole_bad(v: vec2f) -> bool {
    return hole_is_non_finite(v.x) || hole_is_non_finite(v.y);
}

fn cmul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn cdiv(a: vec2f, b: vec2f) -> vec2f {
    let d = dot(b, b);
    return vec2f(dot(a, b) / d, (a.y * b.x - a.x * b.y) / d);
}

fn domain_at(i: u32, j: u32, res: u32) -> vec4f {
    return verts[i + j * res].domain;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let res = u32(cp.resolution);
    if (id.x >= res || id.y >= res) { return; }
    let idx = id.x + id.y * res;

    // Only the plain graph needs holes: on the Riemann sphere and the fiber
    // bundle, infinity is a drawable point.
    let graph = cp.show_fibration < 0.5 && cp.use_riemann_sphere < 0.5;
    let r = cp.pole_radius * max(cp.domain_size_x, cp.domain_size_z);
    if (!graph || r <= 0.0 || verts[idx].keep < 0.0) { return; }

    let c = verts[idx].domain;           // xy = z, zw = f
    let f = c.zw;

    // Central differences along each grid direction that has both neighbours
    var d1 = vec2f(0.0);                 // sum of f' estimates
    var d2 = vec2f(0.0);                 // sum of f'' estimates
    var n = 0.0;
    var steepest = 0.0;                  // max one-sided |Δf / Δz|
    var fx = vec2f(0.0);                 // f′ along x and along y (agree when f is holomorphic)
    var fy = vec2f(0.0);
    var step = 0.0;                      // grid spacing in z

    if (id.x > 0u && id.x + 1u < res) {
        let a = domain_at(id.x - 1u, id.y, res);
        let b = domain_at(id.x + 1u, id.y, res);
        if (hole_bad(a.zw) || hole_bad(b.zw)) { verts[idx].keep = -1.0; return; }   // next to a singular sample
        let h = (b.xy - a.xy) * 0.5;     // complex step
        fx = cdiv(b.zw - a.zw, 2.0 * h);
        step = length(h);
        d1 += fx;
        d2 += cdiv(b.zw - 2.0 * f + a.zw, cmul(h, h));
        n += 1.0;
        steepest = max(steepest, max(length(a.zw - f) / length(a.xy - c.xy), length(b.zw - f) / length(b.xy - c.xy)));
    }
    if (id.y > 0u && id.y + 1u < res) {
        let a = domain_at(id.x, id.y - 1u, res);
        let b = domain_at(id.x, id.y + 1u, res);
        if (hole_bad(a.zw) || hole_bad(b.zw)) { verts[idx].keep = -1.0; return; }
        let h = (b.xy - a.xy) * 0.5;
        fy = cdiv(b.zw - a.zw, 2.0 * h);
        step = max(step, length(h));
        d1 += fy;
        d2 += cdiv(b.zw - 2.0 * f + a.zw, cmul(h, h));
        n += 1.0;
        steepest = max(steepest, max(length(a.zw - f) / length(a.xy - c.xy), length(b.zw - f) / length(b.xy - c.xy)));
    }
    if (n == 0.0) { return; }            // grid corner
    let fp = d1 / n;
    let fpp = d2 / n;

    let fp_len = length(fp);
    if (fp_len == 0.0 || hole_bad(fp)) { return; }

    let dist = length(f) / max(fp_len, steepest);           // |f / f'|
    let q = vec2f(1.0, 0.0) - cdiv(cmul(f, fpp), cmul(fp, fp));
    let huge = log2(max(length(f), 1e-30)) > HUGE_LOG2;

    // The test assumes a meromorphic f. Skip points where f is not holomorphic:
    // exactly when derivatives are on (extra.w = |f_z̄| share), otherwise when the
    // x and y difference quotients disagree (a discrete Cauchy–Riemann check;
    // only trusted a few cells away from a singular point).
    if (verts[idx].extra.w > 0.01) { return; }
    if (n == 2.0 && !huge && dist > 2.0 * step &&
        length(fx - fy) > 0.25 * (length(fx) + length(fy))) { return; }

    if (q.x < 0.0 || huge) {
        let k = clamp(dist / r - 1.0, -1.0, 1.0);           // < 0 inside the circle
        verts[idx].keep = select(-1.0, k, !hole_is_non_finite(dist));
    }
}
