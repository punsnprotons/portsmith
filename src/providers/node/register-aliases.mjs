import { register } from 'node:module';
register('./alias-loader.mjs', import.meta.url, { data: { root: process.cwd() } });
