// --- Constants ---
const E: f32 = 2.71828182845;
const G_LANCZOS: f32 = 7.0;
const PI: f32 = 3.14159265359;
const SQRT_2PI: f32 = 2.50662827463;

// --- Basic Arithmetic ---

fn c_add(a: vec2f, b: vec2f) -> vec2f {
    return a + b;
}

fn c_sub(a: vec2f, b: vec2f) -> vec2f {
    return a - b;
}

fn c_mul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn c_div(a: vec2f, b: vec2f) -> vec2f {
    let d = dot(b, b);
    return vec2f(dot(a, b) / d, (a.y * b.x - a.x * b.y) / d);
}

fn c_conj(z: vec2f) -> vec2f {
    return vec2f(z.x, -z.y);
}

fn c_inv(z: vec2f) -> vec2f {
    let d = dot(z, z);
    return vec2f(z.x / d, -z.y / d);
}

// --- Powers, Logs, and Roots ---

fn c_arg(z: vec2f) -> f32 {
    var f: f32 = atan2(z.y, z.x);
    if (f < 0.0) { f = f + 6.28318530718; }
    return f; 
}

// fn c_log(z: vec2f) -> vec2f {
//     return vec2f(log(length(z)), atan2(z.y, z.x));
// }

fn c_log(z: vec2f) -> vec2f {
    let radius = max(length(z), 1e-6);
    let angle = atan2(z.y, z.x);
    return vec2f(log(radius), angle);
}

fn c_exp(z: vec2f) -> vec2f {
    return exp(z.x) * vec2f(cos(z.y), sin(z.y));
}

fn c_sqrt(z: vec2f) -> vec2f {
    let m = length(z);
    let s = sqrt(0.5 * vec2f(m + z.x, m - z.x));
    return s * vec2f(1.0, sign(z.y));
}

fn c_pow(base: vec2f, exponent: vec2f) -> vec2f {
    return c_exp(c_mul(exponent, c_log(base)));
}

fn c_pow_f(base: vec2f, n: f32) -> vec2f {
    let r = length(base);
    let a = atan2(base.y, base.x);
    return pow(r, n) * vec2f(cos(a * n), sin(a * n));
}

// --- Trigonometry ---

fn c_sin(z: vec2f) -> vec2f {
    let a = pow(E, z.y);
    let b = pow(E, -z.y);
    return vec2f(sin(z.x) * (a + b) * 0.5, cos(z.x) * (a - b) * 0.5);
}

fn c_cos(z: vec2f) -> vec2f {
    let a = pow(E, z.y);
    let b = pow(E, -z.y);
    return vec2f(cos(z.x) * (a + b) * 0.5, -sin(z.x) * (a - b) * 0.5);
}

fn c_tan(z: vec2f) -> vec2f {
    let a = pow(E, z.y);
    let b = pow(E, -z.y);
    let cx = cos(z.x);
    let ab = (a - b) * 0.5;
    return vec2f(sin(z.x) * cx, ab * (a + b) * 0.5) / (cx * cx + ab * ab);
}

fn c_asinh(z: vec2f) -> vec2f {
    // Identity: asinh(z) = ln(z + sqrt(z^2 + 1))
    let z_squared = c_mul(z, z);
    let z_squared_plus_1 = z_squared + vec2f(1.0, 0.0);
    let root_part = c_sqrt(z_squared_plus_1);
    
    return c_log(z + root_part);
}

// --- Gamma Function (Lanczos) ---

fn c_gamma_lanczos(z_in: vec2f) -> vec2f {
    let p = array<f32, 9>(
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    );

    let z = vec2f(z_in.x - 1.0, z_in.y);
    var s = vec2f(p[0], 0.0);
    for (var i = 1u; i < 9u; i++) {
        s += c_div(vec2f(p[i], 0.0), z + vec2f(f32(i), 0.0));
    }

    let t = z + vec2f(G_LANCZOS + 0.5, 0.0);
    return SQRT_2PI * c_mul(c_mul(c_pow(t, z + vec2f(0.5, 0.0)), c_exp(-t)), s);
}

