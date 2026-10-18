// Surface compute shader: one invocation per grid point.
// Evaluates f once, builds the 4D point for the current mode, rotates and
// projects it to 3D, and writes a VertexData (vertex.wgsl).
//
// Holes: this pass only marks points where f is NaN/inf. Holes around poles
// are cut by the second pass (pole-holes.wgsl); values that are merely large
// are clipped by the bounding box in the render shader.

struct VertexDataArray {
    vertexDataArray: array<VertexData>,
};

const TAU: f32 = 6.28318530717959;

const PLOT_MODULUS: bool = false;

// Heights are scaled down to at most this (max-norm) so vertices near poles
// stay finite and triangles crossing the box edge interpolate accurately.
// Everything outside the bounding box is clipped when rendering.
const MAX_HEIGHT: f32 = 1e4;

// Results of the geometry function for the current invocation
var<private> g_keep: f32 = 1.0;          // < 0 = hole
var<private> g_fz: vec2f = vec2f(0.0);   // f(z) (coloring + pole detection)
var<private> g_z: vec2f = vec2f(0.0);    // domain point z
var<private> g_cr: f32 = 0.0;            // non-holomorphy |f_z̄| / (|f_z| + |f_z̄|): 0 holomorphic

@group(0) @binding(0) var<storage, read_write> vda: VertexDataArray;
@group(0) @binding(1) var<uniform> cp: ComplexParams;

// ---------- Helpers ----------

// Robust inf/NaN test (x != x may be optimized away by the compiler)
fn is_non_finite(x: f32) -> bool {
    return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u;
}

fn is_non_finite2(v: vec2f) -> bool {
    return is_non_finite(v.x) || is_non_finite(v.y);
}

// Evaluates the shown function at z once and records it. Marks a hole if it is NaN/inf.
// With derivatives on, the formula runs through the dual-number interpreter
// (expression-vm-dual.wgsl) and cp.calc_view picks f, ∂f/∂z or ∂f/∂z̄.
fn eval_f(z: vec2f) -> vec2f {
    var fz: vec2f;
    g_cr = 0.0;
    if (cp.need_derivs > 0.5) {
        let d = c_user_d(z);
        let a = length(d.dz);
        let b = length(d.dzb);
        if (a + b > 0.0 && !is_non_finite(a + b)) { g_cr = b / (a + b); }
        if (cp.calc_view > 1.5) {
            fz = d.dzb;
        } else if (cp.calc_view > 0.5) {
            fz = d.dz;
        } else {
            fz = d.v;
        }
    } else {
        fz = c_func(z, cp.scale, u32(cp.funcSelection));
    }
    g_z = z;
    g_fz = fz;
    g_keep = select(1.0, -1.0, is_non_finite2(fz));
    return fz;
}

// Height curve (cp.height_mode), applied to |h| with the direction kept, so
// Re f and Im f stay consistent and the phase is preserved. R = cp.box_height.
//   0  linear:    r                  (the box clips what doesn't fit)
//   1  soft cap:  R tanh(r / R)      (exact for small r, levels off at R: always inside the box)
//   2  log:       R ln(1 + r / R)    (exact for small r, logarithmic growth after)
// Must match heightCurve() in scene.ts (axis ticks).
fn map_height(h: vec2f) -> vec2f {
    let m = max(abs(h.x), abs(h.y));
    if (is_non_finite(m)) { return vec2f(0.0); }       // a hole anyway
    if (m == 0.0 || cp.height_mode < 0.5) { return limit_height(h); }

    let r = m * length(h / m);                          // |h| without overflow
    let R = max(cp.box_height, 1e-6);
    var s: f32;
    if (cp.height_mode > 1.5) {
        s = R * log(1.0 + r / R);
    } else {
        s = R * tanh(min(r / R, 20.0));                 // tanh(20) = 1 in f32; avoids inf/inf
    }
    return limit_height(h * (s / r));
}

