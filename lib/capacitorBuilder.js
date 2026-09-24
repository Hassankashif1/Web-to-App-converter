const { exec } = require( 'child_process' );
const fs = require( 'fs' );
const fsp = fs.promises;
const path = require( 'path' );
const { promisify } = require( 'util' );

const execAsync = promisify( exec );

const BUILDS_DIR = path.join( process.cwd(), 'builds' );
const DOWNLOADS_DIR = path.join( process.cwd(), 'public', 'downloads' );

function log( jobId, message ) {
	// eslint-disable-next-line no-console
	console.log( `[job ${ jobId }] ${ message }` );
}

// Users often paste a bare domain ("example.com") into the Website URL field.
// Without a scheme, Capacitor's server.url is invalid and the native WebView
// fails to load anything — so default a missing scheme to https://.
function normalizeWebsiteUrl( url ) {
	if ( ! url ) {
		return url;
	}
	return /^https?:\/\//i.test( url ) ? url : `https://${ url }`;
}

async function run( command, cwd, jobId ) {
	log( jobId, `$ ${ command }` );
	try {
		const { stdout, stderr } = await execAsync( command, {
			cwd,
			env: process.env,
			maxBuffer: 1024 * 1024 * 50, // Gradle output is chatty.
		} );
		if ( stdout ) log( jobId, stdout.trim().split( '\n' ).slice( -10 ).join( '\n' ) );
		if ( stderr ) log( jobId, stderr.trim().split( '\n' ).slice( -10 ).join( '\n' ) );
	} catch ( err ) {
		throw new Error( `Command failed: ${ command }\n${ err.stderr || err.message }` );
	}
}

/**
 * scalePercent controls how much of the 1024x1024 canvas the image fills —
 * 100 = edge-to-edge (contain-fit, current default), lower values shrink the
 * image and pad the rest with transparency, e.g. so an Android adaptive icon
 * isn't clipped by the OS's circular/rounded mask.
 */
async function downloadOrGenerateImage( url, destPath, fallbackColor, scalePercent ) {
	const sharp = require( 'sharp' );
	const CANVAS = 1024;
	const targetSize = Math.max( 1, Math.round( CANVAS * ( ( scalePercent || 100 ) / 100 ) ) );

	if ( url ) {
		try {
			const response = await fetch( url );
			if ( response.ok ) {
				const buffer = Buffer.from( await response.arrayBuffer() );
				// Pad with a transparent background (not fallbackColor) so an uploaded
				// transparent PNG logo/icon stays transparent instead of getting a
				// solid-color square baked in behind it.
				const inner = await sharp( buffer )
					.ensureAlpha()
					.resize( targetSize, targetSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } } )
					.png()
					.toBuffer();

				if ( targetSize === CANVAS ) {
					await fsp.writeFile( destPath, inner );
				} else {
					await sharp( { create: { width: CANVAS, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } } )
						.composite( [ { input: inner, gravity: 'center' } ] )
						.png()
						.toFile( destPath );
				}
				return;
			}
		} catch ( e ) {
			// fall through to generated placeholder
		}
	}

	// No source image (or it failed to download) — generate a plain color square
	// so @capacitor/assets always has something valid to work from.
	await sharp( {
		create: {
			width: 1024,
			height: 1024,
			channels: 4,
			background: fallbackColor || '#1773b0',
		},
	} )
		.png()
		.toFile( destPath );
}

/**
 * Scaffolds a real Capacitor project for the given job and runs an actual
 * Gradle debug build. Requires Node, a JDK, and the Android SDK
 * (ANDROID_HOME) to be installed locally — see README.md.
 *
 * Returns { androidDownloadUrl } on success. Throws on any failure; the
 * caller is responsible for reporting that failure back to WordPress.
 */
