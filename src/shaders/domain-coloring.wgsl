// Domain coloring for the surface (fragment stage).
//
// Prepended to shader-basic.wgsl. Input is the per-vertex `extra` written by
// complex4d.wgsl:  x = log2|f|,  yz = f/|f| (phase direction).
//
//   hue        = arg f            (red = positive real axis)
//   lightness  = log|f|
//   contours   = |f| level lines + phase lines

const TAU: f32 = 6.28318530717959;

fn is_non_finite(x: f32) -> bool {
    return (bitcast<u32>(x) & 0x7f800000u) == 0x7f800000u;
}

// ---------- Palette ----------

fn oklab_to_linear_srgb(L: f32, a: f32, b: f32) -> vec3f {
    let l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    let m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    let s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    return vec3f(
         4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
}

fn linear_to_srgb(c: vec3f) -> vec3f {
    let lo = c * 12.92;
    let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
    return select(hi, lo, c <= vec3f(0.0031308));
}

// Even-looking hue wheel: constant lightness and chroma, only the hue turns.
fn cyclic_palette(t: f32) -> vec3f {
    let h = TAU * t;
    let L = 0.72;   // lightness
    let C = 0.11;   // chroma (saturation); much higher clips some hues
    let rgb = oklab_to_linear_srgb(L, C * cos(h), C * sin(h));
    return linear_to_srgb(clamp(rgb, vec3f(0.0), vec3f(1.0)));
}

// ---------- Contour lines ----------

// 0 on a contour line, 1 away from it. ~2 px lines, faded out where too dense.
fn contour(v: f32, w_in: f32) -> f32 {
    if (is_non_finite(v) || is_non_finite(w_in)) { return 1.0; }   // no NaN lines
    let w = max(w_in, 1e-5);                                       // no 0/0
    let d = abs(fract(v + 0.5) - 0.5);                             // distance to nearest integer
    let line = clamp((d - w) / w, 0.0, 1.0);                       // 0 within ~w, 1 beyond ~2w
    let fade = clamp((w - 0.2) / 0.2, 0.0, 1.0);                   // lines denser than ~5 px fade out
    return mix(line, 1.0, fade);
}

// ---------- Entry point ----------


fn domain_color(extra: vec4f) -> vec3f {
    let log_mag = extra.x;
    // An imaginary part of exactly −0 (e.g. conj of a real value) makes atan2
    // jump between 0 and pi on some GPUs; treat ±0 as +0.
    let dir = vec2f(extra.y, select(extra.z, 0.0, abs(extra.z) < 1e-30));
    let hue = fract(atan2(dir.y, dir.x) / TAU);       // red = positive real axis
    let mag = exp2(log_mag);

    // Modulus lines: every 0.25 above |f| = 1, every 10^0.5 below 1
    let v_lin = mag / 0.9;
    let v_log = log_mag * 0.60206;                     // log10|f| / 0.5
    let w_lin = fwidth(v_lin);
    let w_log = fwidth(v_log);

    // Phase lines every pi
    let v  = hue * 2.0;
    let v2 = fract(hue + 0.5) * 2.0;
    let w_ph = min(fwidth(v), fwidth(v2));             // ignores the 0/1 wrap seam

    // Hue = phase (+ a little |f|), lightness = log|f|
    let HUE_FROM_MOD = 0.0;
    let color_hue = fract(hue + HUE_FROM_MOD * log_mag);
    var c = cyclic_palette(color_hue);
    let L = 0.3 + 0.55 * (0.5 + 0.5 * tanh(log_mag * 0.35));
    c = select(c * (2.0 * L), mix(c, vec3f(1.0), 2.0 * L - 1.0), L >= 0.5);

    // Contour lines darken the color
    let mod_line = select(contour(v_log, w_log), contour(v_lin, w_lin), mag >= 1.0);
    let k = min(mod_line, contour(v, w_ph));
    c *= mix(0.7, 1.0, k);

    return c;
}
