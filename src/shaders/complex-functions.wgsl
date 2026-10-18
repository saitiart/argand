fn c_func(input: vec2f, a: f32, select_id: u32) -> vec2f {
    var z = vec2f(input.x, input.y);
    var fz = z;

    if (select_id == 0u) {
        fz = c_pow_f(z, 2.0);
    } else if (select_id == 1u) {
        fz = c_log(z);
    } else if (select_id == 2u) {
        fz = c_sin(z);
    } else if (select_id == 3u) {
        fz = c_tan(z);
    } else if (select_id == 4u) {
        fz = c_sqrt(z);
    } else if (select_id == 5u) {
        fz = c_sin(c_inv(z));
    } else if (select_id == 6u) {
        fz = c_exp(z);
    } else if (select_id == 7u) {
        fz = c_pow(z, z);
    } else if (select_id == 8u) {
        fz = c_exp(c_inv(z));
    } else if (select_id == 9u) {
        fz = z + c_inv(z);
    } else if (select_id == 10u) {
        fz = c_zeta(z);
    } else if (select_id == 11u) {
        fz = c_xi(z);
    } else if (select_id == 12u) {
        fz = c_gamma(z);
    } else if (select_id == 13u) {
        fz = c_bessel_j(z, 1.0);
    } else if (select_id == 14u) {
        fz = c_airy(z);
    } else if (select_id == 15u) {
        let c = vec2f(-0.4 + 0.3 * sin(a * 0.7), 0.6 + 0.2 * cos(a * 0.5));
        fz = julia_fractal(z, c);
    } else if (select_id == 16u) {
    // 1 / sin(pi*a + z^3): threefold pole rosettes at z^3 = (k - a)*pi.
    // The parameter `a` rotates/breathes the pole lattice (period 1).
    let z3 = c_pow_f(z, 3.0);                 // z^3
    let arg = z3 + vec2f(PI * a, 0.0);        // pi*a + z^3  (real offset)
    fz = c_inv(c_sin(arg));                   // 1 / sin(...)        // z^sin(...)
    } else if (select_id == 17u) {
        // Custom: generated from the expression box (see src/expression.ts)
        fz = c_user(z);
    }

    return fz;
}