fn c_gamma(z: vec2f) -> vec2f {
    if (z.x < 0.5) {
        let pz = z * PI;
        let sin_pz = vec2f(sin(pz.x) * cosh(pz.y), cos(pz.x) * sinh(pz.y));
        let gamma_omz = c_gamma_lanczos(vec2f(1.0 - z.x, -z.y));
        return c_div(vec2f(PI, 0.0), c_mul(sin_pz, gamma_omz));
    }
    return c_gamma_lanczos(z);
}

// --- Riemann Zeta & Xi ---

fn c_zeta_primitive(s: vec2f) -> vec2f {
    let N_TERMS = 100u;
    if (s.x < 0.0) { return vec2f(0.0, 0.0); }
    
    var eta_sum = vec2f(0.0, 0.0);
    for (var n = 1u; n <= N_TERMS; n++) {
        let n_s = c_pow(vec2f(f32(n), 0.0), s);
        let term = c_inv(n_s);
        if (n % 2u == 0u) { eta_sum -= term; } 
        else { eta_sum += term; }
    }

    let one_minus_s = vec2f(1.0, 0.0) - s;
    let two_pow_one_minus_s = c_pow(vec2f(2.0, 0.0), one_minus_s);
    let factor = vec2f(1.0, 0.0) - two_pow_one_minus_s;
    return c_div(eta_sum, factor);
}

fn c_zeta_reflection(s: vec2f) -> vec2f {
    let one_minus_s = vec2f(1.0 - s.x, -s.y);
    let pow2s = c_pow(vec2f(2.0, 0.0), s);
    let PI_s_minus_1 = c_pow(vec2f(PI, 0.0), s - vec2f(1.0, 0.0));
    
    let hs = s * PI * 0.5;
    let sin_hs = vec2f(sin(hs.x) * cosh(hs.y), cos(hs.x) * sinh(hs.y));
    
    let g = c_gamma(one_minus_s);
    let z = c_zeta_primitive(one_minus_s);

    return c_mul(c_mul(c_mul(c_mul(pow2s, PI_s_minus_1), sin_hs), g), z);
}

fn c_zeta(s: vec2f) -> vec2f {
    if (s.x < 0.0) { return c_zeta_reflection(s); }
    return c_zeta_primitive(s);    
}

fn c_xi(s: vec2f) -> vec2f {
    let s_minus_1 = s - vec2f(1.0, 0.0);
    let s_sq_part = c_mul(s, s_minus_1) * 0.5;

    let half_s = s * 0.5;
    let PI_pow = c_exp(vec2f(-half_s.x * log(PI), -half_s.y * log(PI)));

    let g = c_gamma(half_s);
    let z = c_zeta(s);

    return c_mul(c_mul(c_mul(s_sq_part, PI_pow), g), z);
}

// --- Fractals ---

fn julia(z: vec2f, c: vec2f) -> vec2f {
    return c_add(c_mul(z, z), c);
}

fn julia_cubic(z: vec2f, c: vec2f) -> vec2f {
    let z2 = c_mul(z, z); 
    return c_add(c_mul(z2, z), c);
}

