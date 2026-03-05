# Svelte Adapter (`@flockjs/svelte`)

Audience: users.

## Store and Action Usage

```svelte
<script lang="ts">
  import { flock } from '@flockjs/svelte';

  const { cursors, presence, state, events, awareness } = flock('my-room', {
    presence: { name: 'Alice', color: '#4F46E5' },
    transport: 'auto',
  });

  const [votes, setVotes] = state.shared('votes', { yes: 0, no: 0 });
</script>

<div use:cursors.mount>
  {#each $presence.others as user}
    <p>{user.name} is online</p>
  {/each}

  {#each $cursors as cursor}
    <p>{cursor.name}</p>
  {/each}

  <button on:click={() => setVotes((v) => ({ ...v, yes: v.yes + 1 }))}>
    Vote Yes
  </button>
</div>
```

## Integration Notes

- Uses Svelte stores for reactive state.
- Uses Svelte actions for mount/unmount lifecycle.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Quickstart](../getting-started/quickstart.md)
- [Docs index](../README.md)
