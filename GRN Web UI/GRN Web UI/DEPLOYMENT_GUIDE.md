# Deployment Guide for GRN Web UI (Kolkata & AHM)

This guide explains how to deploy the Kolkata and AHM versions of the GRN Web UI as separate static sites on Render.

## Overview

The GRN Web UI has been split into two separate deployments:
- **Kolkata UI** - Automatically connects to KOL database
- **AHM UI** - Automatically connects to AHM database

Each can be deployed independently as a static site on Render.

---

## Option 1: Deploy from Subdirectories (Single Repository)

If you want to keep both UIs in the same repository but deploy them separately:

### Step 1: Push to GitHub

1. Commit all changes:
```bash
git add .
git commit -m "Add separate Kolkata and AHM UI deployments"
git push origin main
```

### Step 2: Deploy Kolkata UI on Render

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New +** → **Static Site**
3. Connect your GitHub repository
4. Configure the site:
   - **Name**: `grn-ui-kolkata` (or your preferred name)
   - **Branch**: `main`
   - **Root Directory**: `GRN Web UI/kolkata`
   - **Build Command**: Leave empty or use `echo "No build required"`
   - **Publish Directory**: `.` (dot means current directory)
5. Click **Create Static Site**

### Step 3: Deploy AHM UI on Render

1. Click **New +** → **Static Site** again
2. Connect the same GitHub repository
3. Configure the site:
   - **Name**: `grn-ui-ahm` (or your preferred name)
   - **Branch**: `main`
   - **Root Directory**: `GRN Web UI/ahm`
   - **Build Command**: Leave empty or use `echo "No build required"`
   - **Publish Directory**: `.` (dot means current directory)
5. Click **Create Static Site**

---

## Option 2: Deploy from Separate Repositories

If you prefer to have completely separate repositories:

### Step 1: Create Kolkata Repository

```bash
# Create a new directory for Kolkata
mkdir grn-ui-kolkata
cd grn-ui-kolkata

# Copy Kolkata files
cp -r "../CDC Site/GRN Web UI/kolkata/"* .

# Initialize git
git init
git add .
git commit -m "Initial commit - Kolkata GRN UI"

# Create GitHub repository and push
# (Create repository on GitHub first, then:)
git remote add origin https://github.com/YOUR_USERNAME/grn-ui-kolkata.git
git branch -M main
git push -u origin main
```

### Step 2: Create AHM Repository

```bash
# Create a new directory for AHM
mkdir grn-ui-ahm
cd grn-ui-ahm

# Copy AHM files
cp -r "../CDC Site/GRN Web UI/ahm/"* .

# Initialize git
git init
git add .
git commit -m "Initial commit - AHM GRN UI"

# Create GitHub repository and push
# (Create repository on GitHub first, then:)
git remote add origin https://github.com/YOUR_USERNAME/grn-ui-ahm.git
git branch -M main
git push -u origin main
```

### Step 3: Deploy on Render

For each repository:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **New +** → **Static Site**
3. Connect the respective GitHub repository
4. Configure:
   - **Build Command**: Leave empty
   - **Publish Directory**: `.`
5. Click **Create Static Site**

---

## Post-Deployment

### URLs

After deployment, you'll receive URLs like:
- Kolkata: `https://grn-ui-kolkata.onrender.com`
- AHM: `https://grn-ui-ahm.onrender.com`

### Custom Domains (Optional)

If you want custom domains:

1. Go to your static site settings in Render
2. Click **Custom Domain**
3. Add your domain (e.g., `kolkata.grn.yourcompany.com`)
4. Follow the DNS configuration instructions

### Environment Configuration

The API endpoint is currently set to:
```javascript
const DEFAULT_API_BASE = 'https://cdcapi.onrender.com/api/';
```

If you need to change it, update the `script.js` file in each deployment.

---

## Updating Deployments

### Auto-Deploy (Recommended)

Render automatically deploys when you push to the connected branch:

```bash
# Make changes to files
git add .
git commit -m "Update UI"
git push origin main
# Render will auto-deploy
```

### Manual Deploy

1. Go to your Render dashboard
2. Select the static site
3. Click **Manual Deploy** → **Deploy latest commit**

---

## Troubleshooting

### Site shows blank page

1. Check that the Publish Directory is set to `.`
2. Verify that `index.html` exists in the root
3. Check browser console for JavaScript errors

### API calls failing

1. Verify the API endpoint in `script.js`
2. Check CORS settings on your backend
3. Ensure the backend is running

### 404 errors on navigation

Make sure the `render.yaml` rewrite rules are in place, or configure in Render dashboard:
- Redirects/Rewrites → Add rule
- Source: `/*`
- Destination: `/index.html`

---

## Files Structure

### Kolkata Deployment
```
GRN Web UI/kolkata/
├── index.html
├── script.js (FIXED_DATABASE = 'KOL')
├── styles.css
├── package.json
├── render.yaml
├── .gitignore
└── README.md
```

### AHM Deployment
```
GRN Web UI/ahm/
├── index.html
├── script.js (FIXED_DATABASE = 'AHM')
├── styles.css
├── package.json
├── render.yaml
├── .gitignore
└── README.md
```

---

## Support

For issues or questions:
1. Check Render logs in the dashboard
2. Review browser console for client-side errors
3. Verify backend API is accessible

---

## Quick Reference Commands

```bash
# Test locally
cd "GRN Web UI/kolkata"
python3 -m http.server 8080

# Commit and push changes
git add .
git commit -m "Update"
git push origin main

# View logs on Render
# Go to Dashboard → Select Site → Logs
```

