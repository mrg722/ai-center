import nextVitals from 'eslint-config-next/core-web-vitals.js';
import nextTs from 'eslint-config-next/typescript.js';
import { globalIgnores } from 'eslint/config';

export default [
  nextVitals,
  nextTs,
  globalIgnores(['.next/**','node_modules/**','dist/**','coverage/**','.data/**']),
];