async function buildAndroid( job ) {
	const jobId = job.id;
	const workDir = path.join( BUILDS_DIR, jobId );
	const config = job.configuration || {};
	const preloader = config.preloader || {};

	const appId = job.packageId && job.packageId.trim()
		? job.packageId.trim()
		: `com.webtoapp.preview.app${ job.appId }`;
	const appName = config.appName || 'My App';
	const websiteUrl = normalizeWebsiteUrl( config.websiteUrl );

	if ( ! websiteUrl ) {
		throw new Error( 'Job has no websiteUrl in its configuration — nothing to wrap.' );
	}

	log( jobId, `Starting Android build for "${ appName }" (${ appId }) -> ${ websiteUrl }` );

	// 1. Fresh working directory.
	await fsp.rm( workDir, { recursive: true, force: true } );
	await fsp.mkdir( workDir, { recursive: true } );
	await fsp.mkdir( path.join( workDir, 'www' ), { recursive: true } );
	await fsp.mkdir( path.join( workDir, 'assets' ), { recursive: true } );

	// 2. Minimal package.json + www placeholder (Capacitor requires a webDir to exist,
	//    even though server.url below means the app never actually shows local files).
	await fsp.writeFile(
		path.join( workDir, 'package.json' ),
		JSON.stringify( { name: 'wta-generated-app', version: '1.0.0', private: true }, null, 2 )
	);
	await fsp.writeFile(
		path.join( workDir, 'www', 'index.html' ),
		'<!doctype html><html><body>Loading...</body></html>'
	);

	// Offline game — opt-in, defaults on. Bundled into the app's own assets
	// (via webDir) so it's available locally with zero network needed; wired
	// up to actually show automatically in step 6 below (Android only for now).
	const offlineGameEnabled = false !== config.offlineGameEnabled;
	if ( offlineGameEnabled ) {
		const { getOfflineGameHtml } = require( './offlineGame' );
		await fsp.writeFile( path.join( workDir, 'www', 'offline.html' ), getOfflineGameHtml() );
	}

	// Preloader is opt-in — when turned off, skip the splash delay/spinner entirely
	// (native launch still shows a brief default splash, that's an OS-level thing
	// we can't remove, but our custom logo/spinner overlay is fully skipped).
	const preloaderEnabled = false !== preloader.enabled;
	const minDurationMs = Math.round( ( undefined === preloader.minDuration ? 1.5 : preloader.minDuration ) * 1000 );

	// 3. Capacitor config — server.url makes the native WebView load the real
	//    site directly, which is the whole point of a "web to app" wrapper.
	const capacitorConfig = {
		appId,
		appName,
		webDir: 'www',
		server: {
			url: websiteUrl,
			cleartext: websiteUrl.startsWith( 'http://' ),
		},
		plugins: {
			SplashScreen: {
				launchShowDuration: preloaderEnabled ? minDurationMs : 0,
				backgroundColor: preloader.backgroundColor || '#ffffff',
				// Native splash screens are one static image — only the ring/dots loader
				// types have a native equivalent (a spinner overlay). "none" and the
				// logo-animation types (which only animate in the web preview) both
				// mean "no native spinner overlay".
				showSpinner: preloaderEnabled && [ 'spinner', 'dots', 'pulse' ].includes( preloader.loaderType || 'spinner' ),
				spinnerColor: preloader.loaderColor || '#1773b0',
				androidSplashResourceName: 'splash',
			},
		},
	};
	await fsp.writeFile(
		path.join( workDir, 'capacitor.config.json' ),
		JSON.stringify( capacitorConfig, null, 2 )
	);

	// 4. Install Capacitor itself (this is the slow step on a first run).
	//    @capacitor/ios is included here too so scaffoldIOS() below can reuse this install.
	await run(
		'npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor/splash-screen @capacitor/assets --no-audit --no-fund',
		workDir,
		jobId
	);

	// 5. Icon / splash source images — from the logo the user uploaded in the
	//    WordPress builder, or a plain color square if none was set.
	await downloadOrGenerateImage( config.appIcon || preloader.logo, path.join( workDir, 'assets', 'icon.png' ), preloader.backgroundColor, config.appIconSize );
	await downloadOrGenerateImage( preloader.logo, path.join( workDir, 'assets', 'splash.png' ), preloader.backgroundColor );

	// 6. Add the Android platform, generate icons/splash from the assets above, sync.
	await run( 'npx cap add android', workDir, jobId );

	if ( offlineGameEnabled ) {
		const { androidMainActivitySource } = require( './offlineGame' );
		const packagePath = appId.split( '.' ).join( path.sep );
		const mainActivityPath = path.join( workDir, 'android', 'app', 'src', 'main', 'java', packagePath, 'MainActivity.java' );
		if ( fs.existsSync( mainActivityPath ) ) {
			await fsp.writeFile( mainActivityPath, androidMainActivitySource( { packageName: appId, websiteUrl } ) );
			log( jobId, 'Offline game wired up: MainActivity.java now swaps to the bundled offline.html when connectivity drops.' );
		} else {
			log( jobId, `Offline game skipped: expected MainActivity.java at ${ mainActivityPath } but it wasn't there.` );
		}

		// MainActivity's ConnectivityManager.registerNetworkCallback() throws a
		// SecurityException (crashing the app on launch) without this permission —
		// Capacitor's default manifest only declares INTERNET, not this one.
		const manifestPath = path.join( workDir, 'android', 'app', 'src', 'main', 'AndroidManifest.xml' );
		if ( fs.existsSync( manifestPath ) ) {
			const manifest = await fsp.readFile( manifestPath, 'utf8' );
			if ( ! manifest.includes( 'ACCESS_NETWORK_STATE' ) ) {
				const patched = manifest.replace(
					'<uses-permission android:name="android.permission.INTERNET" />',
					'<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
				);
				await fsp.writeFile( manifestPath, patched );
			}
		}
	}

	await run( 'npx capacitor-assets generate --android', workDir, jobId );
	await run( 'npx cap sync android', workDir, jobId );

	// 7. Real Gradle build. This is the step that actually produces an APK,
	//    and the one most likely to fail if ANDROID_HOME / JDK aren't set up.
	const androidDir = path.join( workDir, 'android' );
	const gradleCmd = 'win32' === process.platform ? '.\\gradlew.bat assembleDebug' : './gradlew assembleDebug';

	if ( 'win32' !== process.platform ) {
		await fsp.chmod( path.join( androidDir, 'gradlew' ), 0o755 );
	}

	await run( gradleCmd, androidDir, jobId );

	// 8. Locate the APK and publish it under public/downloads so Next.js can serve it.
	const apkSource = path.join( androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk' );

	if ( ! fs.existsSync( apkSource ) ) {
		throw new Error( `Gradle reported success but no APK was found at ${ apkSource }` );
	}

	await fsp.mkdir( DOWNLOADS_DIR, { recursive: true } );
	const fileName = `${ jobId }.apk`;
	await fsp.copyFile( apkSource, path.join( DOWNLOADS_DIR, fileName ) );

	const baseUrl = ( process.env.SELF_BASE_URL || 'http://localhost:4000' ).replace( /\/$/, '' );
	const androidDownloadUrl = `${ baseUrl }/downloads/${ fileName }`;

	log( jobId, `APK ready: ${ androidDownloadUrl }` );

	return { androidDownloadUrl };
}

/**
 * Scaffolds a real Xcode project (icons, splash, Capacitor iOS platform files)
 * and zips it up for download. This works on any OS — Capacitor's iOS platform
 * uses Swift Package Manager, not CocoaPods, so `cap add/sync ios` need no Mac
 * tooling. What we can NOT do outside macOS is compile and sign a real .ipa —
 * that requires Xcode and an Apple Developer signing identity tied to a real
 * Mac, which can't be automated or safely stored on a build server. So instead
 * of a fake success, this hands back a ready-to-open Xcode project the user
 * can unzip on a Mac to finish themselves.
 */
async function scaffoldIOS( job ) {
	const jobId = job.id;
	const workDir = path.join( BUILDS_DIR, jobId );
	const config = job.configuration || {};
	const preloader = config.preloader || {};

	await fsp.mkdir( path.join( workDir, 'assets' ), { recursive: true } );
	await downloadOrGenerateImage( config.appIcon || preloader.logo, path.join( workDir, 'assets', 'icon.png' ), preloader.backgroundColor, config.appIconSize );
	await downloadOrGenerateImage( preloader.logo, path.join( workDir, 'assets', 'splash.png' ), preloader.backgroundColor );

	// Regenerating iOS on its own (via the dashboard's "Regenerate" button) must
	// not collide with a platform folder left over from a previous run.
	await fsp.rm( path.join( workDir, 'ios' ), { recursive: true, force: true } );
	await run( 'npx cap add ios', workDir, jobId );
	await run( 'npx capacitor-assets generate --ios', workDir, jobId );
	await run( 'npx cap sync ios', workDir, jobId );

	// Zip the generated Xcode project so it can be downloaded as one file.
	await fsp.mkdir( DOWNLOADS_DIR, { recursive: true } );
	const zipFileName = `${ jobId }-ios.zip`;
	const zipDest = path.join( DOWNLOADS_DIR, zipFileName );
	await fsp.rm( zipDest, { force: true } );

	if ( 'win32' === process.platform ) {
		await run( `powershell -NoProfile -Command "Compress-Archive -Path 'ios' -DestinationPath '${ zipDest }' -Force"`, workDir, jobId );
	} else {
		await run( `zip -r "${ zipDest }" ios`, workDir, jobId );
	}

	const baseUrl = ( process.env.SELF_BASE_URL || 'http://localhost:4000' ).replace( /\/$/, '' );
	const iosDownloadUrl = `${ baseUrl }/downloads/${ zipFileName }`;

	log( jobId, `iOS Xcode project ready: ${ iosDownloadUrl }` );

	return {
		skipped: false,
		iosDownloadUrl,
		manualStep: 'This is an Xcode project scaffold, not a signed .ipa — Apple requires a real Mac + Xcode + a developer signing identity to build and sign iOS apps, which cannot be automated on Windows/Linux. Unzip it on a Mac, open ios/App/App.xcworkspace (or App.xcodeproj) in Xcode, set your signing team, then Product -> Archive.',
	};
}

module.exports = { buildAndroid, scaffoldIOS, downloadOrGenerateImage, normalizeWebsiteUrl };
