import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals,...nextTs,globalIgnores(['.next/**','public/audio-worklet.js','next-env.d.ts']),{rules:{'react-hooks/set-state-in-effect':'off','react-hooks/refs':'off'}}]);
