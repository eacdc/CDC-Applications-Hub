# Deploy Kolkata and AHM UIs to GitHub and Render

## Step 1: Push Kolkata UI to GitHub

Open PowerShell/Command Prompt and run these commands:

```powershell
# Navigate to Kolkata folder
cd "C:\Users\User\Desktop\CDC Site\GRN Web UI\kolkata"

# Initialize git repository
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - Kolkata GRN UI"

# Add remote repository
git remote add origin https://github.com/eacdc/grn-ui-kolkata.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

---

## Step 2: Push AHM UI to GitHub

```powershell
# Navigate to AHM folder
cd "C:\Users\User\Desktop\CDC Site\GRN Web UI\ahm"

# Initialize git repository
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - AHM GRN UI"

# Add remote repository
git remote add origin https://github.com/eacdc/grn-ui-ahm.git

# Rename branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

---

## Step 3: Deploy Kolkata UI on Render

1. Go to **[Render Dashboard](https://dashboard.render.com/)**

2. Click **"New +"** button → Select **"Static Site"**

3. Click **"Connect a repository"** or **"Configure account"** if first time

4. Find and select **"grn-ui-kolkata"** repository

5. Configure the deployment:
   ```
   Name:              grn-ui-kolkata
   Branch:            main
   Root Directory:    (leave empty)
   Build Command:     (leave empty)
   Publish Directory: .
   ```

6. Click **"Create Static Site"**

7. Wait for deployment to complete (usually 1-2 minutes)

8. Your Kolkata UI will be live at: `https://grn-ui-kolkata.onrender.com`

---

## Step 4: Deploy AHM UI on Render

1. Go back to **[Render Dashboard](https://dashboard.render.com/)**

2. Click **"New +"** button → Select **"Static Site"**

3. Find and select **"grn-ui-ahm"** repository

4. Configure the deployment:
   ```
   Name:              grn-ui-ahm
   Branch:            main
   Root Directory:    (leave empty)
   Build Command:     (leave empty)
   Publish Directory: .
   ```

5. Click **"Create Static Site"**

6. Wait for deployment to complete

7. Your AHM UI will be live at: `https://grn-ui-ahm.onrender.com`

---

## Verification

After deployment, test both sites:

### Kolkata Site
- URL: `https://grn-ui-kolkata.onrender.com`
- Should show "GRN Web UI - Kolkata" in header
- Login with username only
- Should connect to KOL database automatically

### AHM Site
- URL: `https://grn-ui-ahm.onrender.com`
- Should show "GRN Web UI - AHM" in header
- Login with username only
- Should connect to AHM database automatically

---

## Future Updates

Whenever you need to update the UIs:

### Update Kolkata:
```powershell
cd "C:\Users\User\Desktop\CDC Site\GRN Web UI\kolkata"
git add .
git commit -m "Update Kolkata UI"
git push origin main
```
Render will automatically redeploy!

### Update AHM:
```powershell
cd "C:\Users\User\Desktop\CDC Site\GRN Web UI\ahm"
git add .
git commit -m "Update AHM UI"
git push origin main
```
Render will automatically redeploy!

---

## Troubleshooting

### Git Authentication Issues

If you get authentication errors, you may need a Personal Access Token:

1. Go to GitHub → Settings → Developer settings → Personal access tokens
2. Generate new token (classic)
3. Select scopes: `repo` (all)
4. Copy the token
5. Use it as your password when pushing

Or configure Git credential helper:
```powershell
git config --global credential.helper wincred
```

### Render Deployment Issues

**Problem: Blank page**
- Solution: Check that "Publish Directory" is set to `.` (dot)

**Problem: 404 errors**
- Solution: In Render dashboard → Settings → Redirects/Rewrites:
  - Add: `/*` → `/index.html`

**Problem: API calls failing**
- Solution: Check browser console, verify API endpoint in script.js

---

## Quick Reference

| Item | Kolkata | AHM |
|------|---------|-----|
| GitHub Repo | https://github.com/eacdc/grn-ui-kolkata.git | https://github.com/eacdc/grn-ui-ahm.git |
| Database | KOL | AHM |
| Header Text | "GRN Web UI - Kolkata" | "GRN Web UI - AHM" |
| LocalStorage Keys | `grn_session_kol`, `grn_challan_kol` | `grn_session_ahm`, `grn_challan_ahm` |

---

## Need Help?

- GitHub docs: https://docs.github.com
- Render docs: https://docs.render.com
- Git basics: https://git-scm.com/doc

