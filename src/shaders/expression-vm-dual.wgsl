// Dual-number version of the expression interpreter: runs the same bytecode
// as c_user() (expression-vm.wgsl), but every stack entry carries the value
// and both Wirtinger derivatives
//
//     ∂f/∂z  = ½(∂f/∂x − i ∂f/∂y)      (= f′ when f is holomorphic)
//     ∂f/∂z̄  = ½(∂f/∂x + i ∂f/∂y)      (= 0 exactly when f is holomorphic)
//
// Derivatives are exact (chain rule per instruction). Γ, ζ, ξ, Airy and Bessel
// use a central difference for g′, which is accurate to ~1e-4 relative.
//
// Uses `program`, `user_params` (expression-vm.wgsl), cp and the c_* helpers.

struct Dual {
    v: vec2f,
    dz: vec2f,
    dzb: vec2f,
};

fn d_const(c: vec2f) -> Dual { return Dual(c, vec2f(0.0), vec2f(0.0)); }

fn d_add(a: Dual, b: Dual) -> Dual { return Dual(a.v + b.v, a.dz + b.dz, a.dzb + b.dzb); }
fn d_sub(a: Dual, b: Dual) -> Dual { return Dual(a.v - b.v, a.dz - b.dz, a.dzb - b.dzb); }

fn d_mul(a: Dual, b: Dual) -> Dual {
    return Dual(
        c_mul(a.v, b.v),
        c_mul(a.dz, b.v) + c_mul(a.v, b.dz),
        c_mul(a.dzb, b.v) + c_mul(a.v, b.dzb)
    );
}

fn d_div(a: Dual, b: Dual) -> Dual {
    let q = c_div(a.v, b.v);                                   // (a′ − q b′) / b
    return Dual(q, c_div(a.dz - c_mul(q, b.dz), b.v), c_div(a.dzb - c_mul(q, b.dzb), b.v));
}

// Holomorphic g applied to u: g(u), g′(u)·u_z, g′(u)·u_z̄
fn d_chain(u: Dual, gv: vec2f, gp: vec2f) -> Dual {
    return Dual(gv, c_mul(gp, u.dz), c_mul(gp, u.dzb));
}

// Not holomorphic: conj swaps the two derivatives
fn d_conj(u: Dual) -> Dual { return Dual(c_conj(u.v), c_conj(u.dzb), c_conj(u.dz)); }

// x / (2i) = −i x / 2
fn div_2i(x: vec2f) -> vec2f { return vec2f(0.5 * x.y, -0.5 * x.x); }

fn d_real(u: Dual) -> Dual {          // (u + ū) / 2
    return Dual(c_real(u.v), 0.5 * (u.dz + c_conj(u.dzb)), 0.5 * (u.dzb + c_conj(u.dz)));
}

fn d_imag(u: Dual) -> Dual {          // (u − ū) / 2i
    return Dual(c_imag(u.v), div_2i(u.dz - c_conj(u.dzb)), div_2i(u.dzb - c_conj(u.dz)));
}

fn d_abs(u: Dual) -> Dual {           // √(u ū)
    let m = length(u.v);
    let ub = c_conj(u.v);
    let k = 0.5 / max(m, 1e-30);
    return Dual(
        vec2f(m, 0.0),
        k * (c_mul(ub, u.dz) + c_mul(u.v, c_conj(u.dzb))),
        k * (c_mul(ub, u.dzb) + c_mul(u.v, c_conj(u.dz)))
    );
}

fn d_arg(u: Dual) -> Dual {           // (log u − log ū) / 2i
    let ub = c_conj(u.v);
    return Dual(
        c_phase(u.v),
        div_2i(c_div(u.dz, u.v) - c_div(c_conj(u.dzb), ub)),
        div_2i(c_div(u.dzb, u.v) - c_div(c_conj(u.dz), ub))
    );
}

fn d_pow(a: Dual, b: Dual) -> Dual {  // a^b = exp(b log a)
    let v = c_pow(a.v, b.v);
    let la = c_log(a.v);
    return Dual(
        v,
        c_mul(v, c_mul(b.dz, la) + c_div(c_mul(b.v, a.dz), a.v)),
        c_mul(v, c_mul(b.dzb, la) + c_div(c_mul(b.v, a.dzb), a.v))
    );
}

// Functions whose derivative is taken numerically (all holomorphic)
fn heavy_eval(op: u32, x: vec2f, n: f32) -> vec2f {
    switch (op) {
        case OP_GAMMA:     { return c_gamma(x); }
        case OP_ZETA:      { return c_zeta(x); }
        case OP_XI:        { return c_xi(x); }
        case OP_AIRY:      { return c_airy(x); }
        case OP_BESSEL_J:  { return c_bessel_j(x, n); }
        case OP_FACTORIAL: { return c_gamma(x + vec2f(1.0, 0.0)); }
        default:           { return x; }
    }
}

