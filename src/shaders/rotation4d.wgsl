// 4D rotation of the scene (used by complex4d.wgsl).
// Needs `cp: ComplexParams` declared by the including shader.
// CPU mirror: rotate4D() in src/axes.ts.

fn apply_rotations(p: vec4f) -> vec4f {
    var out = p;

    // XW Rotation
    let c_xw = cos(cp.rot_xw); let s_xw = sin(cp.rot_xw);
    let xw_mat = mat2x2<f32>(c_xw, s_xw, -s_xw, c_xw);
    let res_xw = xw_mat * vec2f(out.x, out.w);
    out.x = res_xw.x; out.w = res_xw.y;

    // YW Rotation
    let c_yw = cos(cp.rot_yw); let s_yw = sin(cp.rot_yw);
    let yw_mat = mat2x2<f32>(c_yw, s_yw, -s_yw, c_yw);
    let res_yw = yw_mat * vec2f(out.y, out.w);
    out.y = res_yw.x; out.w = res_yw.y;

    // ZW Rotation
    let c_zw = cos(cp.rot_zw); let s_zw = sin(cp.rot_zw);
    let zw_mat = mat2x2<f32>(c_zw, s_zw, -s_zw, c_zw);
    let res_zw = zw_mat * vec2f(out.z, out.w);
    out.z = res_zw.x; out.w = res_zw.y;

    return out;
}

fn quat_mul(a: vec4f, b: vec4f) -> vec4f {
    return vec4f(
        a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,  // x
        a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,  // y
        a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,  // z
        a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z   // w (real part)
    );
}

fn apply_rotations_quaternion(q: vec4f, axis1: vec3f, angle1: f32, axis2: vec3f, angle2: f32) -> vec4f {
    let lh = angle1 * 0.5;
    let left_quat = vec4f(axis1 * sin(lh), cos(lh));

    let rh = angle2 * 0.5;
    let right_quat = vec4f(axis2 * sin(rh), cos(rh));

    return quat_mul(quat_mul(left_quat, q), right_quat);
}

// The rotation currently selected in the UI (planes or quaternion pair)
fn rotate4d(p: vec4f) -> vec4f {
    return select(
        apply_rotations(p),
        apply_rotations_quaternion(
            p,
            normalize(cp.quat_axis_left), cp.quat_angle_left,
            normalize(cp.quat_axis_right), cp.quat_angle_right
        ),
        cp.use_quaternion_rotation >= 0.5
    );
}
