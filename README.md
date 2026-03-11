# 🧵 Filament Vault — Setup Instructions

## What This Is
A fully offline Progressive Web App (PWA) for tracking your 3D printing filament inventory. No App Store, no account, no internet required after first load.

---

## 📱 How to Install on iPhone (Safari)

### Step 1 — Host the files
You need to serve the files over HTTPS. Options:
- **Local network (recommended):** Use a simple HTTPS server on your computer.
- **Free hosting:** Upload to GitHub Pages, Netlify, or any static host.
- **Local IP trick:** On a Mac, run: `npx serve . --ssl` in the project folder.

### Step 2 — Open in Safari on iPhone
Navigate to the URL where you're hosting the files. **Must use Safari** (not Chrome).

### Step 3 — Add to Home Screen
1. Tap the **Share** button (square with arrow pointing up) at the bottom of Safari
2. Scroll down and tap **"Add to Home Screen"**
3. Give it a name (e.g. "FilaVault") and tap **Add**

### Step 4 — Launch from Home Screen
Tap the FilaVault icon on your home screen. It will open full-screen, just like a native app, with no browser UI.

---

## 🖥️ Quick Local Server (for testing)

### Using Python (no install needed):
```bash
cd filament-tracker
python3 -m http.server 8080
```
Then open `http://localhost:8080` on your computer.

> **Note:** For iPhone "Add to Home Screen" to work with full PWA features, you need HTTPS. Use a tool like `ngrok` to expose your local server, or deploy to GitHub Pages.

### Using npx serve with SSL:
```bash
npx serve . --ssl
```

---

## 📂 File Structure
```
filament-tracker/
├── index.html          ← Main app shell
├── app.js              ← All application logic
├── styles.css          ← All styles
├── manifest.json       ← PWA manifest
├── sw.js               ← Service Worker (offline cache)
├── icons/
│   ├── icon-192.png    ← Home screen icon
│   └── icon-512.png    ← Splash screen icon
└── README.md           ← This file
```

---

## 🔧 Features

| Feature | Details |
|---------|---------|
| **Inventory** | Add/edit/delete filaments with name, brand, material, color, qty, min stock, buy link |
| **QR Codes** | Generate QR codes per filament; download as PNG for printing |
| **QR Scanning** | Scan printed QR codes with your camera to quickly find & update a filament |
| **Low Stock Alerts** | Toast notifications when qty hits minimum; tap to open buy link |
| **Quick Adjust** | Tap "Adjust" on any card to increment/decrement qty inline |
| **Offline** | Works 100% offline after first visit via Service Worker cache |
| **Data Storage** | All data stored in IndexedDB — stays on your device |

---

## 📌 Notes
- Data is stored locally on the device. Uninstalling/clearing Safari data will erase it.
- The QR scanner requires camera permission — grant it when prompted.
- External libraries (QRCode.js, html5-qrcode) are cached after the first online visit.
