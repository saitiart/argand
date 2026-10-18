@group(0) @binding(0) var<storage, read_write> indices: array<u32>;
@group(0) @binding(1) var<uniform> resolution: u32;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) id : vec3u) {
    var i = id.x;
    var j = id.y;

    if(i >= resolution - 1u || j >= resolution - 1u ) { return; } 

    let idx = (i + j * (resolution - 1u)) * 6u;

    indices[idx] = i + j * resolution;
    indices[idx + 1u] = i + (j + 1u) * resolution;
    indices[idx + 2u] = i + 1u + j * resolution;

    indices[idx + 3u] = i + 1u + j * resolution;
    indices[idx + 4u] = i + (j + 1u) * resolution;
    indices[idx + 5u] = i + 1u + (j  + 1u) * resolution;
}