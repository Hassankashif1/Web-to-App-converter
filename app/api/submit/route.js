const { addJob } = require( '../../../lib/jobStore' );

export async function POST( request ) {
	let body;
	try {
		body = await request.json();
	} catch ( e ) {
		return Response.json( { error: 'Invalid JSON body.' }, { status: 400 } );
	}

	if ( ! body.websiteUrl ) {
		return Response.json( { error: 'websiteUrl is required.' }, { status: 400 } );
	}

	const job = addJob( {
		appId: body.appId || 'local',
		userId: body.ownerId || null,
		buildId: Date.now(),
		buildType: body.buildType || 'test',
		packageId: body.packageId || '',
		configuration: {
			appName: body.appName || 'My App',
			websiteUrl: body.websiteUrl,
			appIcon: body.appIcon || '',
			appIconSize: body.appIconSize || 100,
			offlineGameEnabled: false !== body.offlineGameEnabled,
			preloader: {
				enabled: false !== body.preloaderEnabled,
				logo: body.logo || '',
				logoSize: body.logoSize || 120,
				backgroundColor: body.backgroundColor || '#ffffff',
				loaderType: body.loaderType || 'spinner',
				loaderColor: body.loaderColor || '#1773b0',
				loaderSize: body.loaderSize || 40,
				animationSpeed: body.animationSpeed || 1,
				minDuration: undefined === body.minDuration ? 1.5 : body.minDuration,
			},
		},
	} );

	return Response.json( { received: true, jobId: job.id }, { status: 202 } );
}
