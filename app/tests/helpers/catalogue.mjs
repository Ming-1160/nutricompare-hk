// The full catalogue, built the same way as the site does, for tests that need real products.
import { readFileSync } from 'node:fs';
import { DATA_FILES, assembleDataset } from '../../data-loader.mjs?v=111';

const dataDirectory = new URL('../../data/', import.meta.url);
export const dataFiles = new Map(DATA_FILES.map(name => [name, JSON.parse(readFileSync(new URL(name, dataDirectory), 'utf8'))]));
export const dataset = assembleDataset(dataFiles).dataset;
export const products = dataset.products;
export const byId = id => products.find(product => product.id === id);
