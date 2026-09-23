const { updateJob } = require( '../../../../../lib/jobStore' );

// Rebuilds ALL platforms for this job from scratch.
export async function POST( request, { params } ) {
	const job = updateJob( params.id, {
		status: 'pending',
		rebuildTargets: null,
		error: null,
		androidStatus: 'pending',
		iosStatus: 'pending',
		desktopStatus: 'pending',
	} );

	if ( ! job ) {
		return Response.json( { error: 'Job not found.' }, { status: 404 } );
	}

	return Response.json( job );
}
