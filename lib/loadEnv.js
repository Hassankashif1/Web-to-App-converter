const fs = require( 'fs' );
const path = require( 'path' );

function loadEnv() {
	const candidates = [ '.env.local', '.env' ];

	for ( const file of candidates ) {
		const fullPath = path.join( process.cwd(), file );

		if ( ! fs.existsSync( fullPath ) ) {
			continue;
		}

		const contents = fs.readFileSync( fullPath, 'utf8' );

		contents.split( '\n' ).forEach( ( line ) => {
			const trimmed = line.trim();

			if ( '' === trimmed || trimmed.startsWith( '#' ) ) {
				return;
			}

			const eq = trimmed.indexOf( '=' );
			if ( eq === -1 ) {
				return;
			}

			const key = trimmed.slice( 0, eq ).trim();
			let value = trimmed.slice( eq + 1 ).trim();

			// Strip matching surrounding quotes, if any.
			if ( ( value.startsWith( '"' ) && value.endsWith( '"' ) ) || ( value.startsWith( "'" ) && value.endsWith( "'" ) ) ) {
				value = value.slice( 1, -1 );
			}

			if ( undefined === process.env[ key ] ) {
				process.env[ key ] = value;
			}
		} );
	}
}

module.exports = { loadEnv };
