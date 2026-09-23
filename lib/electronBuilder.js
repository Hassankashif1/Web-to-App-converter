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

async function run( command, cwd, jobId ) {
	log( jobId, `$ ${ command }` );
	try {
		const { stdout, stderr } = await execAsync( command, {
			cwd,
			env: process.env,
			maxBuffer: 1024 * 1024 * 50,
		} );
		if ( stdout ) log( jobId, stdout.trim().split( '\n' ).slice( -10 ).join( '\n' ) );
		if ( stderr ) log( jobId, stderr.trim().split( '\n' ).slice( -10 ).join( '\n' ) );
	} catch ( err ) {
		throw new Error( `Command failed: ${ command }\n${ err.stderr || err.message }` );
	}
}

function mainJsSource( { appName, websiteUrl, backgroundColor, preloaderEnabled, minDurationMs } ) {
	return `const { app, BrowserWindow } = require('electron');
const path = require('path');

const PRELOADER_ENABLED = ${ JSON.stringify( !! preloaderEnabled ) };
const MIN_SPLASH_MS = ${ JSON.stringify( minDurationMs ) };

let splash = null;
let main = null;

function createSplash() {
	splash = new BrowserWindow({
		width: 380,
		height: 380,
		frame: false,
		resizable: false,
		movable: false,
		show: true,
		backgroundColor: ${ JSON.stringify( backgroundColor ) },
		webPreferences: { contextIsolation: true, nodeIntegration: false },
	});
	splash.loadFile(path.join(__dirname, 'splash.html'));
}

function createMain() {
	main = new BrowserWindow({
		width: 1280,
		height: 800,
		title: ${ JSON.stringify( appName ) },
		backgroundColor: ${ JSON.stringify( backgroundColor ) },
		icon: path.join(__dirname, 'assets', 'icon.png'),
		show: ! PRELOADER_ENABLED,
		webPreferences: { contextIsolation: true, nodeIntegration: false },
	});
	main.setMenuBarVisibility(false);
	main.loadURL(${ JSON.stringify( websiteUrl ) });

	if (! PRELOADER_ENABLED) {
		main.once('ready-to-show', () => main.show());
		return;
	}

	const startedAt = Date.now();
	const reveal = () => {
		if (main.isVisible()) return;
		const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - startedAt));
		setTimeout(() => {
			if (splash) { splash.close(); splash = null; }
			main.show();
		}, wait);
	};

	main.webContents.once('did-finish-load', reveal);
	main.webContents.once('did-fail-load', reveal);
}

app.whenReady().then(() => {
	if (PRELOADER_ENABLED) {
		createSplash();
	}
	createMain();
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
	if (BrowserWindow.getAllWindows().length === 0) createMain();
});
`;
}

const LOADER_CSS = {
	spinner: ( color, size ) => `
.loader{width:${ size }px;height:${ size }px;border-radius:50%;border:${ Math.max( 2, Math.round( size / 10 ) ) }px solid rgba(0,0,0,0.08);border-top-color:${ color };animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}`,
	pulse: ( color, size ) => `
.loader{width:${ size }px;height:${ size }px;border-radius:50%;background:${ color };animation:pulse 1s ease-in-out infinite;}
@keyframes pulse{0%,100%{transform:scale(.85);opacity:.7}50%{transform:scale(1.05);opacity:1}}`,
	dots: ( color ) => `
.loader{display:flex;gap:6px;}
.loader span{width:10px;height:10px;border-radius:50%;background:${ color };animation:dotBounce 1s ease-in-out infinite;}
.loader span:nth-child(2){animation-delay:.15s}
.loader span:nth-child(3){animation-delay:.3s}
@keyframes dotBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`,
	none: () => '',
};

const LOGO_ANIM_CSS = {
	'logo-pulse': `.logo{animation:logoPulse 1s ease-in-out infinite;}
@keyframes logoPulse{0%,100%{transform:scale(.92);opacity:.8}50%{transform:scale(1.05);opacity:1}}`,
	'logo-bounce': `.logo{animation:logoBounce 1s ease-in-out infinite;}
@keyframes logoBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-14px)}}`,
	'logo-fade': `.logo{animation:logoFade 1s ease-in-out infinite;}
@keyframes logoFade{0%,100%{opacity:.35}50%{opacity:1}}`,
	'logo-rotate': `.logo{animation:logoRotate 1.4s linear infinite;}
@keyframes logoRotate{to{transform:rotate(360deg)}}`,
};

