const fs = require( 'fs' );
const path = require( 'path' );

const UPLOADS_DIR = path.join( process.cwd(), 'public', 'uploads' );

export async function POST( request ) {
	let body;
	try {
		body = await request.json();
	} catch ( e ) {
		return Response.json( { error: 'Invalid JSON body.' }, { status: 400 } );
	}

	const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec( body.data || '' );
	if ( ! match ) {
		return Response.json( { error: 'data must be a base64 image data URL (png/jpeg/webp/gif).' }, { status: 400 } );
	}

	const ext = match[ 2 ] === 'jpeg' ? 'jpg' : match[ 2 ];
	const buffer = Buffer.from( match[ 3 ], 'base64' );

	fs.mkdirSync( UPLOADS_DIR, { recursive: true } );
	const fileName = `${ Date.now() }-${ Math.random().toString( 36 ).slice( 2, 8 ) }.${ ext }`;
	fs.writeFileSync( path.join( UPLOADS_DIR, fileName ), buffer );

	const baseUrl = ( process.env.SELF_BASE_URL || 'http://localhost:4000' ).replace( /\/$/, '' );

	return Response.json( { url: `${ baseUrl }/uploads/${ fileName }` }, { status: 201 } );
}
