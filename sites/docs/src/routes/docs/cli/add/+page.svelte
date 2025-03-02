<script lang="ts">
	import { CodeSpan, DocHeader, SubHeading } from '$lib/components/site/docs';
	import { Snippet } from '$lib/components/ui/snippet';
	import OptionDocs from '../option-docs.svelte';
</script>

<DocHeader title="add" description="Add blocks to your project." />
<Snippet command="execute" args={['jsrepo', 'add']} />
<SubHeading>Usage</SubHeading>
<p>
	Choose a block to add from the registries in your <CodeSpan>jsrepo.json</CodeSpan> file.
</p>
<Snippet command="execute" args={['jsrepo', 'add']} />
<p>
	Add a partially qualified block using the registries in your <CodeSpan>jsrepo.json</CodeSpan> file.
</p>
<Snippet command="execute" args={['jsrepo', 'add', 'utils/math']} />
<p>Add a fully qualified block.</p>
<Snippet command="execute" args={['jsrepo', 'add', 'github/ieedan/std/utils/math']} />
<p>Include another registry in the blocks list.</p>
<Snippet command="execute" args={['jsrepo', 'add', '--repo', 'github/ieedan/std']} />
<SubHeading>Options</SubHeading>
<OptionDocs name="--repo">
	{#snippet description()}
		The repository to download the blocks from.
	{/snippet}
	{#snippet usage()}
		<Snippet command="execute" args={['jsrepo', 'add', '--repo', 'github/ieedan/std']} />
	{/snippet}
</OptionDocs>
<OptionDocs name="-A, --allow">
	{#snippet description()}
		Allow jsrepo to download code from the provided repo. This skips the initial confirmation prompt
		when attempting to download a block from a registry not listed in the
		<CodeSpan>jsrepo.json</CodeSpan> file.
	{/snippet}
	{#snippet usage()}
		<Snippet
			command="execute"
			args={['jsrepo', 'add', 'github/ieedan/std/utils/math', '--allow']}
		/>
	{/snippet}
</OptionDocs>
<OptionDocs name="-y, --yes">
	{#snippet description()}
		Skips confirmation prompts. (Not including permissions prompts)
	{/snippet}
	{#snippet usage()}
		<Snippet command="execute" args={['jsrepo', 'add', '--yes']} />
	{/snippet}
</OptionDocs>
<OptionDocs name="--verbose">
	{#snippet description()}
		More verbose logging. (May be used to troubleshoot issues)
	{/snippet}
	{#snippet usage()}
		<Snippet command="execute" args={['jsrepo', 'add', '--verbose']} />
	{/snippet}
</OptionDocs>
<OptionDocs name="--cwd">
	{#snippet description()}
		Run the current command on the provided directory absolute or relative.
	{/snippet}
	{#snippet usage()}
		<Snippet command="execute" args={['jsrepo', 'add', '--cwd', './sites/docs']} />
	{/snippet}
</OptionDocs>
<OptionDocs name="-h, --help">
	{#snippet description()}
		Help with the command.
	{/snippet}
	{#snippet usage()}
		<Snippet command="execute" args={['jsrepo', 'add', '--help']} />
	{/snippet}
</OptionDocs>