// Scales v down so max(|v.x|, |v.y|) <= MAX_HEIGHT (no overflow, keeps direction)
fn limit_height(v: vec2f) -> vec2f {
    let m = max(abs(v.x), abs(v.y));
    if (is_non_finite(m)) { return vec2f(0.0); }   // a hole anyway
    if (m > MAX_HEIGHT) { return v * (MAX_HEIGHT / m); }
    return v;
}

fn grid_z(grid_pos: vec2u) -> vec2f {
    let res = f32(cp.resolution);
    let uv = (vec2f(grid_pos) / (res - 1.0)) * 2.0 - 1.0;
    return vec2f(
        (uv.x * cp.domain_size_x) + cp.shift_x,
        (uv.y * cp.domain_size_z) + cp.shift_z
    );
}

// Rotations: see rotation4d.wgsl

// ---------- Geometry modes ----------

// Graph of |f| (enable with PLOT_MODULUS)
fn get_p4d_modulus(grid_pos: vec2u) -> vec4f {
    let z = grid_z(grid_pos);
    let fz = eval_f(z);
    let h = map_height(vec2f(fz.x * cp.amp_re, fz.y * cp.amp_re));
    return vec4f(z.x * cp.scale_re, length(h), z.y * cp.scale_im, 0.0);
}

// Graph of f: (Re z, Re f, Im z, Im f)
fn get_p4d_capped(grid_pos: vec2u) -> vec4f {
    let z = grid_z(grid_pos);
    let fz = eval_f(z);
    let h = map_height(vec2f(fz.x * cp.amp_re, fz.y * cp.amp_im));
    return vec4f(z.x * cp.scale_re, h.x, z.y * cp.scale_im, h.y);
}

fn stereographic(w: vec2f) -> vec3f {
    let r2 = dot(w, w);
    let denom = 1.0 + r2;
    return vec3f(
        (2.0 * w.x) / denom,
        (2.0 * w.y) / denom,
        (r2 - 1.0) / denom
    );
}

// Domain on the Riemann sphere, coloured by f. North pole = z = ∞, south
// pole = 0, equator = |z| = domain size. Re z along x, Im z along y, ∞ along
// z (up on screen in the default view). cp.sphere_mode:
//   0 flat      the unit sphere (pure domain colouring)
//   1 relief    radius from log|f|: zeros are dents, poles are spikes
//   2 4D graph  radius from Re f, 4th coordinate Im f (both soft-capped),
//               so 4D rotations work as in the graph mode
// Infinity is a real point here, so nothing is holed.
fn get_p4d_standard_riemann(grid_pos: vec2u) -> vec4f {
    let res = f32(cp.resolution);
    let g = vec2f(grid_pos) / (res - 1.0);

    let theta = g.x * TAU;   // longitude
    let phi   = g.y * PI;    // colatitude: 0 = north pole (∞)
    let sin_phi = sin(phi);
    let s = vec3f(sin_phi * cos(theta), sin_phi * sin(theta), cos(phi));

    // Inverse stereographic projection (guarded at the north pole)
    let denom = max(1.0 - s.z, 1e-6);
    let z = vec2f(
        (s.x / denom) * cp.domain_size_x + cp.domain_center_x + cp.shift_x,
        (s.y / denom) * cp.domain_size_z + cp.domain_center_z + cp.shift_z
    );

    let w = eval_f(z);
    g_keep = 1.0;

    let dir = s;
    let finite = !is_non_finite2(w) && !is_non_finite(dot(w, w));

    if (cp.sphere_mode > 1.5) {
        // Soft cap with R = 1: radius 1 + Re f/2 in (0.5, 1.5), Im f/2 in (-0.5, 0.5)
        var c = vec2f(1.0, 0.0);
        if (finite) {
            let a = vec2f(w.x * cp.amp_re, w.y * cp.amp_im);
            let m = max(abs(a.x), abs(a.y));
            if (m > 0.0) {
                let r = m * length(a / m);
                c = a * (tanh(min(r, 20.0)) / r);
            } else {
                c = vec2f(0.0);
            }
        }
        return vec4f(dir * (1.0 + 0.5 * c.x), 0.5 * c.y);
    }

    if (cp.sphere_mode > 0.5) {
        var l = 1.0;                                     // pole / ∞: full spike
        if (finite) { l = tanh(0.5 * log(max(length(w), 1e-30))); }
        return vec4f(dir * (1.0 + 0.4 * l), 0.0);
    }

    return vec4f(dir, 0.0);
}

