const { loadEnv } = require( './lib/loadEnv' );
loadEnv();

const { nextPendingJob, updateJob } = require( './lib/jobStore' );
const { buildAndroid, scaffoldIOS } = require( './lib/capacitorBuilder' );
const { buildDesktop } = require( './lib/electronBuilder' );
const { postBuildResult } = require( './lib/wpClient' );

const POLL_INTERVAL_MS = parseInt( process.env.POLL_INTERVAL_MS || '5000', 10 );
let isBuilding = false; // one build at a time — Gradle is heavy, don't run two concurrently.

async function runAndroid( job ) {
	updateJob( job.id, { androidStatus: 'building' } );

	try {
		const { androidDownloadUrl } = await buildAndroid( job );
		updateJob( job.id, { androidStatus: 'complete', androidDownloadUrl, error: null } );
		console.log( `[job ${ job.id }] Android complete.` );

		// Reporting back to WordPress is best-effort — a build that succeeded locally
		// should stay complete even if WordPress can't be reached (e.g. no WP site set up).
		try {
			await postBuildResult( {
				appId: job.appId,
				buildId: parseInt( job.id, 10 ) || undefined,
				status: 'complete',
				androidDownloadUrl,
			} );
		} catch ( reportErr ) {
			console.error( `Could not report success back to WordPress: ${ reportErr.message }` );
		}
	} catch ( err ) {
		console.error( `[job ${ job.id }] Android FAILED: ${ err.message }` );
		updateJob( job.id, { androidStatus: 'failed', error: err.message } );

		try {
			await postBuildResult( {
				appId: job.appId,
				buildId: parseInt( job.id, 10 ) || undefined,
				status: 'failed',
				errorMessage: err.message.slice( 0, 500 ),
			} );
		} catch ( reportErr ) {
			console.error( `Could not report failure back to WordPress: ${ reportErr.message }` );
		}
	}
}

async function runIOS( job ) {
	updateJob( job.id, { iosStatus: 'building' } );

	try {
		const iosResult = await scaffoldIOS( job );
		if ( iosResult.skipped ) {
			updateJob( job.id, { iosStatus: 'failed', iosNote: iosResult.reason } );
			console.log( `[job ${ job.id }] iOS skipped: ${ iosResult.reason }` );
		} else {
			updateJob( job.id, {
				iosStatus: 'complete',
				iosDownloadUrl: iosResult.iosDownloadUrl,
				iosNote: iosResult.manualStep,
			} );
			console.log( `[job ${ job.id }] iOS scaffolded. ${ iosResult.manualStep }` );
		}
	} catch ( err ) {
		console.error( `[job ${ job.id }] iOS FAILED (non-fatal to the job): ${ err.message }` );
		updateJob( job.id, { iosStatus: 'failed', iosNote: err.message } );
	}
}

async function runDesktop( job ) {
	updateJob( job.id, { desktopStatus: 'building' } );

	try {
		const desktopResult = await buildDesktop( job );
		updateJob( job.id, {
			desktopStatus: 'complete',
			desktopWindowsUrl: desktopResult.desktopWindowsUrl,
			desktopLinuxUrl: desktopResult.desktopLinuxUrl,
			desktopMacUrl: desktopResult.desktopMacUrl,
			desktopSourceUrl: desktopResult.desktopSourceUrl,
			desktopNote: desktopResult.desktopNote,
		} );
		console.log( `[job ${ job.id }] Desktop build done. ${ desktopResult.desktopNote }` );
	} catch ( err ) {
		console.error( `[job ${ job.id }] Desktop FAILED (non-fatal to the job): ${ err.message }` );
		updateJob( job.id, { desktopStatus: 'failed', desktopNote: err.message } );
	}
}

async function processOneJob( job ) {
	// rebuildTargets is set by the "Regenerate" button on a single platform;
	// a fresh job has it unset, meaning "run all three".
	const targets = job.rebuildTargets && job.rebuildTargets.length ? job.rebuildTargets : [ 'android', 'ios', 'desktop' ];

	console.log( `\n=== Processing job ${ job.id } (app #${ job.appId }, ${ job.buildType } build) — targets: ${ targets.join( ', ' ) } ===` );
	updateJob( job.id, { status: 'building' } );

	if ( targets.includes( 'android' ) ) {
		await runAndroid( job );
	}
	if ( targets.includes( 'ios' ) ) {
		await runIOS( job );
	}
	if ( targets.includes( 'desktop' ) ) {
		await runDesktop( job );
	}

	updateJob( job.id, { status: 'done', rebuildTargets: null } );
	console.log( `=== Job ${ job.id } done ===` );
}

async function tick() {
	if ( isBuilding ) {
		return;
	}

	const job = nextPendingJob();
	if ( ! job ) {
		return;
	}

	isBuilding = true;
	try {
		await processOneJob( job );
	} finally {
		isBuilding = false;
	}
}

console.log( 'Web to App Builder — worker started.' );
console.log( `Polling data/jobs.json every ${ POLL_INTERVAL_MS }ms.` );

if ( ! process.env.WP_SITE_URL || ! process.env.WTA_API_KEY ) {
	console.warn( 'WARNING: WP_SITE_URL / WTA_API_KEY are not set in .env.local — builds will run but results cannot be reported back to WordPress.' );
}

if ( ! process.env.ANDROID_HOME ) {
	console.warn( 'WARNING: ANDROID_HOME is not set — the Gradle build step will fail. See README.md.' );
}

setInterval( tick, POLL_INTERVAL_MS );
tick();
