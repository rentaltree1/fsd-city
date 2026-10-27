# FSD City

A three.js driving game: a Model Y and a Cybertruck with Full Self-Driving (Supervised), a whole city
of traffic, Smart Summon, and an 8-camera view. It's a static site: `index.html` plus the `js/` folder,
no build step.

## Run it on your own computer

Any static file server works, for example (with Python installed):

    python -m http.server 8000

then open http://localhost:8000. (Opening index.html by double-clicking won't work: browsers block
JavaScript modules loaded from files.)

## Put it on GitHub (no Git install needed)

1. Sign in at https://github.com (or create a free account).
2. Click **+** (top right) → **New repository**. Name it `fsd-city`, leave it **Public**, don't add a
   README (this one is included), click **Create repository**.
3. On the empty repository page click **uploading an existing file**.
4. Drag in `index.html`, `README.md`, `render.yaml` **and the whole `js` folder** (drag the folder
   itself so the files land in `js/`). Skip `.claude` and `tests`, which are only for development.
5. Type a message such as "First version" and click **Commit changes**.
6. Check the file list shows `index.html` at the top level and a `js` folder with 17 files.

## Host it on Render

1. Go to https://render.com and click **Get Started**. Sign up **with GitHub**, so Render can see
   your repositories.
2. Click **New +** → **Static Site**.
3. Pick the `fsd-city` repository (click **Configure account** if it isn't listed, and allow access).
4. Settings:
   - **Name:** fsd-city (this becomes part of the address)
   - **Branch:** main
   - **Build Command:** leave empty
   - **Publish Directory:** `.` (a single dot)
5. Click **Create Static Site**. After a minute or two the site is live at
   `https://fsd-city.onrender.com` (or similar, shown at the top of the page).

Static sites on Render are free and don't go to sleep.

## Updating later

Upload the changed files to the GitHub repository again (**Add file** → **Upload files**; files with
the same name are replaced) and commit. Render redeploys automatically within a minute or two.
