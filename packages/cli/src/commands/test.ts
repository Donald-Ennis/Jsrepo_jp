import fs from 'node:fs';
import { cancel, confirm, isCancel, outro, spinner } from '@clack/prompts';
import color from 'chalk';
import { Argument, Command, program } from 'commander';
import { execa } from 'execa';
import { resolveCommand } from 'package-manager-detector/commands';
import { detect } from 'package-manager-detector/detect';
import path from 'pathe';
import { Project } from 'ts-morph';
import * as v from 'valibot';
import { context } from '../cli';
import * as ascii from '../utils/ascii';
import { getInstalled } from '../utils/blocks';
import * as url from '../utils/blocks/utils/url';
import { isTestFile } from '../utils/build';
import { getPathForBlock, getProjectConfig, resolvePaths } from '../utils/config';
import { intro } from '../utils/prompts';
import * as registry from '../utils/registry-providers/internal';

const schema = v.object({
	repo: v.optional(v.string()),
	allow: v.boolean(),
	debug: v.boolean(),
	verbose: v.boolean(),
	cwd: v.string(),
});

type Options = v.InferInput<typeof schema>;

const test = new Command('test')
	.description('Tests local blocks against most recent remote tests.')
	.addArgument(new Argument('[blocks...]', 'The blocks you want to test.').default([]))
	.option('--repo <repo>', 'Repository to download the blocks from.')
	.option('-A, --allow', 'Allow jsrepo to download code from the provided repo.', false)
	.option('--debug', 'Leaves the temp test file around for debugging upon failure.', false)
	.option('--verbose', 'Include debug logs.', false)
	.option('--cwd <path>', 'The current working directory.', process.cwd())
	.action(async (blockNames, opts) => {
		const options = v.parse(schema, opts);

		intro(context);

		await _test(blockNames, options);

		outro(color.green('All done!'));
	});

