import { mat4, vec3 } from 'gl-matrix';
import createViewControls from '3d-view-controls';

import { Params, Topology, Vec3Tuple } from './config.ts';
import { FUNCTIONS, hasFormula, CUSTOM_FUNCTION_INDEX } from './functions.ts';
import { CalculusResources, createCalculus, requestContourEvaluation, drawContour } from './calculus.ts';
import { createGuiController } from './ui/panel.ts';
import './style.css';
import { AxesResources, Rotation4D, createAxes, drawAxes } from './axes.ts';
import { OPCODES_WGSL, PROGRAM_BUFFER_SIZE, PARAMETER_BUFFER_SIZE } from './expression.ts';
import { sceneLayout } from './scene.ts';

import wgslUniforms from './shaders/uniforms.wgsl';
import wgslVertex from './shaders/vertex.wgsl';
import wgslRotation from './shaders/rotation4d.wgsl';
import wgslPoleHoles from './shaders/pole-holes.wgsl';
import wgslComplexMath from './shaders/complex-func.wgsl';
import wgslSurface from './shaders/complex4d.wgsl';
import wgslFunctions from './shaders/complex-functions.wgsl';
import wgslIndices from './shaders/indices-comp.wgsl';
import wgslExpressionVM from './shaders/expression-vm.wgsl';
import wgslExpressionVMDual from './shaders/expression-vm-dual.wgsl';
import wgslSurfaceRender from './shaders/shader-basic.wgsl';
import wgslDomainColoring from './shaders/domain-coloring.wgsl';




interface Camera {
    eye: Vec3Tuple;
    center: Vec3Tuple;
    up: Vec3Tuple;
    tick(): void;
    matrix?: Float32Array;
}

interface FrameTextures {
    depthTexture: GPUTexture;
    msaaTexture: GPUTexture;
}

interface ComputeSurfaceResources {
    pipeline: GPUComputePipeline;
    vertexBuffer: GPUBuffer;
    paramsBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    polePipeline: GPUComputePipeline;
    poleBindGroup: GPUBindGroup;
}

interface ComputeIndexResources {
    pipeline: GPUComputePipeline;
    indexBuffer: GPUBuffer;
}

interface RenderPipelineResources {
    pipeline: GPURenderPipeline;
    uniformBuffer: GPUBuffer;          
    uniformBindGroup: GPUBindGroup;
    textures: FrameTextures;
    topology: Topology;
}

const MSAA_COUNT = 4;

// Surface vertex layout, see VertexData in shaders/vertex.wgsl:
//   position: vec3f  @ 0
//   keep:     f32    @ 12  (< 0 = hole)
//   extra:    vec4f  @ 16  (x = log2|f|, yz = f/|f|)
//   domain:   vec4f  @ 32  (z, f(z) — only used by the pole pass)
const SURFACE_VERTEX_STRIDE = 48;
const SURFACE_POSITION_OFFSET = 0;
const SURFACE_KEEP_OFFSET = 12;
const SURFACE_EXTRA_OFFSET = 16;

// ComplexParams uniform (uniforms.wgsl): 32 floats.
const PARAMS_BUFFER_SIZE = 36 * 4;


// Setup

async function initDevice(): Promise<{ device: GPUDevice; context: GPUCanvasContext; canvas: HTMLCanvasElement; format: GPUTextureFormat }> {
    const canvas = document.getElementById('canvas-webgpu') as HTMLCanvasElement;
    if (!navigator.gpu) throw new Error('WebGPU not supported');

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No GPUAdapter found');

    const maxSize = 1024 * 1024 * 6 * 32;
    const device = await adapter.requestDevice({
        requiredLimits: {
            maxStorageBufferBindingSize: maxSize,
            maxBufferSize: maxSize,
        },
    });

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;

    const context = canvas.getContext('webgpu')!;
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    return { device, context, canvas, format };
}