fn d_heavy(op: u32, u: Dual, n: f32) -> Dual {
    let h = 1e-3 * max(1.0, length(u.v));
    let gv = heavy_eval(op, u.v, n);
    let gp = (heavy_eval(op, u.v + vec2f(h, 0.0), n) - heavy_eval(op, u.v - vec2f(h, 0.0), n)) / (2.0 * h);
    return d_chain(u, gv, gp);
}

fn c_user_d(z: vec2f) -> Dual {
    var stack: array<Dual, 16>;
    var sp: u32 = 0u;
    let n = min(program.count, VM_MAX_INSTRUCTIONS);
    let one = vec2f(1.0, 0.0);

    for (var pc = 0u; pc < n; pc++) {
        let ins = program.code[pc];
        let i = max(sp, 1u) - 1u;          // top of stack
        let x = stack[i];
        let a = stack[max(i, 1u) - 1u];
        let push_at = min(sp, VM_STACK_SIZE - 1u);
        let u = x.v;

        switch (ins.op) {
            // push
            case OP_CONST: { stack[push_at] = d_const(ins.value); sp++; }
            case OP_Z:     { stack[push_at] = Dual(z, one, vec2f(0.0)); sp++; }
            case OP_T:     { stack[push_at] = d_const(vec2f(cp.animationTime, 0.0)); sp++; }
            case OP_PARAM: { stack[push_at] = d_const(user_params[min(ins.arg, arrayLength(&user_params) - 1u)]); sp++; }

            // binary
            case OP_ADD: { stack[i - 1u] = d_add(a, x); sp--; }
            case OP_SUB: { stack[i - 1u] = d_sub(a, x); sp--; }
            case OP_MUL: { stack[i - 1u] = d_mul(a, x); sp--; }
            case OP_DIV: { stack[i - 1u] = d_div(a, x); sp--; }
            case OP_POW: { stack[i - 1u] = d_pow(a, x); sp--; }

            // unary
            case OP_NEG:      { stack[i] = Dual(-x.v, -x.dz, -x.dzb); }
            case OP_POW_REAL: {
                let k = ins.value.x;
                stack[i] = d_chain(x, c_pow_f(u, k), k * c_pow_f(u, k - 1.0));
            }
            case OP_SIN:   { stack[i] = d_chain(x, c_sin(u), c_cos(u)); }
            case OP_COS:   { stack[i] = d_chain(x, c_cos(u), -c_sin(u)); }
            case OP_TAN:   { let t = c_tan(u);  stack[i] = d_chain(x, t, one + c_mul(t, t)); }
            case OP_SINH:  { stack[i] = d_chain(x, c_sinh(u), c_cosh(u)); }
            case OP_COSH:  { stack[i] = d_chain(x, c_cosh(u), c_sinh(u)); }
            case OP_TANH:  { let t = c_tanh(u); stack[i] = d_chain(x, t, one - c_mul(t, t)); }
            case OP_ASIN:  { stack[i] = d_chain(x, c_asin(u), c_inv(c_sqrt(one - c_mul(u, u)))); }
            case OP_ACOS:  { stack[i] = d_chain(x, c_acos(u), -c_inv(c_sqrt(one - c_mul(u, u)))); }
            case OP_ATAN:  { stack[i] = d_chain(x, c_atan(u), c_inv(one + c_mul(u, u))); }
            case OP_ASINH: { stack[i] = d_chain(x, c_asinh(u), c_inv(c_sqrt(c_mul(u, u) + one))); }
            case OP_EXP:   { let e = c_exp(u); stack[i] = d_chain(x, e, e); }
            case OP_LOG:   { stack[i] = d_chain(x, c_log(u), c_inv(u)); }
            case OP_SQRT:  { let r = c_sqrt(u); stack[i] = d_chain(x, r, c_inv(2.0 * r)); }
            case OP_INV:   { let r = c_inv(u); stack[i] = d_chain(x, r, -c_mul(r, r)); }
            case OP_CONJ:  { stack[i] = d_conj(x); }
            case OP_RE:    { stack[i] = d_real(x); }
            case OP_IM:    { stack[i] = d_imag(x); }
            case OP_ABS:   { stack[i] = d_abs(x); }
            case OP_ARG:   { stack[i] = d_arg(x); }
            case OP_GAMMA, OP_ZETA, OP_XI, OP_AIRY, OP_BESSEL_J, OP_FACTORIAL: {
                stack[i] = d_heavy(ins.op, x, ins.value.x);
            }
            default: {}
        }
    }

    return stack[0];
}