const _test = async (blockNames: string[], options: Options) => {
	const verbose = (msg: string) => {
		if (options.verbose) {
			console.info(`${ascii.INFO} ${msg}`);
		}
	};

	verbose(`Attempting to test ${JSON.stringify(blockNames)}`);

	const config = getProjectConfig(options.cwd).match(
		(val) => val,
		(err) => program.error(color.red(err))
	);

	const loading = spinner();

	let repoPaths = config.repos;

	// we just want to override all others if supplied via the CLI
	if (options.repo) repoPaths = [options.repo];

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

	if (!options.verbose) loading.start(`Fetching blocks from ${color.cyan(repoPaths.join(', '))}`);

	const resolvedRepos: registry.RegistryProviderState[] = (
		await registry.forEachPathGetProviderState(...repoPaths)
	).match(
		(val) => val,
		({ repo, message }) => {
			loading.stop(`Failed to get info for ${color.cyan(repo)}`);
			program.error(color.red(message));
		}
	);

	verbose(`Resolved ${color.cyan(repoPaths.join(', '))}`);

	verbose(`Fetching blocks from ${color.cyan(repoPaths.join(', '))}`);

	if (!options.verbose) loading.start(`Fetching blocks from ${color.cyan(repoPaths.join(', '))}`);

	const blocksMap: Map<string, registry.RemoteBlock> = (
		await registry.fetchBlocks(...resolvedRepos)
	).match(
		(val) => val,
		({ repo, message }) => {
			loading.stop(`Failed fetching blocks from ${color.cyan(repo)}`);
			program.error(color.red(message));
		}
	);

	verbose(`Retrieved blocks from ${color.cyan(repoPaths.join(', '))}`);

	if (!options.verbose) loading.stop(`Retrieved blocks from ${color.cyan(repoPaths.join(', '))}`);

	const tempTestDirectory = path.resolve(
		path.join(options.cwd, `blocks-tests-temp-${Date.now()}`)
	);

	verbose(`Trying to create the temp directory ${color.bold(tempTestDirectory)}.`);

	fs.mkdirSync(tempTestDirectory, { recursive: true });

	const cleanUp = () => {
		fs.rmSync(tempTestDirectory, { recursive: true, force: true });
	};

	const installedBlocks = getInstalled(blocksMap, config, options.cwd).map(
		(val) => val.specifier
	);

	let testingBlocks = blockNames;

	// in the case that we want to test all files
	if (blockNames.length === 0) {
		testingBlocks = installedBlocks;
	}

	if (testingBlocks.length === 0) {
		cleanUp();
		program.error(color.red('There were no blocks found in your project!'));
	}

	const testingBlocksMapped: { name: string; block: registry.RemoteBlock }[] = [];

	for (const blockSpecifier of testingBlocks) {
		let block: registry.RemoteBlock | undefined = undefined;

		const provider = registry.selectProvider(blockSpecifier);

		// if the block starts with github (or another provider) we know it has been resolved
		if (!provider) {
			for (const repo of repoPaths) {
				// we unwrap because we already checked this
				const provider = registry.selectProvider(repo);

				if (!provider) continue;

				const { url: parsedRepo, specifier } = provider.parse(
					url.join(repo, blockSpecifier),
					{ fullyQualified: true }
				);

				const tempBlock = blocksMap.get(url.join(parsedRepo, specifier!));

				if (tempBlock === undefined) continue;

				block = tempBlock;

				break;
			}
		} else {
			const { url: repo } = provider.parse(blockSpecifier, { fullyQualified: true });

			const providerState = (await registry.getProviderState(repo)).match(
				(val) => val,
				(err) => program.error(color.red(err))
			);

			const map = (await registry.fetchBlocks(providerState)).match(
				(val) => val,
				(err) => program.error(color.red(err))
			);

			for (const [k, v] of map) {
				blocksMap.set(k, v);
			}

			block = blocksMap.get(blockSpecifier);
		}

		if (!block) {
			program.error(
				color.red(`Invalid block! ${color.bold(blockSpecifier)} does not exist!`)
			);
		}

		testingBlocksMapped.push({ name: blockSpecifier, block });
	}

	const resolvedPathsResult = resolvePaths(config.paths, options.cwd);

	if (resolvedPathsResult.isErr()) {
		program.error(color.red(resolvedPathsResult.unwrapErr()));
	}

	const resolvedPaths = resolvedPathsResult.unwrap();

	for (const { block } of testingBlocksMapped) {
		const providerState = block.sourceRepo;

		const fullSpecifier = url.join(block.sourceRepo.url, block.category, block.name);

		if (!options.verbose) {
			loading.start(`Setting up test file for ${color.cyan(fullSpecifier)}`);
		}

		if (!block.tests) {
			loading.stop(`No tests found for ${color.cyan(fullSpecifier)}`);
			continue;
		}

		let directory = getPathForBlock(block, resolvedPaths, options.cwd);

		directory = path.relative(tempTestDirectory, directory);

		const getSourceFile = async (filePath: string) => {
			const content = await registry.fetchRaw(providerState, filePath);

			if (content.isErr()) {
				loading.stop(color.red(`Error fetching ${color.bold(filePath)}`));
				program.error(color.red(`There was an error trying to get ${fullSpecifier}`));
			}

			return content.unwrap();
		};

		verbose(`Downloading and copying test files for ${fullSpecifier}`);

		const testFiles: string[] = [];

		for (const testFile of block.files.filter((file) => isTestFile(file))) {
			const content = await getSourceFile(path.join(block.directory, testFile));

			const destPath = path.join(tempTestDirectory, testFile);

			fs.writeFileSync(destPath, content);

			testFiles.push(destPath);
		}

		const project = new Project();

		// resolve imports for the block
		for (const file of testFiles) {
			verbose(`Opening test file ${file}`);

			const tempFile = project.addSourceFileAtPath(file);

			for (const importDeclaration of tempFile.getImportDeclarations()) {
				const moduleSpecifier = importDeclaration.getModuleSpecifierValue();

				let newModuleSpecifier: string | undefined = undefined;

				// if the module is relative resolve it relative to the new path of the tests
				if (moduleSpecifier.startsWith('.')) {
					if (block.subdirectory) {
						newModuleSpecifier = path.join(directory, block.name, moduleSpecifier);
					} else {
						newModuleSpecifier = path.join(directory, moduleSpecifier);
					}
				}

				if (newModuleSpecifier) {
					// we need to add the replace so that paths are correctly translated on windows
					importDeclaration.setModuleSpecifier(newModuleSpecifier.replaceAll(/\\/g, '/'));
				}
			}
		}

		project.saveSync();

		verbose(`Completed ${color.cyan.bold(fullSpecifier)} test file`);

		if (!options.verbose) {
			loading.stop(`Completed setup for ${color.bold(fullSpecifier)}`);
		}
	}

	verbose('Beginning testing');

	const pm = await detect({ cwd: options.cwd });

	if (pm == null) {
		program.error(color.red('Could not detect package manager'));
	}

	const resolved = resolveCommand(pm.agent, 'execute', ['vitest', 'run', tempTestDirectory]);

	if (resolved == null) {
		program.error(color.red(`Could not resolve add command for '${pm.agent}'.`));
	}

	const testCommand = `${resolved.command} ${resolved.args.join(' ')}`;

	verbose(`Running ${color.cyan(testCommand)} on ${color.cyan(options.cwd)}`);

	try {
		await execa(resolved.command, resolved.args, {
			cwd: options.cwd,
			stdin: process.stdin,
			stdout: process.stdout,
		});

		cleanUp();
	} catch (err) {
		if (options.debug) {
			console.info(
				`${color.bold('--debug')} flag provided. Skipping cleanup. Run '${color.bold(
					testCommand
				)}' to retry tests.\n`
			);
		} else {
			cleanUp();
		}

		program.error(color.red(`Tests failed! Error ${err}`));
	}
};

export { test };
