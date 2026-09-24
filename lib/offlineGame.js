const fs = require( 'fs' );
const path = require( 'path' );

// The repo-root offline-game.html is the single source of truth — edit it
// directly (it's a real, playable game on its own) rather than a copy here.
const TEMPLATE_PATH = path.join( process.cwd(), 'offline-game.html' );

function getOfflineGameHtml() {
	return fs.readFileSync( TEMPLATE_PATH, 'utf8' );
}

/**
 * Android MainActivity that swaps the WebView to the bundled offline game
 * when the device loses connectivity, and back to the live site the moment
 * it's back — driven by ConnectivityManager, not by anything in the loaded
 * page's own JS (which we don't control, since it's the customer's site).
 *
 * Deliberately does NOT touch Capacitor's own WebViewClient (that's what
 * wires up the JS<->native bridge) — this only calls webView.loadUrl(), so
 * plugins keep working normally either way.
 */
function androidMainActivitySource( { packageName, websiteUrl } ) {
	return `package ${ packageName };

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String REMOTE_URL = ${ JSON.stringify( websiteUrl ) };
	private static final String OFFLINE_URL = "file:///android_asset/public/offline.html";
	private volatile boolean isOffline = false;

	private boolean hasActiveInternet(ConnectivityManager cm) {
		Network network = cm.getActiveNetwork();
		if (network == null) return false;
		NetworkCapabilities caps = cm.getNetworkCapabilities(network);
		return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
	}

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
		if (cm == null) {
			return;
		}

		// onLost/onAvailable below only fire on a *change* — if the device is
		// already offline the moment the app launches, neither ever fires, so
		// check the current state up front too.
		if (!hasActiveInternet(cm)) {
			isOffline = true;
			WebView webView = bridge != null ? bridge.getWebView() : null;
			if (webView != null) {
				webView.loadUrl(OFFLINE_URL);
			}
		}

		NetworkRequest request = new NetworkRequest.Builder().build();
		cm.registerNetworkCallback(request, new ConnectivityManager.NetworkCallback() {
			@Override
			public void onLost(Network network) {
				runOnUiThread(() -> {
					if (isOffline) return;
					if (hasActiveInternet(cm)) return;
					isOffline = true;
					WebView webView = bridge != null ? bridge.getWebView() : null;
					if (webView != null) {
						webView.loadUrl(OFFLINE_URL);
					}
				});
			}

			@Override
			public void onAvailable(Network network) {
				runOnUiThread(() -> {
					if (!isOffline) return;
					isOffline = false;
					WebView webView = bridge != null ? bridge.getWebView() : null;
					if (webView != null) {
						webView.loadUrl(REMOTE_URL);
					}
				});
			}
		});
	}
}
`;
}

module.exports = { getOfflineGameHtml, androidMainActivitySource };
