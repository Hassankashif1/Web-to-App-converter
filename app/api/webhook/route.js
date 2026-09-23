const { addJob } = require( '../../../lib/jobStore' );

function isAuthorized( request ) {
	const configured = process.env.WTA_API_KEY || '';
	const provided = request.headers.get( 'x-wta-api-key' ) || '';
	return '' !== configured && configured === provided;
}

export async function POST( request ) {
	if ( ! isAuthorized( request ) ) {
		return Response.json( { error: 'Invalid or missing X-WTA-API-Key header.' }, { status: 401 } );
	}

	let payload;
	try {
		payload = await request.json();
	} catch ( e ) {
		return Response.json( { error: 'Invalid JSON body.' }, { status: 400 } );
	}

	if ( ! payload.appId || ! payload.buildId ) {
		return Response.json( { error: 'Payload must include appId and buildId.' }, { status: 400 } );
	}

	const job = addJob( payload );

	return Response.json( { received: true, jobId: job.id }, { status: 202 } );
}
