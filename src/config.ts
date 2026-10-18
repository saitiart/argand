// =============================================================================
//  UI configuration: parameter types, default values and slider ranges
// =============================================================================

export type Topology = 'triangle-list' | 'line-list' | 'point-list';
export type Vec3Tuple = [number, number, number];

export interface Params {
    funcSelection: number;
    rotateSpeed: number;
    animateSpeed: number;
    resolution: number;
    scale: number;
    box_height: number;       // half-height of the box in graph mode; R of the height curve
    height_mode: number;      // see HEIGHT_MODES
    rot_xw: number;
    rot_yw: number;
    rot_zw: number;
    domain_size_x: number;
    domain_size_z: number;
    domain_center_x: number;
    domain_center_z: number;
    scale_re: number;
    scale_im: number;
    amp_re: number;
    amp_im: number;
    shift_x: number;
    shift_z: number;
    use_riemann_sphere: number;
    sphere_mode: number;      // Riemann sphere look: 0 flat, 1 |f| relief, 2 4D graph
    showAxes: boolean;
    showBoundingBox: boolean;
    clipToBox: boolean;
    pole_radius: number;      // hole radius around poles, fraction of the domain size (0 = off)
    topology: Topology;
    use_quaternion_rotation: number;
    quat_angle_left: number;
    quat_angle_right: number;
    quat_axis_left: Vec3Tuple;
    quat_axis_right: Vec3Tuple;
    show_fibration: number;
    showSurface: boolean;
    // Calculus (calculus.ts, expression-vm-dual.wgsl)
    calc_view: number;        // 0 f, 1 f′ = ∂f/∂z, 2 ∂f/∂z̄
    markNonHolomorphic: boolean;
    showContour: boolean;
    contourShape: number;     // 0 circle, 1 closed polygon, 2 open path (CONTOUR_SHAPES)
    contour_polygon: [number, number][];
    contour_path: [number, number][];
    contour_cx: number;
    contour_cy: number;
    contour_r: number;
}

export const INITIAL_PARAMS: Params = {
    funcSelection: 0,
    rotateSpeed: 0,
    animateSpeed: 2,
    resolution: 1024,
    scale: 1.0,
    box_height: 1.0,
    height_mode: 1,
    rot_xw: 0,
    rot_yw: 0,
    rot_zw: 0,
    domain_size_x: 1.0,
    domain_size_z: 1.0,
    domain_center_x: 0.0,
    domain_center_z: 0.0,
    scale_re: 1.0,
    scale_im: 1.0,
    amp_re: 1.0,
    amp_im: 1.0,
    shift_x: 0.0,
    shift_z: 0.0,
    use_riemann_sphere: 0.0,
    sphere_mode: 0,
    showAxes: true,
    showBoundingBox: true,
    clipToBox: true,
    pole_radius: 0.04,
    topology: 'triangle-list',
    use_quaternion_rotation: 0.0,
    quat_angle_left: 0.0,
    quat_angle_right: 0.0,
    quat_axis_left: [1.0, 0.0, 0.0],
    quat_axis_right: [0.0, 1.0, 0.0],
    show_fibration: 0.0,
    showSurface: true,
    calc_view: 0,
    markNonHolomorphic: false,
    showContour: false,
    contourShape: 0,
    contour_polygon: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]],
    contour_path: [[-0.8, -0.4], [0.0, 0.6], [0.8, -0.4]],
    contour_cx: 0.0,
    contour_cy: 0.0,
    contour_r: 0.5,
};

export const GUI_RANGES = {
    animateSpeed: { min: 0, max: 10, step: 0.01 },
    rotateSpeed:  { min: 0, max: 10, step: 0.1 },
    resolution:   { min: 16, max: 2056, step: 8 },
    rotation:     { min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 },
    domainSize:   { min: 0.1, max: 50.0, step: 0.1 },
    inputScale:   { min: -10.0, max: 10.0, step: 0.1 },
    outputAmp:    { min: -10.0, max: 10.0, step: 0.1 },
    shift:        { min: -50.0, max: 50.0, step: 0.1 },
    quatAngle:    { min: -Math.PI * 2, max: Math.PI * 2, step: 0.01 },
    quatAxis:     { min: -1.0, max: 1.0, step: 0.01 },
    poleRadius:   { min: 0.0, max: 0.25, step: 0.005 },
    boxHeight:    { min: 0.1, max: 20.0, step: 0.1 },
    contourRadius: { min: 0.01, max: 50.0, step: 0.01 },
};


export const HEIGHT_MODES = {
    'Linear (clip to box)': 0,
    'Soft cap': 1,
    'Log': 2,
};

export const TOPOLOGY_OPTIONS: Topology[] = ['triangle-list', 'line-list', 'point-list'];
