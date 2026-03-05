# Vue Adapter (`@flockjs/vue`)

Audience: users.

## Plugin Setup

```ts
import { createApp } from 'vue';
import { FlockPlugin } from '@flockjs/vue';
import App from './App.vue';

const app = createApp(App);

app.use(FlockPlugin, {
  roomId: 'my-room',
  presence: { name: 'Alice', color: '#4F46E5' },
  transport: 'auto',
});

app.mount('#app');
```

## Composables Example

```vue
<script setup lang="ts">
import { usePresence, useCursors, useSharedState, useEvent } from '@flockjs/vue';

const { self, others } = usePresence();
const { ref: boardRef, cursors } = useCursors();

const [gameState, setGameState] = useSharedState('game', {
  initialValue: { phase: 'lobby', players: [] },
  strategy: 'lww',
});

const emitReaction = useEvent('reaction', (data, from) => {
  console.log('reaction from', from.name, data);
});
</script>
```

## Integration Notes

- Designed for Vue 3 composable patterns.
- Plugin boundary manages room lifecycle and cleanup.

## Related Docs

- [Reference index](README.md)
- [Core API](core-api.md)
- [State, awareness, events](engines-state-awareness-events.md)
- [Quickstart](../getting-started/quickstart.md)
- [Docs index](../README.md)
