#!/bin/sh
# Publish Magic Keys to GitHub Pages: https://anaya33.github.io/magic-keys/
#
# Builds the site for the /magic-keys/ sub-folder and force-pushes the finished
# files to the gh-pages branch, which GitHub Pages serves as-is.
# Pushes as the GitHub CLI's active account (gh auth status), never an SSH key.
set -e
cd "$(dirname "$0")/.."

REMOTE="$(git remote get-url origin)"
BASE_PATH=/magic-keys/ npm run build

cd dist
touch .nojekyll                     # serve files exactly as built (no Jekyll processing)
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name)" -c user.email="$(git -C .. config user.email)" \
  commit -q -m "Deploy $(git -C .. rev-parse --short HEAD)"
git -c credential.helper= -c "credential.helper=!gh auth git-credential" push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Published: https://anaya33.github.io/magic-keys/"