function estimateVRAM(resolution: number, msaaCount: number, canvasWidth: number, canvasHeight: number): string {
    const numVertices = resolution * resolution;
    const numIndices = 6 * (resolution - 1) * (resolution - 1);

    const positionBuffer = numVertices * 16; // vec4<f32>
    const normalBuffer = numVertices * 16;   // vec4<f32>
    const colorBuffer = numVertices * 16;    // vec4<f32>
    const indexBuffer = numIndices * 4;      // u32

    
    const renderTargets = canvasWidth * canvasHeight * 4 * msaaCount;
    const depthTargets = canvasWidth * canvasHeight * 4 * msaaCount;

    const totalBytes = positionBuffer + normalBuffer + colorBuffer + indexBuffer + renderTargets + depthTargets;
    return (totalBytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// Camera

function createInteractiveCamera(canvas: HTMLCanvasElement): Camera {
    return createViewControls(canvas, {
        eye: [0.0, 5.0, 0.0],
        center: [0, 0, 0],
        up: [0.0, 0.0, 0.0],
        zoomMax: 1000,
        zoomSpeed: 2,
    });
}

function getViewMatrix(cam: Camera): mat4 {
    if (cam.matrix) return cam.matrix as unknown as mat4;
    return mat4.lookAt(mat4.create(), cam.eye as vec3, cam.center as vec3, cam.up as vec3);
}


function createFrameTextures(
    device: GPUDevice,
    width: number,
    height: number,
    canvasFormat: GPUTextureFormat,
    msaaCount: number,
): FrameTextures {
    const depthTexture = device.createTexture({
        size: [width, height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: msaaCount,
    });
    const msaaTexture = device.createTexture({
        size: [width, height],
        format: canvasFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
        sampleCount: msaaCount,
    });
    return { depthTexture, msaaTexture };
}

function createUniformBuffer(device: GPUDevice, size: number): GPUBuffer {
    return device.createBuffer({
        size,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

// Compute


async function createSurfaceShaderPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    const code = [
        wgslUniforms, wgslVertex, wgslRotation, wgslComplexMath, wgslSurface, wgslFunctions,
        OPCODES_WGSL, wgslExpressionVM, wgslExpressionVMDual,
    ].join('\n');
    return createComputePipelineChecked(device, code);
}


async function createPoleHolePipeline(device: GPUDevice): Promise<GPUComputePipeline> {
    return createComputePipelineChecked(device, [wgslUniforms, wgslVertex, wgslPoleHoles].join('\n'));
}

async function createComputePipelineChecked(device: GPUDevice, code: string): Promise<GPUComputePipeline> {
    const module = device.createShaderModule({ code });

    try {
        return await device.createComputePipelineAsync({
            layout: 'auto',
            compute: { module, entryPoint: 'main' },
        });
    } catch (e) {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error').map(m => m.message);
        throw new Error(errors.length ? errors.join('\n') : String(e));
    }
}


function createComputeSurfaceResources(
    device: GPUDevice,
    resolution: number,
    pipeline: GPUComputePipeline,
    polePipeline: GPUComputePipeline,
    programBuffer: GPUBuffer,
    parameterBuffer: GPUBuffer,
): ComputeSurfaceResources {
    const vertexBuffer = device.createBuffer({
        size: resolution * resolution * SURFACE_VERTEX_STRIDE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });

    const paramsBuffer = createUniformBuffer(device, PARAMS_BUFFER_SIZE);

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: vertexBuffer } },
            { binding: 1, resource: { buffer: paramsBuffer } },
            { binding: 2, resource: { buffer: programBuffer } },
            { binding: 3, resource: { buffer: parameterBuffer } },
        ],
    });

    const poleBindGroup = device.createBindGroup({
        layout: polePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: vertexBuffer } },
            { binding: 1, resource: { buffer: paramsBuffer } },
        ],
    });

    return { pipeline, vertexBuffer, paramsBuffer, bindGroup, polePipeline, poleBindGroup };
}


