import { createApp } from './app.js';

const apps = new WeakMap();

export default {
  async fetch(request, env, ctx) {
    let app = apps.get(env);
    if (!app) {
      app = createApp(env);
      apps.set(env, app);
    }
    return app(request, env, ctx);
  },
};
