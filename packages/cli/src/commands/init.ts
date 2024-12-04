import fs from 'node:fs';
import {
	cancel,
	confirm,
	isCancel,
	multiselect,
	outro,
	password,
	select,
	spinner,
	text,
} from '@clack/prompts';
import color from 'chalk';
import { Command, Option, program } from 'commander';
import { detect, resolveCommand } from 'package-manager-detector';
import path from 'pathe';
import * as v from 'valibot';
import { context } from '..';
import * as ascii from '../utils/ascii';
import {
	type Formatter,
	PROJECT_CONFIG_NAME,
	type Paths,
	type ProjectConfig,
	REGISTRY_CONFIG_NAME,
	formatterSchema,
	getProjectConfig,
	getRegistryConfig,
} from '../utils/config';
import { installDependencies } from '../utils/dependencies';
import { loadFormatterConfig } from '../utils/format';
import { providers } from '../utils/git-providers';
import { json } from '../utils/language-support';
import * as persisted from '../utils/persisted';
import { type Task, intro, nextSteps, runTasks } from '../utils/prompts';

const schema = v.object({
	path: v.optional(v.string()),
	repos: v.optional(v.array(v.string())),
	watermark: v.boolean(),
	tests: v.optional(v.boolean()),
	formatter: v.optional(formatterSchema),
	project: v.optional(v.boolean()),
	registry: v.optional(v.boolean()),
	script: v.string(),
	yes: v.boolean(),
	cwd: v.string(),
});

type Options = v.InferInput<typeof schema>;

const init = new Command('init')
	.description('Initializes your project with a configuration file.')
	.option('--path <path>', 'Path to install the blocks from.')
	.option('--repos [repos...]', 'Repository to install the blocks from.')
	.option(
		'--no-watermark',
		'Will not add a watermark to each file upon adding it to your project.'
	)
	.option('--tests', 'Will include tests with the blocks.')
	.addOption(
		new Option(
			'--formatter <formatter>',
			'What formatter to use when adding or updating blocks.'
		).choices(['prettier', 'biome'])
	)
	.option('-P, --project', 'Takes you through the steps to initialize a project.')
	.option('-R, --registry', 'Takes you through the steps to initialize a registry.')
	.option(
		'--script <name>',
		'The name of the build script. (For Registry setup)',
		'build:registry'
	)
	.option('-y, --yes', 'Skip confirmation prompt.', false)
	.option('--cwd <path>', 'The current working directory.', process.cwd())
	.action(async (opts) => {
		const options = v.parse(schema, opts);

		intro(context.package.version);

		if (options.registry !== undefined && options.project !== undefined) {
			program.error(
				color.red(
					`You cannot provide both ${color.bold('--project')} and ${color.bold('--registry')} at the same time.`
				)
			);
		}

		if (options.registry === undefined && options.project === undefined) {
			const response = await select({
				message: 'Initialize a project or registry?',
				options: [
					{ value: 'project', label: 'project' },
					{ value: 'registry', label: 'registry' },
				],
				initialValue: 'project',
			});

			if (isCancel(response)) {
				cancel('Canceled!');
				process.exit(0);
			}

			options.registry = response === 'registry';
		}

		if (options.registry) {
			await _initRegistry(options);
		} else {
			await _initProject(options);
		}

		outro(color.green('All done!'));
	});

