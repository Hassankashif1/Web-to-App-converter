const fs = require( 'fs' );
const path = require( 'path' );
const { deleteJob } = require( '../../../../lib/jobStore' );

const BUILDS_DIR = path.join( process.cwd(), 'builds' );
const DOWNLOADS_DIR = path.join( process.cwd(), 'public', 'downloads' );

export async function DELETE( request, { params } ) {
	const job = deleteJob( params.id );

	if ( ! job ) {
		return Response.json( { error: 'Job not found.' }, { status: 404 } );
	}

	// Best-effort cleanup of everything this job produced on disk.
	try {
		fs.rmSync( path.join( BUILDS_DIR, params.id ), { recursive: true, force: true } );
	} catch ( e ) { /* ignore */ }

	try {
		for ( const file of fs.readdirSync( DOWNLOADS_DIR ) ) {
			if ( file === `${ params.id }.apk` || file.startsWith( `${ params.id }-` ) ) {
				fs.rmSync( path.join( DOWNLOADS_DIR, file ), { force: true } );
			}
		}
	} catch ( e ) { /* ignore */ }

	return Response.json( { deleted: true, id: params.id } );
}
