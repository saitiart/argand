import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    plugins: [
        {
            name: 'wgsl',
            transform(code, id) {
                if (id.endsWith('.wgsl')) {
                    return `export default ${JSON.stringify(code)};`;
                }
            }
        }
    ],
    define: {
        global: 'globalThis',
    },
    optimizeDeps: {
        esbuildOptions: {
            define: {
                global: 'globalThis',
            },
        },
    },
    server: {
        port: 3000
    }
});
