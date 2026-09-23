const { claimLegacyJobs } = require( '../../../../lib/jobStore' );

// Called once by a browser the very first time it generates its local
// "owner id" — adopts any jobs that predate per-browser ownership so the
// person already using this tool doesn't see their own history vanish.
export async function POST( request ) {
	let body;
	try {
		body = await request.json();
	} catch ( e ) {
		return Response.json( { error: 'Invalid JSON body.' }, { status: 400 } );
	}

	if ( ! body.ownerId ) {
		return Response.json( { error: 'ownerId is required.' }, { status: 400 } );
	}

	const claimed = claimLegacyJobs( body.ownerId );
	return Response.json( { claimed } );
}