function splashHtmlSource( { preloader, hasLogo } ) {
	const backgroundColor = preloader.backgroundColor || '#ffffff';
	const loaderType = preloader.loaderType || 'spinner';
	const loaderColor = preloader.loaderColor || '#1773b0';
	const loaderSize = preloader.loaderSize || 40;
	const logoSize = preloader.logoSize || 120;
	const speed = preloader.animationSpeed || 1;
	const isLogoAnim = 0 === loaderType.indexOf( 'logo-' );

	const loaderCss = isLogoAnim ? '' : ( LOADER_CSS[ loaderType ] || LOADER_CSS.spinner )( loaderColor, loaderSize );
	const logoAnimCss = isLogoAnim ? ( LOGO_ANIM_CSS[ loaderType ] || '' ) : '';
	const loaderMarkup = isLogoAnim || 'none' === loaderType
		? ''
		: ( 'dots' === loaderType ? '<div class="loader"><span></span><span></span><span></span></div>' : '<div class="loader"></div>' );

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
	html,body{margin:0;height:100%;background:${ backgroundColor };display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;overflow:hidden;}
	.logo{width:${ logoSize }px;object-fit:contain;animation-duration:${ 1 / speed }s;}
	.loader{animation-duration:${ 1 / speed }s;}
	${ loaderCss }
	${ logoAnimCss }
</style>
</head>
<body>
	${ hasLogo ? '<img class="logo" src="assets/splash-logo.png" alt="" />' : '' }
	${ loaderMarkup }
</body>
</html>
`;
}

async function downloadRawImage( url, destPath ) {
	if ( ! url ) {
		return false;
	}
	try {
		const response = await fetch( url );
		if ( ! response.ok ) {
			return false;
		}
		const buffer = Buffer.from( await response.arrayBuffer() );
		await fsp.writeFile( destPath, buffer );
		return true;
	} catch ( e ) {
		return false;
	}
}

/**
 * Wraps the site in a real Electron desktop app. Builds a genuine Windows
 * .exe installer right here (electron-builder needs no extra native
 * toolchain for NSIS on Windows). macOS (.dmg, needs a Mac + notarization)
 * and Linux (AppImage/deb, unreliable to cross-build from Windows) instead
 * get the raw Electron project source zipped up — `npm install && npx
 * electron-builder --mac` (or --linux) finishes those on the right OS.
 */
async function buildDesktop( job ) {
	const jobId = job.id;
	const workDir = path.join( BUILDS_DIR, jobId, 'desktop' );
	const config = job.configuration || {};
	const preloader = config.preloader || {};

	const appId = job.packageId && job.packageId.trim()
		? job.packageId.trim()
		: `com.webtoapp.preview.app${ job.appId }`;
	const appName = config.appName || 'My App';
	const { normalizeWebsiteUrl } = require( './capacitorBuilder' );
	const websiteUrl = normalizeWebsiteUrl( config.websiteUrl );
	const backgroundColor = preloader.backgroundColor || '#ffffff';
	const preloaderEnabled = false !== preloader.enabled;
	const minDurationMs = Math.round( ( undefined === preloader.minDuration ? 1.5 : preloader.minDuration ) * 1000 );

	if ( ! websiteUrl ) {
		throw new Error( 'Job has no websiteUrl in its configuration — nothing to wrap.' );
	}

	log( jobId, `Starting desktop (Electron) build for "${ appName }" -> ${ websiteUrl }` );

	// 1. Fresh working directory.
	await fsp.rm( workDir, { recursive: true, force: true } );
	await fsp.mkdir( workDir, { recursive: true } );
	await fsp.mkdir( path.join( workDir, 'assets' ), { recursive: true } );

	await fsp.writeFile(
		path.join( workDir, 'main.js' ),
		mainJsSource( { appName, websiteUrl, backgroundColor, preloaderEnabled, minDurationMs } )
	);

	// 2. Icon — reuse whatever Android/iOS already generated for this job if present,
	//    otherwise fall back to the same app icon / logo source.
	const sharedIcon = path.join( BUILDS_DIR, jobId, 'assets', 'icon.png' );
	const iconDest = path.join( workDir, 'assets', 'icon.png' );
	if ( fs.existsSync( sharedIcon ) ) {
		await fsp.copyFile( sharedIcon, iconDest );
	} else {
		const { downloadOrGenerateImage } = require( './capacitorBuilder' );
		await downloadOrGenerateImage( config.appIcon || preloader.logo, iconDest, backgroundColor, config.appIconSize );
	}

	// 2b. Splash screen — a real preloader window shown while the site loads,
	// matching the Live Preview's logo/loader/background settings. This is
	// the piece that was previously entirely missing from the desktop build.
	let hasLogo = false;
	if ( preloaderEnabled && preloader.logo ) {
		hasLogo = await downloadRawImage( preloader.logo, path.join( workDir, 'assets', 'splash-logo.png' ) );
	}
	if ( preloaderEnabled ) {
		await fsp.writeFile( path.join( workDir, 'splash.html' ), splashHtmlSource( { preloader, hasLogo } ) );
	}

	const packageJson = {
		name: 'wta-generated-desktop-app',
		version: '1.0.0',
		private: true,
		main: 'main.js',
		scripts: { dist: 'electron-builder' },
		build: {
			appId,
			productName: appName,
			asar: true,
			icon: 'assets/icon.png',
			win: { target: [ 'nsis' ] },
			mac: { target: [ 'dmg' ], category: 'public.app-category.utilities' },
			linux: { target: [ 'AppImage', 'deb' ], category: 'Utility' },
			directories: { output: 'dist' },
		},
		devDependencies: {
			electron: '^32.0.0',
			'electron-builder': '^25.0.0',
		},
	};
	await fsp.writeFile( path.join( workDir, 'package.json' ), JSON.stringify( packageJson, null, 2 ) );

	// 3. Source-only zip (for macOS/Linux — finish on the right OS with `npm install && npm run dist`).
	await fsp.mkdir( DOWNLOADS_DIR, { recursive: true } );
	const sourceZipName = `${ jobId }-desktop-source.zip`;
	const sourceZipDest = path.join( DOWNLOADS_DIR, sourceZipName );
	await fsp.rm( sourceZipDest, { force: true } );

	const sourceFiles = [ 'main.js', 'package.json', 'assets' ];
	if ( fs.existsSync( path.join( workDir, 'splash.html' ) ) ) {
		sourceFiles.push( 'splash.html' );
	}

	if ( 'win32' === process.platform ) {
		const pathsArg = sourceFiles.map( ( f ) => `'${ f }'` ).join( ',' );
		await run(
			`powershell -NoProfile -Command "Compress-Archive -Path ${ pathsArg } -DestinationPath '${ sourceZipDest }' -Force"`,
			workDir,
			jobId
		);
	} else {
		await run( `zip -r "${ sourceZipDest }" ${ sourceFiles.join( ' ' ) }`, workDir, jobId );
	}
	const baseUrl = ( process.env.SELF_BASE_URL || 'http://localhost:4000' ).replace( /\/$/, '' );
	const desktopSourceUrl = `${ baseUrl }/downloads/${ sourceZipName }`;

	// 4. Real Windows .exe installer — only when this worker is actually running on Windows.
	let desktopWindowsUrl = null;
	if ( 'win32' === process.platform ) {
		await run( 'npm install --no-audit --no-fund', workDir, jobId );
		await run( 'npx electron-builder --win --publish=never', workDir, jobId );

		const distDir = path.join( workDir, 'dist' );
		const resolvedExe = fs.existsSync( distDir )
			? fs.readdirSync( distDir ).find( ( f ) => f.endsWith( '.exe' ) )
			: null;

		if ( resolvedExe ) {
			const exeFileName = `${ jobId }-desktop-win.exe`;
			await fsp.copyFile( path.join( distDir, resolvedExe ), path.join( DOWNLOADS_DIR, exeFileName ) );
			desktopWindowsUrl = `${ baseUrl }/downloads/${ exeFileName }`;
			log( jobId, `Windows desktop installer ready: ${ desktopWindowsUrl }` );
		} else {
			throw new Error( 'electron-builder reported success but no .exe was found in dist/' );
		}
	}

	return {
		desktopWindowsUrl,
		desktopSourceUrl,
		desktopNote: 'The Windows .exe is a real installer, ready to run. For macOS (.dmg) or Linux (AppImage/deb), unzip the source on that OS and run `npm install && npm run dist` — Apple/Linux packaging tools aren\'t available on this Windows build server.',
	};
}

module.exports = { buildDesktop };
