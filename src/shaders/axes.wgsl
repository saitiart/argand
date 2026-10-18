// Axes & bounding box: instanced cylinders (shafts, box edges) and cones (arrowheads).
//
// Per vertex (mesh, shared by all instances):
//   mesh.xy  = cos/sin around the segment,  mesh.z = 0 at start, 1 at end,
//   mesh.w   = radius scale (1 on the rim, 0 at a cone tip / cap centre)
//   mesh_n   = normal = radial * x + axial * y
// Per instance (segment, already 4D-rotated on the CPU):
//   a.xyz = start, a.w = radius,  b.xyz = end,  color.rgb

struct Uniforms {
    mvp: mat4x4f,
    model_view: mat4x4f,
};

@group(0) @binding(0) var<uniform> uni: Uniforms;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec3f,
    @location(1) normal: vec3f,
};

@vertex
fn vs_main(
    @location(0) mesh: vec4f,
    @location(1) mesh_n: vec2f,
    @location(2) a: vec4f,
    @location(3) b: vec4f,
    @location(4) color: vec4f,
) -> VertexOutput {
    let d = b.xyz - a.xyz;
    let len = length(d);

    // Zero-length segment (e.g. the W axis with no 4D rotation) collapses to a point
    var dir = vec3f(0.0, 1.0, 0.0);
    var radius = 0.0;
    if (len > 1e-6) {
        dir = d / len;
        radius = a.w;
    }

    // Orthonormal frame around the segment
    let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(dir.y) > 0.9);
    let u1 = normalize(cross(dir, helper));
    let v1 = cross(dir, u1);
    let radial = u1 * mesh.x + v1 * mesh.y;

    let p = a.xyz + d * mesh.z + radial * (radius * mesh.w);
    let n = radial * mesh_n.x + dir * mesh_n.y;

    var out: VertexOutput;
    out.position = uni.mvp * vec4f(p, 1.0);
    out.color = color.rgb;
    out.normal = (uni.model_view * vec4f(n, 0.0)).xyz;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let n = normalize(in.normal);
    let light = normalize(vec3f(0.35, 0.55, 1.0));   // view space: roughly from the camera
    let diffuse = abs(dot(n, light));
    return vec4f(in.color * (0.45 + 0.55 * diffuse), 1.0);
}
