// Surface parameters. Written by buildParamsArray() in main.ts — keep the order in sync.
struct ComplexParams {
  resolution: f32,
  funcSelection: f32,
  pole_radius: f32,             // hole radius around poles, as a fraction of the domain size
  animationTime: f32,
  scale: f32,
  box_height: f32,              // half-height of the box; also R of the height curve
  domain_center_x: f32,
  domain_center_z: f32,
  domain_size_x: f32,
  domain_size_z: f32,
  rot_xw: f32,
  rot_yw: f32,
  rot_zw: f32,
  scale_re: f32,
  scale_im: f32,
  amp_re: f32,
  amp_im: f32,
  shift_x: f32,
  shift_z: f32,
  use_riemann_sphere: f32,
  sphere_mode: f32,             // Riemann sphere: 0 flat, 1 |f| relief, 2 4D graph
  use_quaternion_rotation: f32,
  quat_angle_left: f32,
  quat_angle_right: f32,
  quat_axis_left: vec3f,
  height_mode: f32,             // 0 linear, 1 soft cap, 2 log (fills the vec3 padding slot)
  quat_axis_right: vec3f,
  show_fibration: f32,
  calc_view: f32,               // what the surface shows: 0 f, 1 ∂f/∂z (f′), 2 ∂f/∂z̄
  need_derivs: f32,             // > 0.5: evaluate through the dual-number interpreter
  pad_a: f32,
  pad_b: f32,
}
