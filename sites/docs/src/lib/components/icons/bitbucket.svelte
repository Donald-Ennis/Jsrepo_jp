<script lang="ts">
	import type { Props } from '.';
	import { cn } from '$lib/utils';

	let { class: className, ...rest }: Props = $props();
</script>

<svg
	class={cn('size-4', className)}
	viewBox="0 0 32 32"
	fill="none"
	xmlns="http://www.w3.org/2000/svg"
	{...rest}
>
	<path
		d="M4.77044 5C4.29089 5 3.93123 5.43959 4.01115 5.87918L7.24814 25.7007C7.32806 26.2203 7.76766 26.5799 8.28717 26.5799H23.9526C24.3123 26.5799 24.632 26.3002 24.7119 25.9405L27.9888 5.91915C28.0688 5.43959 27.7091 5.03997 27.2296 5.03997L4.77044 5ZM18.5177 19.3067H13.5223L12.2035 12.2333H19.7565L18.5177 19.3067Z"
		fill="#2684FF"
	/>
	<path
		d="M26.9098 12.2333H19.7165L18.5176 19.3067H13.5222L7.64771 26.3002C7.64771 26.3002 7.92744 26.54 8.32707 26.54H23.9925C24.3522 26.54 24.6719 26.2602 24.7518 25.9005L26.9098 12.2333Z"
		fill="url(#paint0_linear)"
	/>
	<defs>
		<linearGradient
			id="paint0_linear"
			x1="28.5925"
			y1="14.2265"
			x2="16.672"
			y2="23.5316"
			gradientUnits="userSpaceOnUse"
		>
			<stop offset="0.176" stop-color="#0052CC" />
			<stop offset="1" stop-color="#2684FF" />
		</linearGradient>
	</defs>
</svg>