const _initProject = async (options: Options) => {
	const storage = persisted.get();

	const initialConfig = getProjectConfig(options.cwd);

	const loading = spinner();

	let paths: Paths;

	const defaultPathResult = await text({
		message: 'Please enter a default path to install the blocks',
		validate(value) {
			if (value.trim() === '') return 'Please provide a value';
		},
		initialValue: initialConfig.isOk() ? initialConfig.unwrap().paths['*'] : './src/blocks',
	});

	if (isCancel(defaultPathResult)) {
		cancel('Canceled!');
		process.exit(0);
	}

	if (initialConfig.isOk()) {
		paths = { ...initialConfig.unwrap().paths, '*': defaultPathResult };
	} else {
		paths = { '*': defaultPathResult };
	}

	if (!options.repos) {
		options.repos = initialConfig.isOk() ? initialConfig.unwrap().repos : [];

		while (true) {
			const confirmResult = await confirm({
				message: `Add ${options.repos.length > 0 ? 'another' : 'a'} repo?`,
				initialValue: options.repos.length === 0, // default to yes for first repo
			});

			if (isCancel(confirmResult)) {
				cancel('Canceled!');
				process.exit(0);
			}

			if (!confirmResult) break;

			const result = await text({
				message: 'Where should we download the blocks from?',
				placeholder: 'github/ieedan/std',
				validate: (val) => {
					if (val.trim().length === 0) return 'Please provide a value';

					if (!providers.find((provider) => provider.matches(val))) {
						return `Invalid provider! Valid providers (${providers.map((provider) => provider.name()).join(', ')})`;
					}
				},
			});

			if (isCancel(result)) {
				cancel('Canceled!');
				process.exit(0);
			}

			const provider = providers.find((p) => p.matches(result));

			if (!provider) {
				program.error(color.red('Invalid provider!'));
			}

			const tokenKey = `${provider.name()}-token`;

			const token = storage.get(tokenKey);

			if (!token) {
				const result = await confirm({
					message: 'Would you like to add an auth token?',
					initialValue: false,
				});

				if (isCancel(result)) {
					cancel('Canceled!');
					process.exit(0);
				}

				if (result) {
					const response = await password({
						message: 'Paste your token',
						validate(value) {
							if (value.trim() === '') return 'Please provide a value';
						},
					});

					if (isCancel(response)) {
						cancel('Canceled!');
						process.exit(0);
					}

					storage.set(tokenKey, response);
				}
			}

			loading.start(`Fetching categories from ${color.cyan(result)}`);

			const manifestResult = await provider.fetchManifest(result);

			loading.stop(`Fetched categories from ${color.cyan(result)}`);

			if (manifestResult.isErr()) {
				program.error(color.red(manifestResult.unwrapErr()));
			}

			const categories = manifestResult.unwrap();

			const configurePaths = await multiselect({
				message: 'Which category paths would you like to configure?',
				options: categories.map((cat) => ({ label: cat.name, value: cat.name })),
				required: false,
			});

			if (isCancel(configurePaths)) {
				cancel('Canceled!');
				process.exit(0);
			}

			if (configurePaths.length > 0) {
				for (const category of configurePaths) {
					const configuredValue = paths[category];

					const categoryPath = await text({
						message: `Where should ${category} be added in your project?`,
						validate(value) {
							if (value.trim() === '') return 'Please provide a value';
						},
						placeholder: configuredValue ? configuredValue : `./src/${category}`,
						defaultValue: configuredValue,
						initialValue: configuredValue,
					});

					if (isCancel(categoryPath)) {
						cancel('Canceled!');
						process.exit(0);
					}

					paths[category] = categoryPath;
				}
			}

			options.repos.push(result);
		}
	}

	if (!options.formatter) {
		let defaultFormatter = initialConfig.isErr()
			? 'none'
			: (initialConfig.unwrap().formatter ?? 'none');

		if (fs.existsSync(path.join(options.cwd, '.prettierrc'))) {
			defaultFormatter = 'prettier';
		}

		if (fs.existsSync(path.join(options.cwd, 'biome.json'))) {
			defaultFormatter = 'biome';
		}

		const response = await select({
			message: 'What formatter would you like to use?',
			options: ['Prettier', 'Biome', 'None'].map((val) => ({
				value: val.toLowerCase(),
				label: val,
			})),
			initialValue: defaultFormatter,
		});

		if (isCancel(response)) {
			cancel('Canceled!');
			process.exit(0);
		}

		if (response !== 'none') {
			options.formatter = response as Formatter;
		}
	}

	const config: ProjectConfig = {
		$schema: `https://unpkg.com/jsrepo@${context.package.version}/schemas/project-config.json`,
		repos: options.repos,
		includeTests:
			initialConfig.isOk() && options.tests === undefined
				? initialConfig.unwrap().includeTests
				: (options.tests ?? false),
		watermark: options.watermark,
		formatter: options.formatter,
		paths,
	};

	loading.start(`Writing config to \`${PROJECT_CONFIG_NAME}\``);

	const { prettierOptions, biomeOptions } = await loadFormatterConfig({
		formatter: config.formatter,
		cwd: options.cwd,
	});

	const configPath = path.join(options.cwd, PROJECT_CONFIG_NAME);

	const configContent = await json.format(JSON.stringify(config, null, '\t'), {
		biomeOptions,
		prettierOptions,
		filePath: configPath,
		formatter: config.formatter,
	});

	fs.writeFileSync(configPath, configContent);

	loading.stop(`Wrote config to \`${PROJECT_CONFIG_NAME}\`.`);
};

