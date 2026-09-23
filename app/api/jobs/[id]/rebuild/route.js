const { updateJob } = require( '../../../../../lib/jobStore' );

const VALID_PLATFORMS = [ 'android', 'ios', 'desktop' ];

// Rebuilds just ONE platform for this job — useful when e.g. Android built
// fine but Desktop failed, or the config changed and only one platform
// needs to reflect it.
export async function POST( request, { params } ) {
	let body;
	try {
		body = await request.json();
	} catch ( e ) {
		return Response.json( { error: 'Invalid JSON body.' }, { status: 400 } );
	}

	if ( ! VALID_PLATFORMS.includes( body.platform ) ) {
		return Response.json( { error: `platform must be one of: ${ VALID_PLATFORMS.join( ', ' ) }` }, { status: 400 } );
	}

	const job = updateJob( params.id, {
		status: 'pending',
		rebuildTargets: [ body.platform ],
		[ `${ body.platform }Status` ]: 'pending',
	} );

	if ( ! job ) {
		return Response.json( { error: 'Job not found.' }, { status: 404 } );
	}

	return Response.json( job );
}
