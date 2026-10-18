@group(0) @binding(0) var<storage, read> eval_points: array<vec2f>;
@group(0) @binding(1) var<uniform> cp: ComplexParams;
@group(0) @binding(4) var<storage, read_write> eval_results: array<vec2f>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
    if (id.x >= arrayLength(&eval_points)) { return; }
    eval_results[id.x] = c_func(eval_points[id.x], cp.scale, u32(cp.funcSelection));
}
