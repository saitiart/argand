/// <reference types="vite/client" />

// .wgsl files are turned into `export default "<source>"` by the plugin in vite.config.ts
declare module '*.wgsl' {
    const source: string;
    export default source;
}

// 3d-view-controls ships without type definitions
declare module '3d-view-controls';
