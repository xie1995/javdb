import { build } from 'vite';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const distDir = resolve(root, 'dist');

async function copyDir(src: string, dest: string): Promise<void> {
    if (!existsSync(src)) return;
    if (!existsSync(dest)) {
        mkdirSync(dest, { recursive: true });
    }
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = resolve(src, entry.name);
        const destPath = resolve(dest, entry.name);
        if (entry.isDirectory()) {
            await copyDir(srcPath, destPath);
        } else {
            copyFileSync(srcPath, destPath);
        }
    }
}

async function main() {
    console.log('Starting dev build (dist only, no zip)...');

    // 1. Vite build
    await build();
    console.log('Vite build finished successfully.');

    // 2. Copy Font Awesome
    const fontawesomeSrc = resolve(root, 'src/assets/fontawesome');
    const fontawesomeDest = resolve(distDir, 'assets/fontawesome');
    if (existsSync(fontawesomeSrc)) {
        await copyDir(fontawesomeSrc, fontawesomeDest);
        console.log(`Copied Font Awesome -> ${fontawesomeDest}`);
    }

    // 3. Copy g2plot.min.js
    const distTemplatesDir = resolve(distDir, 'assets/templates');
    if (!existsSync(distTemplatesDir)) {
        mkdirSync(distTemplatesDir, { recursive: true });
    }
    const g2plotDestPath = resolve(distTemplatesDir, 'g2plot.min.js');
    const g2plotCandidates = [
        resolve(root, 'src/assets/templates/g2plot.min.js'),
        resolve(root, 'public/assets/templates/g2plot.min.js'),
        resolve(root, 'node_modules/@antv/g2plot/dist/g2plot.min.js'),
    ];
    for (const p of g2plotCandidates) {
        if (existsSync(p)) {
            copyFileSync(p, g2plotDestPath);
            console.log(`Copied g2plot.min.js from ${p}`);
            break;
        }
    }

    console.log('\nDev build completed. Extension files are ready in dist/.');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