async function createComputeIndexPipeline(
    device: GPUDevice,
    resolution: number,
): Promise<ComputeIndexResources> {
    const module = device.createShaderModule({ code: wgslIndices });

    const pipeline = await device.createComputePipelineAsync({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
    });

    const numIndices = 6 * (resolution - 1) * (resolution - 1);

    const indexBuffer = device.createBuffer({
        size: numIndices * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    const resolutionBuffer = createUniformBuffer(device, 4);
    device.queue.writeBuffer(resolutionBuffer, 0, Uint32Array.of(resolution));

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: indexBuffer } },
            { binding: 1, resource: { buffer: resolutionBuffer } },
        ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
    pass.end();
    device.queue.submit([encoder.finish()]);

    return { pipeline, indexBuffer };
}




async function createRenderPipeline(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    canvasFormat: GPUTextureFormat,
    msaaCount: number,
    topology: Topology = 'point-list',
): Promise<RenderPipelineResources> {
    const shaderModule = device.createShaderModule({ code: [wgslDomainColoring, wgslSurfaceRender].join('\n') });

    const pipeline = await device.createRenderPipelineAsync({
        layout: 'auto',
        vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
            buffers: [{
                arrayStride: SURFACE_VERTEX_STRIDE,
                attributes: [
                    { shaderLocation: 0, offset: SURFACE_POSITION_OFFSET, format: 'float32x3' },
                    { shaderLocation: 1, offset: SURFACE_KEEP_OFFSET,     format: 'float32' },
                    { shaderLocation: 2, offset: SURFACE_EXTRA_OFFSET,    format: 'float32x4' },
                ],
            }],
        },
        fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{
                format: canvasFormat,
                blend: {
                    color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
                },
            }],
        },
        primitive: {
            topology,
            cullMode: 'none',
        },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
        multisample: { count: msaaCount },
    });

    const uniformBuffer = createUniformBuffer(device, 96);   // mat4 + 2 × vec4

    const uniformBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    const textures = createFrameTextures(device, canvas.width, canvas.height, canvasFormat, msaaCount);

    return { pipeline, uniformBuffer, uniformBindGroup, textures, topology };
}


function derivativeView(params: Params): number {
    return hasFormula(params.funcSelection) ? Number(params.calc_view) : 0;
}

function needsDerivatives(params: Params): boolean {
    return hasFormula(params.funcSelection) && (Number(params.calc_view) > 0 || params.markNonHolomorphic);
}

function buildParamsArray(
    params: Params,
    resolution: number,
    animationTime: number,
    domainCenter: [number, number],
    autoRotations: { xw: number; yw: number; zw: number },
): Float32Array {
    return Float32Array.of(
        resolution,                               // 0
        params.funcSelection,                     // 1
        params.pole_radius,                       // 2
        animationTime,                            // 3
        params.scale,                             // 4
        params.box_height,                        // 5
        domainCenter[0],                          // 6
        domainCenter[1],                          // 7
        params.domain_size_x,                     // 8
        params.domain_size_z,                     // 9
        params.rot_xw + autoRotations.xw,         // 10
        params.rot_yw + autoRotations.yw,         // 11
        params.rot_zw + autoRotations.zw,         // 12
        params.scale_re,                          // 13
        params.scale_im,                          // 14
        params.amp_re,                            // 15
        params.amp_im,                            // 16
        params.shift_x,                           // 17
        params.shift_z,                           // 18
        params.use_riemann_sphere,                // 19
        Number(params.sphere_mode),               // 20
        params.use_quaternion_rotation,           // 21
        params.quat_angle_left,                   // 22
        params.quat_angle_right,                  // 23
        params.quat_axis_left[0],                 // 24
        params.quat_axis_left[1],                 // 25
        params.quat_axis_left[2],                 // 26
        params.height_mode,                       // 27  (fills the vec3 pad slot)
        params.quat_axis_right[0],                // 28
        params.quat_axis_right[1],                // 29
        params.quat_axis_right[2],                // 30
        params.show_fibration,                    // 31  (fills the vec3 pad slot)
        derivativeView(params),                   // 32  calc_view
        needsDerivatives(params) ? 1 : 0,         // 33  need_derivs
        0,                                        // 34
        0,                                        // 35
    );
}




interface DrawParams {
    device: GPUDevice;
    context: GPUCanvasContext;
    renderRes: RenderPipelineResources;
    surfaceRes: ComputeSurfaceResources;
    indexRes: ComputeIndexResources;
    axesRes: AxesResources;
    camera: Camera;
    modelMat: mat4;
    numIndices: number;
    params: Params;
    rotation: Rotation4D;
    calcRes: CalculusResources;
    viewShift: number;     
}

