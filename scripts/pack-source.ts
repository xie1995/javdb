import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dest = resolve('C:\\Users\\Administrator\\Desktop\\JavdBviewed-main-source.zip');

const exclude = ['node_modules', 'dist-zip', '.git', 'dist'];

async function main() {
    if (fs.existsSync(dest)) fs.removeSync(dest);

    const output = fs.createWriteStream(dest);
    const archive = archiver('zip', { zlib: { level: 9 } });

    await new Promise<void>((res, rej) => {
        output.on('close', res);
        archive.on('error', rej);
        archive.pipe(output);

        archive.glob('**/*', {
            cwd: root,
            ignore: exclude.map(d => `${d}/**`).concat(exclude),
        });

        archive.finalize();
    });

    const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
    console.log(`Done: ${dest} (${sizeMB} MB)`);
}

main().catch(e => { console.error(e); process.exit(1); });
