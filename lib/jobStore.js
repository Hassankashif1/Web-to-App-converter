const fs = require( 'fs' );
const path = require( 'path' );

const DATA_DIR = path.join( process.cwd(), 'data' );
const JOBS_FILE = path.join( DATA_DIR, 'jobs.json' );

function ensureStore() {
	if ( ! fs.existsSync( DATA_DIR ) ) {
		fs.mkdirSync( DATA_DIR, { recursive: true } );
	}
	if ( ! fs.existsSync( JOBS_FILE ) ) {
		fs.writeFileSync( JOBS_FILE, '[]', 'utf8' );
	}
}

/**
 * Reads are always fresh off disk (no in-memory cache) so the Next.js
 * process and the separate worker.js process always agree on state.
 */
function readJobs() {
	ensureStore();
	try {
		const raw = fs.readFileSync( JOBS_FILE, 'utf8' );
		const parsed = JSON.parse( raw );
		return Array.isArray( parsed ) ? parsed : [];
	} catch ( e ) {
		return [];
	}
}

function writeJobs( jobs ) {
	ensureStore();
	// Write to a temp file then rename, so a crash mid-write can't corrupt jobs.json.
	const tmp = JOBS_FILE + '.tmp';
	fs.writeFileSync( tmp, JSON.stringify( jobs, null, 2 ), 'utf8' );
	fs.renameSync( tmp, JOBS_FILE );
}

/**
 * Adds a job from an incoming WordPress webhook payload. buildId from
 * WordPress becomes this job's id (it's already unique per build request).
 */
function addJob( payload ) {
	const jobs = readJobs();

	const job = {
		id: String( payload.buildId ),
		appId: payload.appId,
		userId: payload.userId,
		buildType: payload.buildType || 'test',
		packageId: payload.packageId || '',
		configuration: payload.configuration || {},
		// Overall queue state — only describes whether the worker is still
		// touching this job at all. Per-platform outcomes live below and are
		// what the UI should actually show as "complete"/"failed".
		status: 'pending', // pending -> building -> done
		// rebuildTargets: null means "run all three platforms" (a fresh job).
		// Set to e.g. ['ios'] to have the worker only (re)run that one platform.
		rebuildTargets: null,
		androidStatus: 'pending', // pending -> building -> complete | failed
		iosStatus: 'pending',
		desktopStatus: 'pending',
		error: null,
		androidDownloadUrl: null,
		iosDownloadUrl: null,
		iosNote: null,
		desktopWindowsUrl: null,
		desktopSourceUrl: null,
		desktopNote: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};

	jobs.unshift( job );
	writeJobs( jobs );
	return job;
}

function updateJob( id, patch ) {
	const jobs = readJobs();
	const index = jobs.findIndex( ( j ) => j.id === String( id ) );

	if ( -1 === index ) {
		return null;
	}

	jobs[ index ] = { ...jobs[ index ], ...patch, updatedAt: new Date().toISOString() };
	writeJobs( jobs );
	return jobs[ index ];
}

function getJob( id ) {
	return readJobs().find( ( j ) => j.id === String( id ) ) || null;
}

function deleteJob( id ) {
	const jobs = readJobs();
	const index = jobs.findIndex( ( j ) => j.id === String( id ) );

	if ( -1 === index ) {
		return null;
	}

	const [ removed ] = jobs.splice( index, 1 );
	writeJobs( jobs );
	return removed;
}

function nextPendingJob() {
	return readJobs().find( ( j ) => 'pending' === j.status ) || null;
}

/**
 * There's no login system — each browser gets a random id (see /api/me) and
 * only ever sees its own jobs. Jobs created before that existed have no
 * userId at all; the first browser to show up after this shipped "claims"
 * them, so the person who was already using this tool doesn't lose their
 * own build history.
 */
function claimLegacyJobs( ownerId ) {
	const jobs = readJobs();
	let claimed = 0;

	for ( const job of jobs ) {
		if ( ! job.userId ) {
			job.userId = ownerId;
			claimed++;
		}
	}

	if ( claimed > 0 ) {
		writeJobs( jobs );
	}
	return claimed;
}

module.exports = { readJobs, writeJobs, addJob, updateJob, getJob, deleteJob, nextPendingJob, claimLegacyJobs };
