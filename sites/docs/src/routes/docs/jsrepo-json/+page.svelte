<script lang="ts">
	import { CodeSpan, DocHeader, Jsrepo, Link, SubHeading } from '$lib/components/site/docs';
	import { Code } from '$lib/components/ui/code';
	import { Snippet } from '$lib/components/ui/snippet';

	let { data } = $props();
</script>

<DocHeader title="jsrepo.json" description="Configuration for your project." />
<p>
	<CodeSpan>jsrepo.json</CodeSpan> holds the configuration for your project.
</p>
<p>
	You can create a <CodeSpan>jsrepo.json</CodeSpan> by running the init command with the
	<CodeSpan>--project</CodeSpan> flag:
</p>
<Snippet command="execute" args={['jsrepo', 'init', '--project']} />
<SubHeading>$schema</SubHeading>
<p>
	<CodeSpan>$schema</CodeSpan> is tracked with the cli so you can use a specific version using
	<CodeSpan>unpkg</CodeSpan>:
</p>
<Code
	lang="json"
	code={`{
    "$schema": "https://unpkg.com/jsrepo@${data.version}/schemas/project-config.json"
}`}
/>
<SubHeading>repos</SubHeading>
<p>
	<CodeSpan>repos</CodeSpan> allows you to specify different registries to install blocks from. All of
	the blocks from each registry will be listed when you run <CodeSpan>add</CodeSpan>.
</p>
<Code
	lang="json"
	code={`{
    "repos": [
        "gitlab/ieedan/std",
        "github/ieedan/shadcn-phone-input-svelte"
    ]
}`}
/>
<SubHeading>paths</SubHeading>
<p>Where to add specific categories in your project.</p>
<Code
	lang="json"
	code={`{
	  "paths": {
		  // "*" is required as a fallback location if a category isn't mapped
		  "*": "./src/blocks", 
		  "components": "$lib/components",
		  "hooks": "$lib/hooks"
	  }
}`}
/>
<SubHeading>configFiles</SubHeading>
<p>Where to add specific config files in your project.</p>
<Code
	lang="json"
	code={`{
	  "configFiles": {
		  "app.css": "./src/app.css"
	  }
}`}
/>
<SubHeading>includeTests</SubHeading>
<p>Whether or not to include test files when installing blocks.</p>
<Code
	lang="json"
	code={`{
    "includeTests": false
}`}
/>
<SubHeading>watermark</SubHeading>
<p>Whether or not to add a watermark to installed blocks.</p>
<Code
	lang="json"
	code={`{
    "watermark": true
}`}
/>
<p>
	When true adds a watermark with the jsrepo version repository it was added from and the date it
	was added on.
</p>
<Code
	lang="typescript"
	code={`/*
	jsrepo ${data.version}
	Installed from github/ieedan/std
	${new Date().toLocaleDateString().replaceAll('/', '-')}
*/

export type Point = {
		x: number;
		y: number;
};`}
/>

<SubHeading>formatter</SubHeading>
<p>The formatter to use when writing files in your project.</p>
<Code
	lang="json"
	code={`{
    "formatter": "prettier" / "biome" / undefined
}`}
/>
<p>
	<Jsrepo /> can format your files following your local config before adding them to your repository.
	Currently the only supported formatters are
	<Link target="_blank" href="https://prettier.io/">Prettier</Link> and
	<Link target="_blank" href="https://biomejs.dev/">Biome</Link>.
</p>
