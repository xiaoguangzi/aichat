import { build } from 'esbuild';
await build({ entryPoints: ['src/lib/artifact-runtime.tsx'], outfile: 'public/artifact-runtime.js', bundle: true, format: 'iife', minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
