import fs from 'node:fs';
import path from 'node:path';
import { cancel, confirm, isCancel, multiselect, outro, spinner } from '@clack/prompts';
import color from 'chalk';
import { Command, program } from 'commander';
import { diffLines } from 'diff';
import { execa } from 'execa';
import type { ResolvedCommand } from 'package-manager-detector';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect } from 'package-manager-detector/detect';
import * as v from 'valibot';
import { context } from '..';
import { getConfig } from '../utils/config';
import { type RemoteBlock, resolveTree, getInstalled } from '../utils/blocks';
import { isTestFile } from '../utils/build';
import { formatDiff } from '../utils/diff';
import { getWatermark } from '../utils/get-watermark';
import * as gitProviders from '../utils/git-providers';
import { INFO } from '../utils/index';
import { OUTPUT_FILE } from '../utils/index';
import { languages } from '../utils/language-support';
import { type Task, intro, nextSteps, runTasks } from '../utils/prompts';
import * as ascii from '../utils/ascii';

const schema = v.object({
	yes: v.boolean(),
	all: v.boolean(),
	verbose: v.boolean(),
	repo: v.optional(v.string()),
	allow: v.boolean(),
	cwd: v.string(),
	expand: v.boolean(),
	maxUnchanged: v.number(),
});

type Options = v.InferInput<typeof schema>;

const update = new Command('update')
	.argument('[blocks...]', 'Names of the blocks you want to update. ex: (utils/math)')
	.option('-y, --yes', 'Skip confirmation prompt.', false)
	.option('--all', 'Update all installed components.', false)
	.option('-E, --expand', 'Expands the diff so you see everything.', false)
	.option('-A, --allow', 'Allow jsrepo to download code from the provided repo.', false)
	.option('--repo <repo>', 'Repository to download the blocks from.')
	.option(
		'--max-unchanged <number>',
		'Maximum unchanged lines that will show without being collapsed.',
		(val) => Number.parseInt(val), // this is such a dumb api thing
		3
	)
	.option('--verbose', 'Include debug logs.', false)
	.option('--cwd <path>', 'The current working directory.', process.cwd())
	.action(async (blockNames, opts) => {
		const options = v.parse(schema, opts);

		await _update(blockNames, options);
	});

