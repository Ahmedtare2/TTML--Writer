package app.ttmleditor;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * The whole app: a full-screen WebView showing the bundled editor page (assets/index.html), plus three things a
 * WebView does not do by itself: a file chooser that shows every file type, saving exports to Downloads, and
 * serving the page from an https origin so the editor's autosave (localStorage) is reliable.
 * No engine: every edit happens in the page.  The only network use is the optional Languages panel (translation and
 * pronunciation), which asks Google Translate's public endpoint through {@link Bridge#fetchText}; that bridge refuses
 * every other host, and the WebView itself still cannot reach the internet.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.local";
    private static final int REQ_FILE = 1;
    private static final String SAVE_DIR = "TTML Editor";
    private static final String TRANSLATE_HOST = "translate.googleapis.com";

    private WebView web;
    private ValueCallback<Uri[]> pendingChooser;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);   // you are listening and editing
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                       // autosave of your work
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new ChooserClient());
        web.loadUrl("https://" + HOST + "/index.html");
    }

    // ------------------------------------------------------------------ serve bundled assets
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String scheme = u.getScheme();
            if (!"http".equals(scheme) && !"https".equals(scheme)) {
                return null;                                 // blob:, data: ... are handled by the WebView itself
            }
            if (!HOST.equals(u.getHost())) {
                return blocked(403, "Forbidden");            // the page itself never talks to the internet
            }
            String path = u.getPath();
            if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
            try {
                InputStream in = getAssets().open(path.substring(1));
                WebResourceResponse r = new WebResourceResponse(mimeOf(path), "utf-8", in);
                return r;
            } catch (IOException e) {
                return blocked(404, "Not Found");
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true;                                     // no navigation away from the editor
        }
    }

    private static WebResourceResponse blocked(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<String, String>(),
                new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    // ------------------------------------------------------------------ file chooser (project / audio)
    private class ChooserClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingChooser != null) pendingChooser.onReceiveValue(null);
            pendingChooser = callback;
            Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            String[] types = mimeTypes(params.getAcceptTypes());
            if (types.length == 0) {
                i.setType("*/*");
            } else if (types.length == 1) {
                i.setType(types[0]);
            } else {
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, types);
            }
            try {
                startActivityForResult(i, REQ_FILE);
            } catch (Exception e) {
                pendingChooser = null;
                callback.onReceiveValue(null);
                return false;
            }
            return true;
        }
    }

    /** MIME types from an <input accept>; any file-extension entry (".json", ".ttml") means "show everything",
     *  because Android has no MIME type for .ttml and would grey those files out. */
    static String[] mimeTypes(String[] accept) {
        List<String> out = new ArrayList<>();
        if (accept == null) return new String[0];
        for (String entry : accept) {
            if (entry == null) continue;
            for (String t : entry.split(",")) {
                t = t.trim();
                if (t.isEmpty()) continue;
                if (t.startsWith(".") || !t.contains("/")) return new String[0];
                out.add(t);
            }
        }
        return out.toArray(new String[0]);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (pendingChooser != null) {
                Uri[] result = null;
                if (resultCode == RESULT_OK && data != null) {
                    result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                }
                pendingChooser.onReceiveValue(result);
                pendingChooser = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------------------------------------------ saving exports
    /** Called from the page as AndroidApp.saveFile(name, mime, text). */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String text) {
            final String clean = safeName(name);
            // Android appends an extension that matches the MIME type; .ttml has none, so use a neutral type
            final String type = clean.toLowerCase().endsWith(".ttml") || mime == null || mime.isEmpty()
                    ? "application/octet-stream" : mime;
            String msg;
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, clean);
                v.put(MediaStore.Downloads.MIME_TYPE, type);
                v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + SAVE_DIR);
                v.put(MediaStore.Downloads.IS_PENDING, 1);
                ContentResolver cr = getContentResolver();
                Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IOException("the system refused to create the file");
                try (OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IOException("could not open the file for writing");
                    out.write(text.getBytes(StandardCharsets.UTF_8));
                }
                ContentValues done = new ContentValues();
                done.put(MediaStore.Downloads.IS_PENDING, 0);
                cr.update(uri, done, null, null);
                msg = "Saved to Downloads/" + SAVE_DIR + "/" + clean;
            } catch (Exception e) {
                msg = "Could not save " + clean + ": " + e.getMessage();
            }
            final String toast = msg;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, toast, Toast.LENGTH_LONG).show();
                }
            });
        }

        /** Called from the page as AndroidApp.fetchText(id, url); the answer comes back through window.__nativeFetchDone. */
        @JavascriptInterface
        public void fetchText(int id, String url) {
            fetch(id, url);
        }
    }

    // ------------------------------------------------------------------ translation requests (Languages panel)
    /** JavaScript string literal for any text (also safe inside evaluateJavascript). */
    static String jsString(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '\\': b.append("\\\\"); break;
                case '"': b.append("\\\""); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '<': b.append("\\u003c"); break;
                case '\u2028': b.append("\\u2028"); break;
                case '\u2029': b.append("\\u2029"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    /** Only https://translate.googleapis.com/... is allowed. */
    static boolean allowedUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            return "https".equals(u.getScheme()) && TRANSLATE_HOST.equals(u.getHost()) && u.getUserInfo() == null
                    && u.getPort() == -1;
        } catch (Exception e) {
            return false;
        }
    }

    private void deliver(final int id, final boolean ok, final String text) {
        final String js = "window.__nativeFetchDone(" + id + "," + ok + "," + jsString(text) + ")";
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    private void fetch(final int id, final String url) {
        if (!allowedUrl(url)) {
            deliver(id, false, "blocked: the app only talks to the translation service");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(20000);
                    c.setInstanceFollowRedirects(false);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
                    int code = c.getResponseCode();
                    if (code != 200) {
                        deliver(id, false, "The translation service answered " + code);
                        return;
                    }
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    try (InputStream in = c.getInputStream()) {
                        byte[] chunk = new byte[8192];
                        int n;
                        while ((n = in.read(chunk)) > 0) {
                            buf.write(chunk, 0, n);
                            if (buf.size() > 2_000_000) throw new IOException("answer too large");
                        }
                    }
                    deliver(id, true, new String(buf.toByteArray(), StandardCharsets.UTF_8));
                } catch (Exception e) {
                    deliver(id, false, "No connection to the translation service (" + e.getMessage() + ")");
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }, "translate-fetch").start();
    }

    static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\r\\n]+", "_").trim();
        return n.isEmpty() ? "lyrics.txt" : n;
    }

    // ------------------------------------------------------------------ lifecycle
    @Override
    public void onBackPressed() {
        moveTaskToBack(true);                               // keep the session; edits are autosaved anyway
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (pendingChooser != null) pendingChooser.onReceiveValue(null);
        web.destroy();
        super.onDestroy();
    }
}