function draw(p: DrawParams) {
    const canvas = p.context.canvas as HTMLCanvasElement;
    const aspect = canvas.width / canvas.height;
    const projection = mat4.perspective(mat4.create(), Math.PI / 4, aspect, 0.1, 1000.0);
    if (p.viewShift !== 0) {
        // Shift after projection: x_ndc += viewShift
        mat4.multiply(projection, mat4.fromTranslation(mat4.create(), [p.viewShift, 0, 0]), projection);
    }
    const view = getViewMatrix(p.camera);
    const vp = mat4.multiply(mat4.create(), projection, view);

    const mvp = mat4.multiply(mat4.create(), vp, p.modelMat);
    const modelView = mat4.multiply(mat4.create(), view, p.modelMat);

    
    const [bx, by, bz] = sceneLayout(p.params).ranges;
    const renderUniforms = new Float32Array(24);
    renderUniforms.set(mvp as Float32Array, 0);
    renderUniforms.set([bx.min, by.min, bz.min, p.params.clipToBox ? 1 : 0], 16);
    renderUniforms.set([bx.max, by.max, bz.max, p.params.markNonHolomorphic && hasFormula(p.params.funcSelection) ? 1 : 0], 20);
    p.device.queue.writeBuffer(p.renderRes.uniformBuffer, 0, renderUniforms);

    const encoder = p.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: p.renderRes.textures.msaaTexture.createView(),
            resolveTarget: p.context.getCurrentTexture().createView(),
            clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
            loadOp: 'clear',
            storeOp: 'store',
        }],
        depthStencilAttachment: {
            view: p.renderRes.textures.depthTexture.createView(),
            depthClearValue: 1.0,
            depthLoadOp: 'clear',
            depthStoreOp: 'discard',
        },
    });

    
    drawAxes(p.device, pass, p.axesRes, {
        mvp, modelView, projection, canvas,
        params: p.params,
        rotation: p.rotation,
    });

    
    if (p.params.showContour && sceneLayout(p.params).graph) {
        drawContour(p.device, pass, p.calcRes, { mvp, modelView, projection, canvas, params: p.params, rotation: p.rotation });
    }

    
    if (p.params.showSurface) {
        pass.setPipeline(p.renderRes.pipeline);
        pass.setBindGroup(0, p.renderRes.uniformBindGroup);
        pass.setVertexBuffer(0, p.surfaceRes.vertexBuffer);
        pass.setIndexBuffer(p.indexRes.indexBuffer, 'uint32');
        pass.drawIndexed(p.numIndices);
    }

    pass.end();
    p.device.queue.submit([encoder.finish()]);
}



function showFatal(error: unknown) {
    const box = document.createElement('div');
    box.className = 'fatal';
    const message = error instanceof Error ? error.message : String(error);
    box.innerHTML = `
        <h1>WebGPU is not available</h1>
        <p>This visualizer renders with WebGPU. Please use a current Chromium-based browser
        (Chrome or Edge 113+), or Safari 18+. Firefox needs WebGPU enabled.</p>
        <p>On Linux, enable <code>chrome://flags/#enable-unsafe-webgpu</code> and
        <code>chrome://flags/#enable-vulkan</code>.</p>
        <p class="detail"></p>`;
    box.querySelector('.detail')!.textContent = `Details: ${message}`;
    document.body.appendChild(box);
}

