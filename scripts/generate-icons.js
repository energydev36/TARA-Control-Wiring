const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const input = path.join(__dirname, '..', 'public', 'logo.png');
const outDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 72, 96, 128, 144, 152, 180, 192, 256, 384, 512];

(async () => {
  try {
    for (const size of sizes) {
      const out = path.join(outDir, `icon-${size}x${size}.png`);
      await sharp(input).resize(size, size, { fit: 'contain' }).png().toFile(out);
      console.log('Written', out);
    }
    // also write a favicon.ico (simple approach: use 48x48)
    const icoOut = path.join(outDir, 'favicon.ico');
    await sharp(input).resize(48, 48).png().toFile(path.join(outDir, 'favicon-48.png'));
    // create ico from multiple sizes if sharp supports -- we'll just use single size ico for compatibility
    await sharp(path.join(outDir, 'favicon-48.png')).toFile(icoOut);
    console.log('Written', icoOut);
    console.log('All icons generated to', outDir);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
