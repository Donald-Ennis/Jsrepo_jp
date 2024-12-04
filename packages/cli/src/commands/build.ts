import fs from 'node:fs';
import { outro, spinner } from '@clack/prompts';
import color from 'chalk';
import { Command, program } from 'commander';
import path from 'pathe';
import * as v from 'valibot';
import { context } from '..';
import * as ascii from '../utils/ascii';
import { type Category, buildBlocksDirectory } from '../utils/build';
import { type RegistryConfig, getRegistryConfig } from '../utils/config';
import { OUTPUT_FILE } from '../utils/context';
import { intro } from '../utils/prompts';

const schema = v.object({
	dirs: v.optional(v.array(v.string())),
	includeBlocks: v.optional(v.array(v.string())),
	includeCategories: v.optional(v.array(v.string())),
	excludeDeps: v.optional(v.array(v.string())),
	doNotListBlocks: v.optional(v.array(v.string())),
	doNotListCategories: v.optional(v.array(v.string())),
	output: v.boolean(),
	errorOnWarn: v.boolean(),
	verbose: v.boolean(),
	cwd: v.string(),
});

type Options = v.InferInput<typeof schema>;

const build = new Command('build')
	.description(`Builds the provided --dirs in the project root into a \`${OUTPUT_FILE}\` file.`)
	.option('--dirs [dirs...]', 'The directories containing the blocks.')
	.option('--include-blocks [blockNames...]', 'Include only the blocks with these names.')
	.option(
		'--include-categories [categoryNames...]',
		'Include only the categories with these names.'
	)
	.option(
		'--do-not-list-blocks',
		"The names of blocks that shouldn't be listed when the user runs add."
	)
	.option(
		'--do-not-list-categories',
		"The names of categories that shouldn't be listed when the user runs add."
	)
	.option('--exclude-deps [deps...]', 'Dependencies that should not be added.')
	.option('--no-output', `Do not output a \`${OUTPUT_FILE}\` file.`)
	.option(
		'--error-on-warn',
		'If there is a warning throw an error and do not allow build to complete.',
		false
	)
	.option('--verbose', 'Include debug logs.', false)
	.option('--cwd <path>', 'The current working directory.', process.cwd())
	.action(async (opts) => {
		const options = v.parse(schema, opts);

		intro(context.package.version);

		await _build(options);

		outro(color.green('All done!'));
	});

const _build = async (options: Options) => {
	const loading = spinner();

	const categories: Category[] = [];

	const config: RegistryConfig = getRegistryConfig(options.cwd).match(
		(val) => {
			if (val === null) {
				return {
					$schema: '',
					dirs: options.dirs ?? [],
					doNotListBlocks: options.doNotListBlocks ?? [],
					doNotListCategories: options.doNotListCategories ?? [],
					errorOnWarn: options.errorOnWarn,
					excludeDeps: options.excludeDeps ?? [],
					includeBlocks: options.includeBlocks ?? [],
					includeCategories: options.includeCategories ?? [],
					output: options.output,
				} satisfies RegistryConfig;
			}

			const mergedVal = val;

			// overwrites config with flag values

			if (options.dirs) mergedVal.dirs = options.dirs;
			if (options.doNotListBlocks) mergedVal.doNotListBlocks = options.doNotListBlocks;
			if (options.doNotListCategories)
				mergedVal.doNotListCategories = options.doNotListCategories;
			if (options.includeBlocks) mergedVal.includeBlocks = options.includeBlocks;
			if (options.includeCategories) mergedVal.includeCategories = options.includeCategories;
			if (options.excludeDeps) mergedVal.excludeDeps = options.excludeDeps;

			mergedVal.errorOnWarn = options.errorOnWarn;
			mergedVal.output = options.output;

			return mergedVal;
		},
		(err) => program.error(color.red(err))
	);

	const outFile = path.join(options.cwd, OUTPUT_FILE);

	for (const dir of config.dirs) {
		const dirPath = path.join(options.cwd, dir);

		loading.start(`Building ${color.cyan(dirPath)}`);

		if (config.output && fs.existsSync(outFile)) fs.rmSync(outFile);

		const builtCategories = buildBlocksDirectory(dirPath, { cwd: options.cwd, config });

		for (const category of builtCategories) {
			if (categories.find((cat) => cat.name === category.name) !== undefined) {
				const error = 'a category with the same name already exists!';

				if (config.errorOnWarn) {
					program.error(
						color.red(
							`\`${color.bold(`${dir}/${category.name}`)}\` could not be added because ${error}`
						)
					);
				} else {
					console.warn(
						`${ascii.VERTICAL_LINE}  ${ascii.WARN} Skipped adding \`${color.cyan(`${dir}/${category.name}`)}\` because ${error}`
					);
				}
				continue;
			}

			categories.push(category);
		}

		loading.stop(`Built ${color.cyan(dirPath)}`);
	}

	loading.start('Checking manifest');

	const warnings: string[] = [];

	for (const category of categories) {
		for (const block of category.blocks) {
			// lookup local deps
			for (const dep of block.localDependencies) {
				const [depCategoryName, depBlockName] = dep.split('/');

				const depCategory = categories.find(
					(cat) => cat.name.trim() === depCategoryName.trim()
				);

				const invalidDependencyError = () => {
					const error = `depends on ${color.bold(dep)} which doesn't exist!`;

					if (config.errorOnWarn) {
						warnings.push(
							color.red(`${color.bold(`${category.name}/${block.name}`)} ${error}`)
						);
					} else {
						warnings.push(
							`${ascii.VERTICAL_LINE}  ${ascii.WARN} ${color.bold(`${category.name}/${block.name}`)} ${error}`
						);
					}
				};

				if (!depCategory) {
					invalidDependencyError();
					continue;
				}

				if (depCategory.blocks.find((b) => b.name === depBlockName) === undefined) {
					invalidDependencyError();
				}
			}

			for (const dep of [...block.dependencies, ...block.devDependencies]) {
				if (!dep.includes('@')) {
					const error = `You haven't installed ${color.bold(dep)} as a dependency so your users could get any version of it when they install your block!`;

					if (config.errorOnWarn) {
						warnings.push(color.red(error));
					} else {
						warnings.push(`${ascii.VERTICAL_LINE}  ${ascii.WARN} ${error}`);
					}
				}
			}
		}
	}

	loading.stop('Completed checking manifest.');

	if (warnings.length > 0) {
		for (const warning of warnings) {
			console.log(warning);
		}

		if (config.errorOnWarn) {
			program.error('Had warnings while checking manifest.');
		}
	}

	if (config.output) {
		loading.start(`Writing output to \`${color.cyan(outFile)}\``);

		fs.writeFileSync(outFile, JSON.stringify(categories, null, '\t'));

		loading.stop(`Wrote output to \`${color.cyan(outFile)}\``);
	}
};

export { build };
