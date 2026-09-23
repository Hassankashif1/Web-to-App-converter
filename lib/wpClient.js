/**
 * Reports a job's outcome back to WordPress via the plugin's
 * /wta/v1/internal/build-result endpoint. Auth is the shared API key
 * header, not a WP user session — there is no human on this end.
 */
async function postBuildResult( { appId, buildId, status, androidDownloadUrl, iosDownloadUrl, errorMessage } ) {
	const siteUrl = ( process.env.WP_SITE_URL || '' ).replace( /\/$/, '' );
	const apiKey = process.env.WTA_API_KEY || '';

	if ( ! siteUrl || ! apiKey ) {
		throw new Error( 'WP_SITE_URL and WTA_API_KEY must be set in .env.local before results can be reported back.' );
	}

	const body = { appId, status };
	if ( undefined !== buildId ) body.buildId = buildId;
	if ( androidDownloadUrl ) body.androidDownloadUrl = androidDownloadUrl;
	if ( iosDownloadUrl ) body.iosDownloadUrl = iosDownloadUrl;
	if ( errorMessage ) body.errorMessage = errorMessage;

	const response = await fetch( `${ siteUrl }/wp-json/wta/v1/internal/build-result`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-WTA-API-Key': apiKey,
		},
		body: JSON.stringify( body ),
	} );

	if ( ! response.ok ) {
		const text = await response.text().catch( () => '' );
		throw new Error( `WordPress rejected the build result (HTTP ${ response.status }): ${ text }` );
	}

	return response.json();
}

module.exports = { postBuildResult };
