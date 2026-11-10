// Makes the app icon files from the Roost brand kit (assets/brand) and draws the menu bar icons.
// Run: npx electron scripts/make-icons.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const brand = path.join(root, 'assets', 'brand');

// The Roost glyph (a house with chat bubbles) in black, for the macOS menu bar ("Template" image).
const trayHtml = (size) => `<html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <path d="M10 46 L50 12 L90 46" fill="none" stroke="#000" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M20 40 V82 a6 6 0 0 0 6 6 H74 a6 6 0 0 0 6 -6 V40" fill="none" stroke="#000" stroke-width="9" stroke-linejoin="round"/>
  <rect x="31" y="52" width="16" height="12" rx="3" fill="#000"/><rect x="53" y="52" width="16" height="12" rx="3" fill="#000"/>
</svg></body></html>`;

async function render(html, size) {
  const w = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  w.webContents.setFrameRate(1);
  await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  w.destroy();
  return img.resize({ width: size, height: size, quality: 'best' });
}

app.on('window-all-closed', () => {}); // keep running between renders
app.whenReady().then(async () => {
  const big = nativeImage.createFromPath(path.join(brand, 'Roost-1024.png'));
  fs.copyFileSync(path.join(brand, 'Roost.icns'), path.join(root, 'build', 'icon.icns'));
  fs.writeFileSync(path.join(root, 'build', 'icon.png'), big.toPNG());
  fs.writeFileSync(path.join(root, 'src', 'assets', 'icon.png'), big.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(root, 'src', 'assets', 'tray.png'), big.resize({ width: 32, height: 32, quality: 'best' }).toPNG());

  const trayBig = await render(trayHtml(360), 360);
  fs.writeFileSync(path.join(root, 'src', 'assets', 'trayTemplate.png'), trayBig.resize({ width: 18, height: 18, quality: 'best' }).toPNG());
  fs.writeFileSync(path.join(root, 'src', 'assets', 'trayTemplate@2x.png'), trayBig.resize({ width: 36, height: 36, quality: 'best' }).toPNG());
  console.log('icons written');
  app.quit();
});
