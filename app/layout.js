export const metadata = {
	title: 'Web to App Builder — Build Server',
};

export default function RootLayout( { children } ) {
	return (
		<html lang="en">
			<body style={ { margin: 0, fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif', background: '#f6f8fb', color: '#1c2733' } }>
				{ children }
			</body>
		</html>
	);
}
