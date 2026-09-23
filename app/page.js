
 
'use client';

import { useEffect, useState } from 'react';
import styles from './builder.module.css';

const STATUS_COLORS = {
	pending: '#9297b3',
	building: '#4f46e5',
	done: '#16a34a',
	complete: '#16a34a',
	failed: '#dc2626',
};

const PLATFORM_LABELS = { android: 'Android', ios: 'iOS', desktop: 'Desktop' };
const PLATFORM_ORDER = [ 'android', 'ios', 'desktop' ];

// Files are stored on disk under the job id (to avoid collisions between two
// jobs with the same app name), but the browser should download them under
// a friendly name matching the app.
function safeFileName( name ) {
	const cleaned = ( name || 'app' ).replace( /[\\/:*?"<>|]+/g, '' ).trim();
	return cleaned || 'app';
}

function platformStatus( job, platform ) {
	const explicit = job[ `${ platform }Status` ];
	if ( explicit ) {
		return explicit;
	}
	// Fallback for jobs created before per-platform status tracking existed.
	if ( 'android' === platform ) {
		if ( job.androidDownloadUrl ) return 'complete';
		return 'failed' === job.status ? 'failed' : 'pending';
	}
	if ( 'ios' === platform ) {
		return job.iosDownloadUrl ? 'complete' : 'pending';
	}
	return ( job.desktopWindowsUrl || job.desktopLinuxUrl || job.desktopMacUrl || job.desktopSourceUrl ) ? 'complete' : 'pending';
}

const LOADER_CLASS = {
	spinner: 'loaderSpinner',
	dots: 'loaderDots',
	pulse: 'loaderPulse',
	none: 'loaderNone',
};

const LOGO_ANIM_CLASS = {
	'logo-pulse': 'logoPulse',
	'logo-bounce': 'logoBounce',
	'logo-fade': 'logoFade',
	'logo-rotate': 'logoRotate',
};

const initialConfig = {
	appName: '',
	websiteUrl: '',
	packageId: '',
	appIcon: '',
	appIconSize: 100,
	offlineGameEnabled: true,
	buildType: 'test',
	preloader: {
		enabled: true,
		logo: '',
		logoSize: 120,
		backgroundColor: '#ffffff',
		loaderType: 'spinner',
		loaderColor: '#1773b0',
		loaderSize: 40,
		animationSpeed: 1,
		minDuration: 1.5,
	},
};

function fileToDataUrl( file ) {
	return new Promise( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onload = () => resolve( reader.result );
		reader.onerror = reject;
		reader.readAsDataURL( file );
	} );
}

// Paints the filled portion of a range slider's track up to its current
// value (Chrome/Edge/Safari don't fill a range track natively like Firefox does).
function rangeFillStyle( value, min, max ) {
	const pct = Math.max( 0, Math.min( 100, ( ( value - min ) / ( max - min ) ) * 100 ) );
	return { '--range-pct': `${ pct }%` };
}

export default function Dashboard() {
	const [ config, setConfig ] = useState( initialConfig );
	const [ jobs, setJobs ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ submitting, setSubmitting ] = useState( false );
	const [ resultMsg, setResultMsg ] = useState( '' );
	const [ resultIsError, setResultIsError ] = useState( false );
	const [ theme, setTheme ] = useState( 'light' );
	const [ activeTabs, setActiveTabs ] = useState( {} );
	const [ mainTab, setMainTab ] = useState( 'builder' );
	const [ ownerId, setOwnerId ] = useState( '' );

	useEffect( () => {
		const saved = window.localStorage.getItem( 'wta-theme' );
		const preferred = saved || ( window.matchMedia && window.matchMedia( '(prefers-color-scheme: dark)' ).matches ? 'dark' : 'light' );
		setTheme( preferred );
	}, [] );

	// No login here — each browser gets its own random id so the Build Queue
	// only ever shows the builds made from this browser, not everyone else's.
	useEffect( () => {
		let id = window.localStorage.getItem( 'wta-owner-id' );
		const isNew = ! id;
		if ( ! id ) {
			id = ( window.crypto && window.crypto.randomUUID )
				? window.crypto.randomUUID()
				: `owner-${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;
			window.localStorage.setItem( 'wta-owner-id', id );
		}
		setOwnerId( id );

		if ( isNew ) {
			// First time this browser has ever opened the app — adopt any
			// builds made before per-browser ownership existed.
			fetch( '/api/jobs/claim-legacy', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { ownerId: id } ),
			} ).catch( () => {} );
		}
	}, [] );

	useEffect( () => {
		window.localStorage.setItem( 'wta-theme', theme );
		document.body.style.background = 'dark' === theme ? '#0b0d14' : '#f5f6fb';
		document.body.style.color = 'dark' === theme ? '#eef0fb' : '#14162b';
	}, [ theme ] );

	function toggleTheme() {
		setTheme( ( t ) => ( 'dark' === t ? 'light' : 'dark' ) );
	}

	function setActiveTab( jobId, platform ) {
		setActiveTabs( ( t ) => ( { ...t, [ jobId ]: platform } ) );
	}

	async function loadJobs() {
		try {
			const res = await fetch( '/api/jobs' );
			setJobs( await res.json() );
		} finally {
			setLoading( false );
		}
	}

	useEffect( () => {
		loadJobs();
		const interval = setInterval( loadJobs, 4000 );
		return () => clearInterval( interval );
	}, [] );

	async function retry( id ) {
		await fetch( `/api/jobs/${ id }/retry`, { method: 'POST' } );
		loadJobs();
	}

	async function regenerate( id, platform ) {
		await fetch( `/api/jobs/${ id }/rebuild`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { platform } ),
		} );
		loadJobs();
	}

	async function deleteBuild( id ) {
		if ( ! window.confirm( `Delete build #${ id }? This also removes its downloaded files.` ) ) {
			return;
		}
		await fetch( `/api/jobs/${ id }`, { method: 'DELETE' } );
		loadJobs();
	}

	function setField( key, value ) {
		setConfig( ( c ) => ( { ...c, [ key ]: value } ) );
	}

	function setPreloaderField( key, value ) {
		setConfig( ( c ) => ( { ...c, preloader: { ...c.preloader, [ key ]: value } } ) );
	}

	async function handleUpload( file, onDone ) {
		try {
			const dataUrl = await fileToDataUrl( file );
			const res = await fetch( '/api/upload', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( { data: dataUrl } ),
			} );
			const data = await res.json();
			if ( ! res.ok ) {
				throw new Error( data.error || 'Upload failed.' );
			}
			onDone( data.url );
		} catch ( err ) {
			setResultIsError( true );
			setResultMsg( err.message );
		}
	}

	async function submitBuild() {
		if ( ! config.websiteUrl ) {
			setResultIsError( true );
			setResultMsg( 'Website URL is required.' );
			return;
		}

		// A bare domain (no http/https) makes the native WebView fail to load.
		const normalizedUrl = /^https?:\/\//i.test( config.websiteUrl ) ? config.websiteUrl : `https://${ config.websiteUrl }`;
		if ( normalizedUrl !== config.websiteUrl ) {
			setField( 'websiteUrl', normalizedUrl );
		}

		setSubmitting( true );
		setResultIsError( false );
		setResultMsg( 'Preparing build…' );

		try {
			const res = await fetch( '/api/submit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify( {
					ownerId,
					appName: config.appName,
					websiteUrl: normalizedUrl,
					packageId: config.packageId,
					appIcon: config.appIcon,
					appIconSize: config.appIconSize,
					offlineGameEnabled: config.offlineGameEnabled,
					buildType: config.buildType,
					preloaderEnabled: config.preloader.enabled,
					logo: config.preloader.logo,
					logoSize: config.preloader.logoSize,
					backgroundColor: config.preloader.backgroundColor,
					loaderType: config.preloader.loaderType,
					loaderColor: config.preloader.loaderColor,
					loaderSize: config.preloader.loaderSize,
					animationSpeed: config.preloader.animationSpeed,
					minDuration: config.preloader.minDuration,
				} ),
			} );
			const data = await res.json();
			if ( ! res.ok ) {
				throw new Error( data.error || 'Submit failed.' );
			}
			setResultIsError( false );
			setResultMsg( `Build requested — Job #${ data.jobId }` );
			loadJobs();
		} catch ( err ) {
			setResultIsError( true );
			setResultMsg( err.message );
		} finally {
			setSubmitting( false );
		}
	}

	// No login — only show builds made from this browser's owner id. Jobs
	// without a userId yet (still loading, or legacy not-yet-claimed) are hidden.
	const myJobs = jobs.filter( ( j ) => j.userId && j.userId === ownerId );
	// Oldest first, newest last — like a normal growing list/log.
	const queueJobs = [ ...myJobs ].reverse();

	const { preloader } = config;
	const loaderType = preloader.loaderType;
	const isLogoAnim = loaderType.indexOf( 'logo-' ) === 0;
	const speed = preloader.animationSpeed || 1;
	const animDuration = ( 1 / speed ) + 's';
	const logoAnimClass = isLogoAnim ? styles[ LOGO_ANIM_CLASS[ loaderType ] ] : '';
	const loaderClass = styles[ LOADER_CLASS[ loaderType ] || 'loaderNone' ];
	const iconSrc = config.appIcon || preloader.logo;

	return (
		<div className={ styles.wrap } data-theme={ theme }>
			<button type="button" className={ styles.themeToggle } onClick={ toggleTheme }>
				<span className={ styles.themeToggleIcon }>{ 'dark' === theme ? '🌙' : '☀️' }</span>
				{ 'dark' === theme ? 'Dark' : 'Light' }
			</button>

			<div className={ styles.headerRow }>
				<div>
					<h1>Web to App Builder</h1>
					<p className={ styles.intro }>
						Configure your app below and generate a build directly — no WordPress needed. Make sure{ ' ' }
						<code>npm run worker</code> is running in another terminal to actually build it.
					</p>
				</div>
			</div>

			<div className={ styles.mainTabs }>
				<button
					type="button"
					className={ 'builder' === mainTab ? styles.mainTabActive : styles.mainTab }
					onClick={ () => setMainTab( 'builder' ) }
				>
					Builder
				</button>
				<button
					type="button"
					className={ 'queue' === mainTab ? styles.mainTabActive : styles.mainTab }
					onClick={ () => setMainTab( 'queue' ) }
				>
					Build Queue
					{ myJobs.length > 0 && <span className={ styles.mainTabCount }>{ myJobs.length }</span> }
				</button>
			</div>

			{ 'builder' === mainTab && (
			<div className={ styles.grid }>
				<section className={ styles.panel }>
					<h3>App Settings</h3>

					<div className={ styles.field }>
						<label>Website URL</label>
						<input
							type="url"
							placeholder="https://example.com"
							value={ config.websiteUrl }
							onChange={ ( e ) => setField( 'websiteUrl', e.target.value ) }
						/>
					</div>

					<div className={ styles.field }>
						<label>App Name</label>
						<input
							type="text"
							placeholder="My Website"
							value={ config.appName }
							onChange={ ( e ) => setField( 'appName', e.target.value ) }
						/>
					</div>

					<div className={ styles.field }>
						<label>Package ID (optional)</label>
						<input
							type="text"
							placeholder="com.example.myapp"
							value={ config.packageId }
							onChange={ ( e ) => setField( 'packageId', e.target.value ) }
						/>
					</div>
					<p className={ styles.note }>
						Package ID is only required for a &quot;live&quot; build — leave it blank for a quick test build.
					</p>

					<div className={ styles.field }>
						<label>App Icon</label>
						<div className={ styles.mediaPicker }>
							{ config.appIcon && <img src={ config.appIcon } className={ styles.mediaPreview } alt="" /> }
							<label className={ styles.uploadBtn }>
								⬆ Upload
								<input
									type="file"
									accept="image/*"
									hidden
									onChange={ ( e ) => e.target.files[ 0 ] && handleUpload( e.target.files[ 0 ], ( url ) => setField( 'appIcon', url ) ) }
								/>
							</label>
							{ config.appIcon && (
								<button type="button" className={ styles.btnLink } onClick={ () => setField( 'appIcon', '' ) }>
									Remove
								</button>
							) }
						</div>
					</div>

					{ config.appIcon && (
						<div className={ styles.field }>
							<label>App Icon Size <span className={ styles.valueBadge }>{ config.appIconSize }%</span></label>
							<input
								type="range"
								min="40"
								max="100"
								value={ config.appIconSize }
								style={ rangeFillStyle( config.appIconSize, 40, 100 ) }
								onChange={ ( e ) => setField( 'appIconSize', parseInt( e.target.value, 10 ) ) }
							/>
							<p className={ styles.note }>
								100% fills the icon edge-to-edge. Lower it to add padding around the icon — useful so
								Android&apos;s adaptive-icon mask (circle/rounded square) doesn&apos;t crop into it.
							</p>
						</div>
					) }

					<h3 className={ styles.subhead }>Preloader</h3>

					<div className={ styles.field }>
						<div className={ styles.segmented }>
							<label className={ styles.segmentedOption }>
								<input
									type="radio"
									name="preloaderEnabled"
									checked={ preloader.enabled }
									onChange={ () => setPreloaderField( 'enabled', true ) }
								/>
								Yes, show a preloader
							</label>
							<label className={ styles.segmentedOption }>
								<input
									type="radio"
									name="preloaderEnabled"
									checked={ ! preloader.enabled }
									onChange={ () => setPreloaderField( 'enabled', false ) }
								/>
								No preloader
							</label>
						</div>
					</div>

					{ preloader.enabled && (
						<>
							<div className={ styles.field }>
								<label>Logo</label>
								<div className={ styles.mediaPicker }>
									{ preloader.logo && <img src={ preloader.logo } className={ styles.mediaPreview } alt="" /> }
									<label className={ styles.uploadBtn }>
										⬆ Upload
										<input
											type="file"
											accept="image/*"
											hidden
											onChange={ ( e ) => e.target.files[ 0 ] && handleUpload( e.target.files[ 0 ], ( url ) => setPreloaderField( 'logo', url ) ) }
										/>
									</label>
									{ preloader.logo && (
										<button type="button" className={ styles.btnLink } onClick={ () => setPreloaderField( 'logo', '' ) }>
											Remove
										</button>
									) }
								</div>
							</div>

							<div className={ styles.field }>
								<label>Logo Size <span className={ styles.valueBadge }>{ preloader.logoSize }px</span></label>
								<input
									type="range"
									min="40"
									max="300"
									value={ preloader.logoSize }
									style={ rangeFillStyle( preloader.logoSize, 40, 300 ) }
									onChange={ ( e ) => setPreloaderField( 'logoSize', parseInt( e.target.value, 10 ) ) }
								/>
							</div>

							<div className={ styles.fieldRow }>
								<div className={ styles.field }>
									<label>Background</label>
									<div className={ styles.colorField }>
										<input
											type="color"
											value={ preloader.backgroundColor }
											onChange={ ( e ) => setPreloaderField( 'backgroundColor', e.target.value ) }
										/>
										<span className={ styles.colorFieldValue }>{ preloader.backgroundColor }</span>
									</div>
								</div>

								{ ! isLogoAnim && (
									<div className={ styles.field }>
										<label>Loader Color</label>
										<div className={ styles.colorField }>
											<input
												type="color"
												value={ preloader.loaderColor }
												onChange={ ( e ) => setPreloaderField( 'loaderColor', e.target.value ) }
											/>
											<span className={ styles.colorFieldValue }>{ preloader.loaderColor }</span>
										</div>
									</div>
								) }
							</div>

							<div className={ styles.field }>
								<label>Loader Type</label>
								<select value={ loaderType } onChange={ ( e ) => setPreloaderField( 'loaderType', e.target.value ) }>
									<optgroup label="Ring / Dots">
										<option value="spinner">Spinner</option>
										<option value="dots">Dots</option>
										<option value="pulse">Pulse</option>
										<option value="none">None</option>
									</optgroup>
									<optgroup label="Logo Animation">
										<option value="logo-pulse">Logo — Pulse</option>
										<option value="logo-bounce">Logo — Bounce</option>
										<option value="logo-fade">Logo — Fade</option>
										<option value="logo-rotate">Logo — Rotate</option>
									</optgroup>
								</select>
								<p className={ styles.note }>
									Ring/Dots show next to your logo. Logo Animation options animate the logo itself instead.
								</p>
							</div>

							{ ! isLogoAnim && (
								<div className={ styles.field }>
									<label>Loader Size <span className={ styles.valueBadge }>{ preloader.loaderSize }px</span></label>
									<input
										type="range"
										min="16"
										max="100"
										value={ preloader.loaderSize }
										style={ rangeFillStyle( preloader.loaderSize, 16, 100 ) }
										onChange={ ( e ) => setPreloaderField( 'loaderSize', parseInt( e.target.value, 10 ) ) }
									/>
								</div>
							) }

							<div className={ styles.field }>
								<label>Animation Speed <span className={ styles.valueBadge }>{ speed }x</span></label>
								<input
									type="range"
									min="0.5"
									max="3"
									step="0.1"
									value={ speed }
									style={ rangeFillStyle( speed, 0.5, 3 ) }
									onChange={ ( e ) => setPreloaderField( 'animationSpeed', parseFloat( e.target.value ) ) }
								/>
							</div>

							<div className={ styles.field }>
								<label>Minimum Duration <span className={ styles.valueBadge }>{ preloader.minDuration }s</span></label>
								<input
									type="range"
									min="0"
									max="5"
									step="0.5"
									value={ preloader.minDuration }
									style={ rangeFillStyle( preloader.minDuration, 0, 5 ) }
									onChange={ ( e ) => setPreloaderField( 'minDuration', parseFloat( e.target.value ) ) }
								/>
								<p className={ styles.note }>
									The preloader stays on screen for at least this long, even if the site loads faster — so it
									doesn&apos;t just flash and disappear. 0s means it hides as soon as the site is ready.
								</p>
							</div>

							<p className={ styles.note }>
								Native splash screens are a single static image — this animation plays in the live in-app preview,
								but only the logo, background color, and on/off state carry over to the very first native splash frame.
							</p>
						</>
					) }

					<h3 className={ styles.subhead }>Offline Mode</h3>
					<div className={ styles.field }>
						<div className={ styles.segmented }>
							<label className={ styles.segmentedOption }>
								<input
									type="radio"
									name="offlineGameEnabled"
									checked={ config.offlineGameEnabled }
									onChange={ () => setField( 'offlineGameEnabled', true ) }
								/>
								Yes, show a game
							</label>
							<label className={ styles.segmentedOption }>
								<input
									type="radio"
									name="offlineGameEnabled"
									checked={ ! config.offlineGameEnabled }
									onChange={ () => setField( 'offlineGameEnabled', false ) }
								/>
								No
							</label>
						</div>
						<p className={ styles.note }>
							When the device/PC loses its internet connection, the app shows a built-in offline
							game (with a &quot;You are offline&quot; banner) instead of a blank error page — and
							switches back to the live site automatically the moment the connection returns.
							Currently wired up for Android and Desktop; iOS only bundles the file (no
							auto-switch yet — needs a Mac to finish anyway).
						</p>
					</div>

					<div className={ styles.field }>
						<label>Build Type</label>
						<select value={ config.buildType } onChange={ ( e ) => setField( 'buildType', e.target.value ) }>
							<option value="test">test</option>
							<option value="live">live</option>
						</select>
					</div>

					<div className={ styles.actions }>
						<button type="button" className={ styles.btnPrimary } disabled={ submitting } onClick={ submitBuild }>
							{ submitting ? 'Submitting…' : 'Generate Build' }
						</button>
					</div>

					{ resultMsg && <div className={ resultIsError ? styles.resultError : styles.result }>{ resultMsg }</div> }
				</section>

				<section className={ `${ styles.panel } ${ styles.previewPanel }` }>
					<h3>Live Preview</h3>
					<div className={ styles.mobileFrame }>
						<div className={ styles.mobileFrameNotch } />
						<div className={ styles.mobileFrameScreen } style={ { backgroundColor: preloader.enabled ? preloader.backgroundColor : '#ffffff' } }>
							{ ! preloader.enabled && <p className={ styles.jobMeta }>No preloader — site loads directly</p> }

							{ preloader.enabled && preloader.logo && (
								<img
									src={ preloader.logo }
									alt=""
									className={ `${ styles.mobileFrameLogo } ${ logoAnimClass }` }
									style={ {
										width: preloader.logoSize + 'px',
										animationDuration: isLogoAnim ? animDuration : undefined,
									} }
								/>
							) }

							{ preloader.enabled && ! isLogoAnim && (
								<div
									className={ `${ styles.loader } ${ loaderClass }` }
									style={ {
										width: preloader.loaderSize + 'px',
										height: preloader.loaderSize + 'px',
										borderWidth: Math.max( 2, Math.round( preloader.loaderSize / 10 ) ) + 'px',
										animationDuration: animDuration,
										...( 'spinner' === loaderType ? { borderTopColor: preloader.loaderColor } : {} ),
										...( 'pulse' === loaderType ? { background: preloader.loaderColor } : {} ),
									} }
								>
									{ 'dots' === loaderType && [ 0, 1, 2 ].map( ( i ) => (
										<span key={ i } style={ { background: preloader.loaderColor, animationDelay: ( i * 0.15 ) + 's' } } />
									) ) }
								</div>
							) }
						</div>
					</div>

					<div className={ styles.iconPreview }>
						<h4>App Icon Preview</h4>
						<div className={ styles.iconPreviewRow }>
							<div className={ styles.iconPreviewItem }>
								<div className={ styles.mobileHome }>
									<div className={ styles.mobileHomeIcon }>
										{ iconSrc && (
											<img
												src={ iconSrc }
												alt=""
												style={ { width: config.appIconSize + '%', height: config.appIconSize + '%' } }
											/>
										) }
									</div>
									<span className={ styles.mobileHomeLabel }>App</span>
								</div>
								<p className={ styles.iconPreviewCaption }>Mobile home screen</p>
							</div>
							<div className={ styles.iconPreviewItem }>
								<div className={ styles.desktopTaskbar }>
									<div className={ styles.desktopIcon }>
										{ iconSrc && (
											<img
												src={ iconSrc }
												alt=""
												style={ { width: config.appIconSize + '%', height: config.appIconSize + '%' } }
											/>
										) }
									</div>
								</div>
								<p className={ styles.iconPreviewCaption }>Desktop taskbar</p>
							</div>
						</div>
					</div>
				</section>
			</div>
			) }

			{ 'queue' === mainTab && (
			<div>
				<h2 className={ styles.queueHeading }>Build Queue</h2>
				{ loading && <p>Loading…</p> }
				{ ! loading && 0 === myJobs.length && <p>No jobs yet. Head to the Builder tab to generate one.</p> }

				<div className={ styles.jobList }>
				{ queueJobs.map( ( job ) => {
					const statuses = {
						android: platformStatus( job, 'android' ),
						ios: platformStatus( job, 'ios' ),
						desktop: platformStatus( job, 'desktop' ),
					};
					const busy = 'pending' === job.status || 'building' === job.status;
					const baseName = safeFileName( job.configuration?.appName );
					const activePlatform = activeTabs[ job.id ] || 'android';

					return (
						<div key={ job.id } className={ styles.jobCard }>
							<div className={ styles.jobCardTop }>
								<strong>Job #{ job.id } — App #{ job.appId }</strong>
								<span className={ styles.queueBadge } style={ { color: STATUS_COLORS[ job.status ] || 'var(--text-muted)' } }>
									queue: { job.status }
								</span>
							</div>

							<p className={ styles.jobMeta }>
								{ job.configuration?.appName || '(untitled)' } — { job.configuration?.websiteUrl }
								{ ' · ' }
								{ job.buildType } build
								{ job.packageId ? ` · ${ job.packageId }` : '' }
							</p>

							<div className={ styles.platformTabs }>
								{ PLATFORM_ORDER.map( ( p ) => (
									<button
										key={ p }
										type="button"
										className={ p === activePlatform ? styles.platformTabActive : styles.platformTab }
										onClick={ () => setActiveTab( job.id, p ) }
									>
										<span className={ styles.tabDot } style={ { background: STATUS_COLORS[ statuses[ p ] ] } } />
										{ PLATFORM_LABELS[ p ] }
									</button>
								) ) }
							</div>

							<div className={ styles.platformPanel }>
								{ 'android' === activePlatform && (
									<>
										<div className={ styles.platformPanelHeader }>
											<span className={ styles.jobStatus } style={ { color: STATUS_COLORS[ statuses.android ] } }>
												{ statuses.android }
											</span>
											<button
												type="button"
												className={ styles.btnLink }
												disabled={ busy && 'building' === statuses.android }
												onClick={ () => regenerate( job.id, 'android' ) }
											>
												Regenerate
											</button>
										</div>
										<div className={ styles.platformPanelLinks }>
											{ job.androidDownloadUrl && (
												<a href={ job.androidDownloadUrl } download={ `${ baseName }.apk` } target="_blank" rel="noreferrer">Download APK</a>
											) }
										</div>
										{ job.error && 'failed' === statuses.android && <p className={ styles.jobError }>{ job.error }</p> }
									</>
								) }

								{ 'ios' === activePlatform && (
									<>
										<div className={ styles.platformPanelHeader }>
											<span className={ styles.jobStatus } style={ { color: STATUS_COLORS[ statuses.ios ] } }>
												{ statuses.ios }
											</span>
											<button
												type="button"
												className={ styles.btnLink }
												disabled={ busy && 'building' === statuses.ios }
												onClick={ () => regenerate( job.id, 'ios' ) }
											>
												Regenerate
											</button>
										</div>
										<div className={ styles.platformPanelLinks }>
											{ job.iosDownloadUrl && (
												<a href={ job.iosDownloadUrl } download={ `${ baseName }-ios.zip` } target="_blank" rel="noreferrer">
													Download Xcode Project (.zip)
												</a>
											) }
										</div>
										{ job.iosDownloadUrl && (
											<p className={ styles.jobMeta }>Not a signed .ipa — unzip on a Mac, open in Xcode, set your signing team, then Archive.</p>
										) }
									</>
								) }

								{ 'desktop' === activePlatform && (
									<>
										<div className={ styles.platformPanelHeader }>
											<span className={ styles.jobStatus } style={ { color: STATUS_COLORS[ statuses.desktop ] } }>
												{ statuses.desktop }
											</span>
											<button
												type="button"
												className={ styles.btnLink }
												disabled={ busy && 'building' === statuses.desktop }
												onClick={ () => regenerate( job.id, 'desktop' ) }
											>
												Regenerate
											</button>
										</div>
										<div className={ styles.platformPanelLinks }>
											{ job.desktopWindowsUrl && (
												<a href={ job.desktopWindowsUrl } download={ `${ baseName }.exe` } target="_blank" rel="noreferrer">Download for Windows (.exe)</a>
											) }
											{ job.desktopLinuxUrl && (
												<a href={ job.desktopLinuxUrl } target="_blank" rel="noreferrer">Download for Linux</a>
											) }
											{ job.desktopMacUrl && (
												<a href={ job.desktopMacUrl } download={ `${ baseName }.dmg` } target="_blank" rel="noreferrer">Download for macOS (.dmg)</a>
											) }
											{ job.desktopSourceUrl && (
												<a href={ job.desktopSourceUrl } download={ `${ baseName }-desktop-source.zip` } target="_blank" rel="noreferrer">
													Source (.zip) for Mac/Linux
												</a>
											) }
										</div>
									</>
								) }
							</div>

							<div className={ styles.jobCardActions }>
								<button type="button" className={ styles.btnSecondary } onClick={ () => retry( job.id ) }>
									Rebuild All
								</button>
								<button type="button" className={ styles.btnLink } onClick={ () => deleteBuild( job.id ) }>
									Delete
								</button>
							</div>
						</div>
					);
				} ) }
			</div>
			</div>
			) }
		</div>
	);
}