// Fiber bundle: S_z on the sphere, S_w in the fiber. Infinity is a point on
// the fiber sphere, so no holes here either.
fn get_p4d_fiber_bundle(grid_pos: vec2u) -> vec4f {
    let res = f32(cp.resolution);
    let uv = (vec2f(grid_pos) / (res - 1.0)) * 2.0 - 1.0;

    // Domain z
    let z = vec2f(
        uv.x * cp.domain_size_x * cp.scale_re + cp.domain_center_x + cp.shift_x,
        uv.y * cp.domain_size_z * cp.scale_im + cp.domain_center_z + cp.shift_z
    );

    // Codomain w = f(z)
    let w = eval_f(z);
    g_keep = 1.0;

    // S_z on the Riemann sphere
    let s = stereographic(z);

    // S_w on the Riemann sphere (inf/NaN -> north pole)
    var t = vec3f(0.0, 0.0, 1.0);
    if (!is_non_finite2(w) && !is_non_finite(dot(w, w))) {
        t = stereographic(w);
    }

    // Base point in R4
    let base = vec4f(s, 0.0);

    // Explicit frame Q_s : R3 -> Sigma_s
    let r = length(s.xy);

    var u1: vec4f;
    var u2: vec4f;
    let u3 = vec4f(0.0, 0.0, 0.0, 1.0);

    // Pole-safe branch
    if (r > 1e-6) {
        u1 = vec4f(-s.y / r, s.x / r, 0.0, 0.0);
        u2 = vec4f(-(s.x * s.z) / r, -(s.y * s.z) / r, r, 0.0);
    } else {
        // At north/south pole: Sigma_s = {X3 = 0}
        u1 = vec4f(1.0, 0.0, 0.0, 0.0);
        u2 = vec4f(0.0, 1.0, 0.0, 0.0);
    }

    // Fiber point Q_s(S_w)
    let fiber = t.x * u1 + t.y * u2 + t.z * u3;

    // Optional fiber radius scaling
    let rho = 1.0;

    // Final affine 4D point
    return base + rho * fiber;
}

// ---------- Main ----------

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id: vec3u) {
    let i = id.x;
    let j = id.y;
    let resolution = u32(cp.resolution);
    if (id.x >= resolution || id.y >= resolution) { return; }

    var p4d: vec4f;

    if (cp.show_fibration > 0.5) {
        p4d = get_p4d_fiber_bundle(id.xy);
    } else if (cp.use_riemann_sphere >= 0.5) {
        p4d = get_p4d_standard_riemann(id.xy);
    } else if (PLOT_MODULUS) {
        p4d = get_p4d_modulus(id.xy);
    } else {
        p4d = get_p4d_capped(id.xy);
    }

    // 4D rotations
    let rotated_p4d = rotate4d(p4d);

    let p3d = rotated_p4d.xyz;

    // Coloring data: log2|f| and phase direction
    let fm = length(g_fz);
    var extra = vec4f(30.0, 1.0, 0.0, g_cr);             // pole / NaN
    if (!is_non_finite(fm)) {
        extra = vec4f(
            clamp(log2(max(fm, 1e-30)), -30.0, 30.0),
            select(vec2f(1.0, 0.0), g_fz / fm, fm > 1e-30),
            g_cr
        );
    }

    let idx = i + j * resolution;
    vda.vertexDataArray[idx].position = p3d;
    vda.vertexDataArray[idx].keep = g_keep;
    vda.vertexDataArray[idx].extra = extra;
    vda.vertexDataArray[idx].domain = vec4f(g_z, g_fz);
}
