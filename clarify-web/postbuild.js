const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const standaloneDir = path.join(__dirname, '.next', 'standalone');

// 1. Copy static assets into standalone/.next/static (< 1 second)
const staticSrc = path.join(__dirname, '.next', 'static');
const staticDest = path.join(standaloneDir, '.next', 'static');
if (fs.existsSync(staticSrc)) {
  fs.cpSync(staticSrc, staticDest, { recursive: true });
}

// 2. Copy public directory into standalone/public (< 1 second)
const publicSrc = path.join(__dirname, 'public');
const publicDest = path.join(standaloneDir, 'public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
}

// 3. Cleanly install production dependencies inside standalone (~10-15 seconds)
const standaloneNodeModules = path.join(standaloneDir, 'node_modules');
if (!fs.existsSync(standaloneNodeModules)) {
  console.log('Installing production dependencies into standalone build...');
  execSync('npm install --omit=dev --no-audit --no-fund', {
    cwd: standaloneDir,
    stdio: 'inherit',
  });
}

console.log('✓ Standalone build packaged successfully.');