async function run() {
    const { device, context, canvas, format } = await initDevice();

    // Lost device (driver reset, GPU removed): tell the user instead of freezing
    device.lost.then(info => { if (info.reason !== 'destroyed') showFatal(`GPU device lost: ${info.message}`); });

    // Canvas follows the window size (render targets are rebuilt in the frame loop)
    let sizeChanged = false;
    new ResizeObserver(() => { sizeChanged = true; }).observe(canvas);

    // Recompute the surface only when something it depends on changed
    let lastComputeKey: Float32Array | null = null;
    let forceCompute = true;
    const gui = createGuiController(canvas);

    let resolution = gui.params.resolution;
    let numIndices = 6 * (resolution - 1) * (resolution - 1);

    let renderRes  = await createRenderPipeline(device, canvas, format, MSAA_COUNT, 'triangle-list');
    // Bytecode of the typed expression, rewritten whenever the formula changes
    const programBuffer = device.createBuffer({
        size: PROGRAM_BUFFER_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    // Its parameter values (a, b, ...), rewritten when a slider moves
    const parameterBuffer = device.createBuffer({
        size: PARAMETER_BUFFER_SIZE,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const surfacePipeline = await createSurfaceShaderPipeline(device);
    const polePipeline = await createPoleHolePipeline(device);
    let surfaceRes = createComputeSurfaceResources(device, resolution, surfacePipeline, polePipeline, programBuffer, parameterBuffer);
    let indexRes   = await createComputeIndexPipeline(device, resolution);
    const axesRes  = await createAxes(device, format, MSAA_COUNT);
    const calcRes  = await createCalculus(device, format, MSAA_COUNT, programBuffer, parameterBuffer);

    const camera = createInteractiveCamera(canvas);
    const modelMat = mat4.create();

    // Performance readouts
    const startTime = performance.now();
    let lastFpsTime = startTime;
    let frameCount = 0;

    const perfData = {
        fps: 0,
        vertices: resolution * resolution,
        estimatedVRAM: estimateVRAM(resolution, MSAA_COUNT, canvas.width, canvas.height),
    };

    // Centre of the view follows the free area beside the panel (eased)
    let viewOffsetPx = gui.coveredWidth();

    const showPerformance = () => gui.updatePerformance({
        fps: perfData.fps,
        vertices: perfData.vertices,
        vram: perfData.estimatedVRAM,
    });
    showPerformance();

    const frame = async () => {
        // Rebuild GPU resources when the grid resolution changes
        if (gui.resolutionChanged) {
            resolution = gui.params.resolution;
            numIndices = 6 * (resolution - 1) * (resolution - 1);

            const oldSurface = surfaceRes;
            const oldIndex = indexRes;
            surfaceRes = createComputeSurfaceResources(device, resolution, surfacePipeline, polePipeline, programBuffer, parameterBuffer);
            indexRes   = await createComputeIndexPipeline(device, resolution);
            gui.resolutionChanged = false;
            forceCompute = true;

            // Free the old grid (the GPU finishes any work still using it first)
            oldSurface.vertexBuffer.destroy();
            oldSurface.paramsBuffer.destroy();
            oldIndex.indexBuffer.destroy();

            perfData.vertices = resolution * resolution;
            perfData.estimatedVRAM = estimateVRAM(resolution, MSAA_COUNT, canvas.width, canvas.height);
            showPerformance();

            requestAnimationFrame(frame);
            return;
        }

        // Rebuild the render pipeline when the primitive topology changes
        if (gui.topologyChanged) {
            renderRes = await createRenderPipeline(device, canvas, format, MSAA_COUNT, gui.params.topology);
            gui.topologyChanged = false;

            requestAnimationFrame(frame);
            return;
        }

        camera.tick();

        const currentTime = performance.now();
        const dt = (currentTime - startTime) / 1000;

        frameCount++;
        if (currentTime - lastFpsTime >= 1000) {
            perfData.fps = frameCount;
            showPerformance();
            frameCount = 0;
            lastFpsTime = currentTime;
        }

        const speed = gui.params.rotateSpeed;

        // 3D model rotation
        mat4.identity(modelMat);
        mat4.rotateX(modelMat, modelMat, Math.sin(dt * speed));
        mat4.rotateY(modelMat, modelMat, Math.cos(dt * speed));
        mat4.rotateY(modelMat, modelMat, Math.PI / 1.49);

        const domain = FUNCTIONS[Math.floor(gui.params.funcSelection)].domain;
        const domainCenter: [number, number] = [
            (domain.x[0] + domain.x[1]) / 2,
            (domain.z[0] + domain.z[1]) / 2,
        ];

        // Automatic 4D rotation driven by rotateSpeed
        const autoRot = {
            xw: dt * speed * 0.8,
            yw: dt * speed * 0.5,
            zw: dt * speed * 0.3,
        };

        // Same 4D rotation the compute shader applies, for the axes on the CPU
        const rotation: Rotation4D = {
            useQuaternion: gui.params.use_quaternion_rotation >= 0.5,
            xw: gui.params.rot_xw + autoRot.xw,
            yw: gui.params.rot_yw + autoRot.yw,
            zw: gui.params.rot_zw + autoRot.zw,
            quatAngleLeft: gui.params.quat_angle_left,
            quatAxisLeft: gui.params.quat_axis_left,
            quatAngleRight: gui.params.quat_angle_right,
            quatAxisRight: gui.params.quat_axis_right,
        };

        // New formula typed: upload its bytecode (takes effect this frame)
        if (gui.pendingProgram !== null) {
            device.queue.writeBuffer(programBuffer, 0, gui.pendingProgram);
            gui.pendingProgram = null;
            forceCompute = true;
        }
        if (gui.pendingParameterValues !== null) {
            device.queue.writeBuffer(parameterBuffer, 0, gui.pendingParameterValues);
            gui.pendingParameterValues = null;
            forceCompute = true;
        }

        // Window resized: new canvas size and render targets
        if (sizeChanged) {
            sizeChanged = false;
            const dpr = window.devicePixelRatio || 1;
            const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
            const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
            if (w !== canvas.width || h !== canvas.height) {
                canvas.width = w;
                canvas.height = h;
                renderRes.textures.depthTexture.destroy();
                renderRes.textures.msaaTexture.destroy();
                renderRes.textures = createFrameTextures(device, w, h, format, MSAA_COUNT);
                perfData.estimatedVRAM = estimateVRAM(resolution, MSAA_COUNT, w, h);
                showPerformance();
            }
        }

        const paramsData = buildParamsArray(gui.params, resolution, dt * gui.params.animateSpeed, domainCenter, autoRot);

        // Contour integral: evaluate f on the circle (async, throttled)
        if (gui.params.showContour && sceneLayout(gui.params).graph) {
            requestContourEvaluation(device, calcRes, gui.params, paramsData, (r, map) => gui.updateContour(r, map));
        }
        device.queue.writeBuffer(surfaceRes.paramsBuffer, 0, paramsData);

        // Compute pass: evaluate the surface, only if it is shown and its inputs
        // changed. Time only counts when the formula uses t.
        const usesTime = gui.formulaUsesTime && (Number(gui.params.funcSelection) === CUSTOM_FUNCTION_INDEX || needsDerivatives(gui.params));
        const computeKey = paramsData.slice();
        if (!usesTime) computeKey[3] = 0;
        const changed = forceCompute || !lastComputeKey || computeKey.some((v, i) => v !== lastComputeKey![i]);
        if (gui.params.showSurface && changed) {
            lastComputeKey = computeKey;
            forceCompute = false;
            const encoder = device.createCommandEncoder();
            const computePass = encoder.beginComputePass();
            computePass.setPipeline(surfaceRes.pipeline);
            computePass.setBindGroup(0, surfaceRes.bindGroup);
            computePass.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
            // Second dispatch sees the first one's writes (each dispatch is its own usage scope)
            computePass.setPipeline(surfaceRes.polePipeline);
            computePass.setBindGroup(0, surfaceRes.poleBindGroup);
            computePass.dispatchWorkgroups(Math.ceil(resolution / 8), Math.ceil(resolution / 8));
            computePass.end();
            device.queue.submit([encoder.finish()]);
        }

        viewOffsetPx += (gui.coveredWidth() - viewOffsetPx) * 0.2;

        draw({
            viewShift: viewOffsetPx / Math.max(canvas.clientWidth, 1),
            calcRes,
            device, context, renderRes, surfaceRes, indexRes,
            axesRes, camera, modelMat, numIndices,
            params: gui.params,
            rotation,
        });

        requestAnimationFrame(frame);
    };

    frame();
}

run().catch(showFatal);
