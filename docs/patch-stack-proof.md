# Patch stack reproducibility proof

Run `scripts/prove-patches.ps1` (read-only on C:\chromium\src; scratch repo in %TEMP%\orbis-patch-proof).
It copies the pristine HEAD blobs of every file that differs in the tree or is touched by a patch, re-materialises them with the tree's
core.autocrlf and .gitattributes, runs `scripts/apply-chromium-patches.ps1` (sync-orbis-panel, patches by name, pages-final, uncaptured) and SHA-256 compares
every file with the working tree. `-Regenerate` rebuilds `patches/chromium-orbis-uncaptured.patch`.

## Results (Chromium 154.0.8037.44 tree, 2026-09-21)

- Working-tree files differing from HEAD (excluding out/): 210 (177 modified/added tracked + untracked expanded: orbis resources, orbis_tokens.h, Inter fonts). 206 exist in HEAD, 4 are new files.
- Before fixes: the 20 existing patches + sync applied cleanly in order (0 failures) but only 176 of 210 files matched byte for byte; 34 differed. Files lost on reset: 34 (no patch carried them).
- Causes of the 34: content edits made in the tree that no patch carried (string branding in ash/ios/android/remoting .grd/.grdp, tooltip_view_aura.cc, text_defaults_md.css, and others), plus files whose tree copy has different line endings than a fresh checkout gives (e.g. ui_features.cc, external_provider_impl.cc are CRLF in the tree though `eol=lf`; BRANDING is LF where a checkout gives CRLF).
- Fix: `patches/chromium-orbis-uncaptured.patch` (34 files, `git diff --binary`, raw bytes, applied last, with core.autocrlf=false). The apply script orders it after chromium-orbis-pages-final.patch, adds `-Exclude`, and the whole-stack idempotence check now keys off the last patch.
- After fixes: MATCH 210 / 210, DIFFER 0, LOST 0. Re-running apply on an already-patched tree reports "already applied: whole stack".
- Note: existing patches must be applied with default autocrlf (they fail with autocrlf=false), the uncaptured patch the opposite; the script handles both.
- If the tree changes again, run `scripts/prove-patches.ps1 -Regenerate` and commit the regenerated uncaptured patch.
