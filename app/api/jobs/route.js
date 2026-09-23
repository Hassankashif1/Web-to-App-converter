const { readJobs } = require( '../../../lib/jobStore' );

export async function GET() {
	return Response.json( readJobs() );
}