const _initRegistry = async (options: Options) => {
	const loading = spinner();

	const packagePath = path.join(options.cwd, 'package.json');

	if (!fs.existsSync(packagePath)) {
		program.error(color.red(`Couldn't find your ${color.bold('package.json')}!`));
	}

	let config = getRegistryConfig(options.cwd).match(
		(val) => val,
		(err) => program.error(color.red(err))
	);

	const noConfig = config === null;

	if (!config) {
		config = {
			$schema: `https://unpkg.com/jsrepo@${context.package.version}/schemas/project-config.json`,
			dirs: [],
			doNotListBlocks: [],
			doNotListCategories: [],
			excludeDeps: [],
			includeBlocks: [],
			includeCategories: [],
			errorOnWarn: false,
			output: true,
		};
	}

	while (true) {
		if (config.dirs.length > 0) {
			const confirmResult = await confirm({
				message: 'Add another blocks directory?',
				initialValue: false,
			});

			if (isCancel(confirmResult)) {
				cancel('Canceled!');
				process.exit(0);
			}

			if (!confirmResult) break;
		}

		const response = await text({
			message: 'Where are your blocks located?',
			placeholder: './src',
		});

		if (isCancel(response)) {
			cancel('Canceled!');
			process.exit(0);
		}

		config.dirs.push(response);
	}

	const pkg = JSON.parse(fs.readFileSync(packagePath).toString());

	// continue asking until the user either chooses to overwrite or inputs a script that doesn't exist yet
	while (!options.yes && pkg.scripts && pkg.scripts[options.script]) {
		const response = await confirm({
			message: `The \`${color.cyan(options.script)}\` already exists overwrite?`,
			initialValue: false,
		});

		if (isCancel(response)) {
			cancel('Canceled!');
			process.exit(0);
		}

		if (!response) {
			const response = await text({
				message: 'What would you like to call the script?',
				placeholder: 'build:registry',
				validate: (val) => {
					if (val.trim().length === 0) return 'Please provide a value!';
				},
			});

			if (isCancel(response)) {
				cancel('Canceled!');
				process.exit(0);
			}

			options.script = response;
		} else {
			break;
		}
	}

	const alreadyInstalled = pkg.devDependencies && pkg.devDependencies.jsrepo !== undefined;

	let installAsDevDependency = options.yes || alreadyInstalled;

	if (!options.yes && !alreadyInstalled) {
		const response = await confirm({
			message: `Add ${ascii.JSREPO} as a dev dependency?`,
			initialValue: true,
		});

		if (isCancel(response)) {
			cancel('Canceled!');
			process.exit(0);
		}

		installAsDevDependency = response;
	}

	let jsonConfig = !noConfig;

	if (!options.yes && noConfig) {
		const response = await confirm({
			message: `Create a \`${color.cyan(REGISTRY_CONFIG_NAME)}\` file?`,
			initialValue: true,
		});

		if (isCancel(response)) {
			cancel('Canceled!');
			process.exit(0);
		}

		jsonConfig = response;
	}

	const pm = (await detect({ cwd: 'cwd' }))?.agent ?? 'npm';

	let buildScript = '';

	if (installAsDevDependency) {
		buildScript += 'jsrepo build';
	} else {
		const command = resolveCommand(pm, 'execute', ['jsrepo', 'build']);

		if (!command) program.error(color.red(`Error resolving execute command for ${pm}`));

		buildScript += `${command.command} ${command.args.join(' ')} `;
	}

	// if we aren't using a config file configure the command with the correct flags
	if (!jsonConfig) {
		buildScript += ` --dirs ${config.dirs.join(' ')} `;
	}

	// ensure we are adding to an object that exists
	if (pkg.scripts === undefined) {
		pkg.scripts = {};
	}

	pkg.scripts[options.script] = buildScript;

	const tasks: Task[] = [];

	tasks.push({
		loadingMessage: `Adding \`${color.cyan(options.script)}\` to scripts in package.json`,
		completedMessage: `Added \`${color.cyan(options.script)}\` to scripts in package.json`,
		run: async () => {
			try {
				fs.writeFileSync(packagePath, JSON.stringify(pkg, null, '\t'));
			} catch (err) {
				program.error(
					color.red(`Error writing to \`${color.bold(packagePath)}\`. Error: ${err}`)
				);
			}
		},
	});

	if (jsonConfig) {
		tasks.push({
			loadingMessage: `Writing config to \`${color.cyan(REGISTRY_CONFIG_NAME)}\``,
			completedMessage: `Wrote config to \`${color.cyan(REGISTRY_CONFIG_NAME)}\``,
			run: async () => {
				const configPath = path.join(options.cwd, REGISTRY_CONFIG_NAME);

				try {
					fs.writeFileSync(path.join(configPath), JSON.stringify(config, null, '\t'));
				} catch (err) {
					program.error(
						color.red(`Error writing to \`${color.bold(configPath)}\`. Error: ${err}`)
					);
				}
			},
		});
	}

	await runTasks(tasks, {});

	let installed = alreadyInstalled;

	if (installAsDevDependency && !alreadyInstalled) {
		let shouldInstall = options.yes;
		if (!options.yes) {
			const response = await confirm({
				message: 'Install dependencies?',
				initialValue: true,
			});

			if (isCancel(response)) {
				cancel('Canceled!');
				process.exit(0);
			}

			shouldInstall = response;
		}

		if (shouldInstall) {
			loading.start(`Installing ${ascii.JSREPO}`);

			const installedResult = await installDependencies({
				pm,
				deps: ['jsrepo'],
				dev: true,
				cwd: options.cwd,
			});

			installedResult.match(
				() => loading.stop(`Installed ${ascii.JSREPO}.`),
				(err) => {
					loading.stop(`Failed to install ${ascii.JSREPO}.`);
					program.error(err);
				}
			);

			installed = true;
		}
	}

	let steps: string[] = [];

	if (!installed && installAsDevDependency) {
		const cmd = resolveCommand(pm, 'install', ['jsrepo', '-D']);

		steps.push(
			`Install ${ascii.JSREPO} as a dev dependency \`${color.cyan(`${cmd?.command} ${cmd?.args.join(' ')}`)}\``
		);
	}

	steps.push(`Add categories to \`${color.cyan(config.dirs.join(', '))}\`.`);

	const runScript = resolveCommand(pm, 'run', [options.script]);

	steps.push(
		`Run \`${color.cyan(`${runScript?.command} ${runScript?.args.join(' ')}`)}\` to build the registry.`
	);

	// put steps with numbers above here
	steps = steps.map((step, i) => `${i + 1}. ${step}`);

	const next = nextSteps(steps);

	process.stdout.write(next);
};

export { init };
