export type Category = {
	name: string;
	routes: Route[];
};

export type Route = {
	name: string;
	href: string;
	activeForSubdirectories?: boolean;
	hide?: boolean;
	routes?: Route[];
};

const categories: Category[] = [
	{
		name: 'routes',
		routes: [
			{
				name: 'Home',
				href: '/'
			},
			{
				name: 'Docs',
				href: '/docs'
			}
		]
	},
	{
		name: 'Getting Started',
		routes: [
			{
				name: 'Introduction',
				href: '/docs'
			},
			{
				name: 'Setup',
				href: '/docs/setup',
				activeForSubdirectories: true,
				routes: [
					{
						name: 'Project Setup',
						href: '/docs/setup/project'
					},
					{
						name: 'Registry Setup',
						href: '/docs/setup/registry'
					}
				]
			},
			{
				name: 'CLI',
				href: '/docs/cli'
			}
		]
	}
];

export { categories };
