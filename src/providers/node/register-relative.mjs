import { register } from 'node:module';
register('./relative-loader.mjs', import.meta.url, { data: { root: process.cwd() } });