fn julia_fractal(z_in: vec2f, c: vec2f) -> vec2f {
    var z = z_in;
    let max_iter = 512u; 
    
    for (var i = 0u; i < max_iter; i += 1u) {
        z = vec2f(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        
        if (dot(z, z) > 4.0) { 
            
            return z; 
        }
    }
    
    return vec2f(0.0, 0.0); 
}


// --- Bessel Function J_n(z) ---
// Uses the series expansion: J_n(z) = sum_{k=0}^inf [(-1)^k / (k! * Gamma(n+k+1))] * (z/2)^(n+2k)
fn c_bessel_j(z: vec2f, n: f32) -> vec2f {
    var sum = vec2f(0.0, 0.0);
    let z_half = z * 0.5;
    let z_sq_quad = c_mul(z_half, z_half) * -1.0; // (-z^2 / 4)
    
    // Initial term: (z/2)^n / Gamma(n+1)
    var term = c_div(c_pow_f(z_half, n), c_gamma(vec2f(n + 1.0, 0.0)));
    sum += term;

    // Iterate for convergence (10-12 terms is usually enough for visual accuracy)
    for (var k = 1.0; k < 12.0; k += 1.0) {
        // term_{k} = term_{k-1} * (-z^2/4) / (k * (n + k))
        let factor = k * (n + k);
        term = c_mul(term, c_div(z_sq_quad, vec2f(factor, 0.0)));
        sum += term;
    }
    return sum;
}

// --- Airy Function Ai(z) ---
// Uses the power series expansion for Ai(z)
fn c_airy(z: vec2f) -> vec2f {
    let ai_0 = 0.35502805388; // Ai(0) = 3^(-2/3) / Gamma(2/3)
    let ai_prime_0 = -0.25881940379; // Ai'(0) = -3^(-1/3) / Gamma(1/3)
    
    var f = vec2f(ai_0, 0.0);
    var g = vec2f(ai_prime_0, 0.0);
    
    let z2 = c_mul(z, z);
    let z3 = c_mul(z2, z);
    
    var f_term = vec2f(ai_0, 0.0);
    var g_term = c_mul(vec2f(ai_prime_0, 0.0), z);
    
    var f_sum = f_term;
    var g_sum = g_term;

    // Series: Ai(z) = ai_0 * f(z) + ai_prime_0 * g(z)
    for (var k = 1.0; k < 8.0; k += 1.0) {
        let k3 = 3.0 * k;
        let f_fac = (k3 * (k3 - 1.0));
        f_term = c_mul(f_term, c_div(z3, vec2f(f_fac, 0.0)));
        f_sum += f_term;

        let g_fac = (k3 * (k3 + 1.0));
        g_term = c_mul(g_term, c_div(z3, vec2f(g_fac, 0.0)));
        g_sum += g_term;
    }
    
    return f_sum + g_sum;
}

// --- Extra helpers (used by expressions typed in the UI, see src/expression.ts) ---

fn c_sinh(z: vec2f) -> vec2f {
    return vec2f(sinh(z.x) * cos(z.y), cosh(z.x) * sin(z.y));
}

fn c_cosh(z: vec2f) -> vec2f {
    return vec2f(cosh(z.x) * cos(z.y), sinh(z.x) * sin(z.y));
}

fn c_tanh(z: vec2f) -> vec2f {
    return c_div(c_sinh(z), c_cosh(z));
}

// asin(z) = -i log(iz + sqrt(1 - z^2))
fn c_asin(z: vec2f) -> vec2f {
    let iz = vec2f(-z.y, z.x);
    let w = c_log(iz + c_sqrt(vec2f(1.0, 0.0) - c_mul(z, z)));
    return vec2f(w.y, -w.x);
}

// acos(z) = pi/2 - asin(z)
fn c_acos(z: vec2f) -> vec2f {
    return vec2f(PI * 0.5, 0.0) - c_asin(z);
}

// atan(z) = (i/2) (log(1 - iz) - log(1 + iz))
fn c_atan(z: vec2f) -> vec2f {
    let iz = vec2f(-z.y, z.x);
    let d = c_log(vec2f(1.0, 0.0) - iz) - c_log(vec2f(1.0, 0.0) + iz);
    return vec2f(-0.5 * d.y, 0.5 * d.x);
}

fn c_real(z: vec2f) -> vec2f    { return vec2f(z.x, 0.0); }
fn c_imag(z: vec2f) -> vec2f    { return vec2f(z.y, 0.0); }
fn c_modulus(z: vec2f) -> vec2f { return vec2f(length(z), 0.0); }
fn c_phase(z: vec2f) -> vec2f   { return vec2f(atan2(z.y, z.x), 0.0); }