const _update = async (blockNames: string[], options: Options) => {
	intro(context.package.version);

	const verbose = (msg: string) => {
		if (options.verbose) {
			console.info(`${INFO} ${msg}`);
		}
	};

	verbose(`Attempting to update ${JSON.stringify(blockNames)}`);

	const loading = spinner();

	const config = getConfig(options.cwd).match(
		(val) => val,
		(err) => program.error(color.red(err))
	);

	const blocksMap: Map<string, RemoteBlock> = new Map();

	let repoPaths = config.repos;

	// we just want to override all others if supplied via the CLI
	if (options.repo) repoPaths = [options.repo];

	// resolve repos for blocks
	for (const blockSpecifier of blockNames) {
		// we are only getting repos for blocks that specified repos
		if (blockSpecifier.startsWith('github')) {
			program.error(
				color.red(
					`Invalid value provided for block names \`${color.bold(blockSpecifier)}\`. Block names are expected to be provided in the format of \`${color.bold('<category>/<name>')}\``
				)
			);
		}
	}

	if (!options.allow && options.repo) {
		const result = await confirm({
			message: `Allow ${color.cyan('jsrepo')} to download and run code from ${color.cyan(options.repo)}?`,
			initialValue: true,
		});

		if (isCancel(result) || !result) {
			cancel('Canceled!');
			process.exit(0);
		}
	}

	verbose(`Fetching blocks from ${color.cyan(repoPaths.join(', '))}`);

	if (!options.verbose) loading.start(`Fetching blocks from ${color.cyan(repoPaths.join(', '))}`);

	// get blocks from each repo
	for (const repo of repoPaths) {
		const providerInfo: gitProviders.Info = (await gitProviders.getProviderInfo(repo)).match(
			(info) => info,
			(err) => {
				loading.stop(`Failed fetching blocks from ${color.cyan(repo)}`);
				program.error(color.red(err));
			}
		);

		const manifestUrl = await providerInfo.provider.resolveRaw(providerInfo, OUTPUT_FILE);

		verbose(`Got info for provider ${color.cyan(providerInfo.name)}`);

		const categories = (await gitProviders.getManifest(manifestUrl)).match(
			(val) => val,
			(err) => {
				loading.stop(`Failed fetching blocks from ${color.cyan(repo)}`);
				program.error(color.red(err));
			}
		);

		for (const category of categories) {
			for (const block of category.blocks) {
				blocksMap.set(
					`${providerInfo.name}/${providerInfo.owner}/${providerInfo.repoName}/${category.name}/${block.name}`,
					{
						...block,
						sourceRepo: providerInfo,
					}
				);
			}
		}
	}

	verbose(`Retrieved blocks from ${color.cyan(repoPaths.join(', '))}`);

	if (!options.verbose) loading.stop(`Retrieved blocks from ${color.cyan(repoPaths.join(', '))}`);

	const installedBlocks = getInstalled(blocksMap, config, options.cwd);

	let updatingBlockNames = blockNames;

	if (options.all) {
		updatingBlockNames = installedBlocks.map((block) => block.specifier);
	}

	// if no blocks are provided prompt the user for what blocks they want
	if (updatingBlockNames.length === 0) {
		const promptResult = await multiselect({
			message: 'Which blocks would you like to update?',
			options: installedBlocks.map((block) => {
				return {
					label: `${color.cyan(block.block.category)}/${block.block.name}`,
					value: block.specifier,
				};
			}),
			required: true,
		});

		if (isCancel(promptResult)) {
			cancel('Canceled!');
			process.exit(0);
		}

		updatingBlockNames = promptResult as string[];
	}

	verbose(`Preparing to update ${color.cyan(updatingBlockNames.join(', '))}`);

	const updatingBlocks = (await resolveTree(updatingBlockNames, blocksMap, repoPaths)).match(
		(val) => val,
		program.error
	);

	const pm = (await detect({ cwd: process.cwd() }))?.agent ?? 'npm';

	const tasks: Task[] = [];

	const devDeps: Set<string> = new Set<string>();
	const deps: Set<string> = new Set<string>();

	for (const { block } of updatingBlocks) {
		const fullSpecifier = `${block.sourceRepo.url}/${block.category}/${block.name}`;

		const watermark = getWatermark(context.package.version, block.sourceRepo.url);

		const providerInfo = block.sourceRepo;

		verbose(`Attempting to add ${fullSpecifier}`);

		const directory = path.join(options.cwd, config.path, block.category);

		const files: { content: string; destPath: string; fileName: string }[] = [];

		const getSourceFile = async (filePath: string): Promise<string> => {
			const rawUrl = await providerInfo.provider.resolveRaw(providerInfo, filePath);

			const response = await fetch(rawUrl);

			if (!response.ok) {
				loading.stop(color.red(`Error fetching ${color.bold(rawUrl.href)}`));
				program.error(color.red(`There was an error trying to get ${fullSpecifier}`));
			}

			return await response.text();
		};

		for (const sourceFile of block.files) {
			if (!config.includeTests && isTestFile(sourceFile)) continue;

			const sourcePath = path.join(block.directory, sourceFile);

			let destPath: string;
			if (block.subdirectory) {
				destPath = path.join(directory, block.name, sourceFile);
			} else {
				destPath = path.join(directory, sourceFile);
			}

			const content = await getSourceFile(sourcePath);

			fs.mkdirSync(destPath.slice(0, destPath.length - sourceFile.length), {
				recursive: true,
			});

			files.push({ content, destPath, fileName: sourceFile });
		}

		process.stdout.write(`${ascii.VERTICAL_LINE}\n`);

		process.stdout.write(`${ascii.VERTICAL_LINE}  ${fullSpecifier}\n`);

		for (const file of files) {
			let remoteContent: string = file.content;

			if (config.watermark) {
				const lang = languages.find((lang) => lang.matches(file.destPath));

				if (lang) {
					const comment = lang.comment(watermark);

					remoteContent = `${comment}\n\n${remoteContent}`;
				}
			}

			let acceptedChanges = options.yes;

			if (!options.yes) {
				process.stdout.write(`${ascii.VERTICAL_LINE}\n`);

				let localContent = '';
				if (fs.existsSync(file.destPath)) {
					localContent = fs.readFileSync(file.destPath).toString();
				}

				const changes = diffLines(localContent, remoteContent);

				const from = path
					.join(
						`${providerInfo.name}/${providerInfo.owner}/${providerInfo.repoName}`,
						file.fileName
					)
					.replaceAll('\\', '/');

				const to = path.relative(options.cwd, file.destPath).replaceAll('\\', '/');

				const formattedDiff = formatDiff({
					from,
					to,
					changes,
					expand: options.expand,
					maxUnchanged: options.maxUnchanged,
					colorAdded: color.greenBright,
					colorRemoved: color.redBright,
					colorCharsAdded: color.bgGreenBright,
					colorCharsRemoved: color.bgRedBright,
					prefix: () => `${ascii.VERTICAL_LINE}  `,
					onUnchanged: ({ from, to, prefix }) =>
						`${prefix?.() ?? ''}${color.cyan(from)} → ${color.gray(to)} ${color.gray('(unchanged)')}\n`,
					intro: ({ from, to, changes, prefix }) => {
						const totalChanges = changes.filter((a) => a.added).length;

						return `${prefix?.() ?? ''}${color.cyan(from)} → ${color.gray(to)} (${totalChanges} change${
							totalChanges === 1 ? '' : 's'
						})\n${prefix?.() ?? ''}\n`;
					},
				});

				process.stdout.write(formattedDiff);

				// if there are no changes then don't ask
				if (changes.length > 1) {
					const confirmResult = await confirm({
						message: 'Accept changes?',
						initialValue: true,
					});

					if (isCancel(confirmResult)) {
						cancel('Canceled!');
						process.exit(0);
					}

					acceptedChanges = confirmResult;
				}
			}

			if (acceptedChanges) {
				loading.start(`Writing changes to ${color.cyan(file.destPath)}`);
				fs.writeFileSync(file.destPath, remoteContent);
				loading.stop(`Wrote changes to ${color.cyan(file.destPath)}.`);
			}
		}

		if (config.includeTests) {
			verbose('Trying to include tests');

			const { devDependencies } = JSON.parse(
				fs.readFileSync(path.join(options.cwd, 'package.json')).toString()
			);

			if (devDependencies.vitest === undefined) {
				devDeps.add('vitest');
			}
		}

		for (const dep of block.devDependencies) {
			devDeps.add(dep);
		}

		for (const dep of block.dependencies) {
			deps.add(dep);
		}
	}

	await runTasks(tasks, { verbose: options.verbose });

	const installDependencies = async (deps: string[], dev: boolean) => {
		if (!options.verbose) loading.start(`Installing dependencies with ${color.cyan(pm)}`);

		let add: ResolvedCommand | null;
		if (dev) {
			add = resolveCommand(pm, 'install', [...deps, '-D']);
		} else {
			add = resolveCommand(pm, 'install', [...deps]);
		}

		if (add == null) {
			program.error(color.red(`Could not resolve add command for '${pm}'.`));
		}

		try {
			await execa(add.command, [...add.args], { cwd: options.cwd });
		} catch {
			program.error(
				color.red(
					`Failed to install ${color.bold('vitest')}! Failed while running '${color.bold(
						`${add.command} ${add.args.join(' ')}`
					)}'`
				)
			);
		}

		if (!options.verbose) loading.stop(`Installed ${color.cyan(deps.join(', '))}`);
	};

	const hasDependencies = deps.size > 0 || devDeps.size > 0;

	if (hasDependencies) {
		let install = options.yes;
		if (!options.yes) {
			const result = await confirm({
				message: 'Would you like to install dependencies?',
				initialValue: true,
			});

			if (isCancel(result)) {
				cancel('Canceled!');
				process.exit(0);
			}

			install = result;
		}

		if (install) {
			if (deps.size > 0) {
				await installDependencies(Array.from(deps), false);
			}

			if (devDeps.size > 0) {
				await installDependencies(Array.from(devDeps), true);
			}
		}

		// next steps if they didn't install dependencies
		let steps = [];

		if (!install) {
			if (deps.size > 0) {
				const cmd = resolveCommand(pm, 'install', [...deps]);

				steps.push(
					`Install dependencies \`${color.cyan(`${cmd?.command} ${cmd?.args.join(' ')}`)}\``
				);
			}

			if (devDeps.size > 0) {
				const cmd = resolveCommand(pm, 'install', [...devDeps, '-D']);

				steps.push(
					`Install dev dependencies \`${color.cyan(`${cmd?.command} ${cmd?.args.join(' ')}`)}\``
				);
			}
		}

		// put steps with numbers above here
		steps = steps.map((step, i) => `${i + 1}. ${step}`);

		if (!install) {
			steps.push('');
		}

		steps.push(`Import the blocks from \`${color.cyan(config.path)}\``);

		const next = nextSteps(steps);

		process.stdout.write(next);
	}

	outro(color.green('All done!'));
};

export { update };
