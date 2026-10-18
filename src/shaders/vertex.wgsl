struct VertexData {
    position: vec3f,   // @0   final 3D position
    keep: f32,         // @12  < 0 = hole (interpolated, so hole edges are smooth)
    extra: vec4f,      // @16  x = log2|f|, yz = f/|f|   (coloring), w = non-holomorphy 0..1
    domain: vec4f,     // @32  xy = z, zw = f(z)          (pole detection)
};
