# TTML Editor (Android)

A phone app for editing word-synced lyrics (TTML) by hand: the same editor as the review cell of the TTML lyrics
generator, in a native shell. **No alignment engine inside**: you open a lyrics project (or an existing `.ttml`), the
song, and fix the timing yourself. The app is a full-screen WebView around one HTML page (`web/editor.html`), written in
plain Java with no libraries.

## What it does
- Words are blocks on a timeline: drag to move, drag an edge to resize, split / merge / add / delete, undo and redo.
- **Sync pad** (the *Sync* button): tap **START** at each word and **END** when it stops. With *keeps going* ticked, the
  last word of a line stays going while you start the line below; **END** closes it. Overlapping words stack in
  their own row instead of being cut.
- **Backing vocals made easy**: write the line with `(brackets)` in *Line text* and press *Apply text* (unchanged words
  keep their timing), or type the words in *Add backing* and press *Add*.
- **Languages** (needs internet): generate **pronunciation** per word and **translations** per line, then edit any of them by hand.
  They are saved in the TTML in Apple's `<iTunesMetadata>` layout (translations, transliterations).
- Export word-timed or line-timed TTML, or the project `.json`, to `Downloads/TTML Editor/`.
- Your work is autosaved on the phone and comes back when you reopen the app.

## Get the APK (no Android Studio needed)

### From a phone, in two uploads
1. On github.com (browser; "Desktop site" is easiest) create a new **empty** repository.
2. **Upload the zip first.** In the empty repository choose *uploading an existing file*, pick `TTML-Editor-upload.zip`
   (do not unzip it), and *Commit changes*. Nothing runs yet.
3. **Then add the workflow.** *Add file > Create new file*, type the name `.github/workflows/build-apk.yml` (typing the
   slashes makes the folders), paste the contents of `build-apk.yml`, and *Commit changes*.
4. That commit starts **Build APK** in the **Actions** tab. It unpacks the zip into the repository's files, commits them, and
   builds the APK (about 3 to 6 minutes).
5. Open the finished run and download **TTML-Editor-apk** at the bottom (a zip with `TTML-Editor.apk`), copy it to the phone and open it.
   Allow "install unknown apps" for your browser or file manager when Android asks.

### From a computer
Push this folder: `git init && git add . && git commit -m "TTML editor" && git branch -M main`,
`git remote add origin https://github.com/<you>/<repo>.git`, `git push -u origin main`. The workflow builds on every push.

**Releases (a direct download link):** `git tag v1.1.0 && git push --tags`. The workflow attaches `TTML-Editor.apk` to a
GitHub Release. **Updating:** every build is signed with the same key and has a higher version code, so a new APK installs over the old one and keeps your autosaved work.

Requires Android 10 or newer (API 29).

## Using it with the generator
1. In the Colab notebook, run the review cell's **Export > Save project (.json)**, or just download the `.ttml` the notebook made.
2. Open the app, tap **Open audio** (the song), then **Open lyrics** (the project `.json` or the `.ttml`).
3. Fix words, optionally add pronunciation and translations (**Languages**), then **Export > Download TTML**.

## Updating the editor page
`web/editor.html` and `web/core.js` are copies of `ttmlgen/editor/` from the generator project. After changing the
editor there, copy both files here, then:
```
python tools/build_assets.py     # inlines core.js into app/src/main/assets/index.html
python tools/check_web.py        # JavaScript syntax check (needs node)
```
The workflow runs both steps itself, so pushing the two copied files is enough.

## Notes
- **Signing key.** `app/ttml-editor.p12` is a throwaway key for personal use, committed so builds stay updatable. Anyone
  with the repo can sign an APK with it, so do not treat it as a secret. For your own key, add the repository secrets
  `TTML_KEYSTORE_PATH` (path inside the repo), `TTML_KEYSTORE_PASSWORD`, `TTML_KEY_ALIAS`, `TTML_KEY_PASSWORD`.
  A different key means uninstalling the old app first.
- **Network.** The only permission is `INTERNET`, used by the Languages panel. Requests go through the app to
  `translate.googleapis.com` only; the page itself cannot reach other sites. That is Google Translate's public web
  endpoint, which is unofficial: it can change, limit or refuse requests. Translations are a first draft.
- **Not tested on a device.** The page is tested in a headless browser (including the phone layout and the app bridges
  with mocks); the Android shell and the GitHub build could not be run where this was written. If the first workflow run fails, open its log and send me the error.
- Pronunciation / translation ideas follow the Composer lyrics editor (AGPL-3.0); no code was copied.
