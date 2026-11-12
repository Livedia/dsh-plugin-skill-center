import { createSkillCenter, makeHttpHandler } from './lib/api.js';
import { defaultConfigFile } from './lib/config.js';

export const name = 'skill-center';
export const inject = ['webServer'];

export function apply(ctx) {
  const sc = createSkillCenter({ configFile: defaultConfigFile() });
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: '/skill-center-api',
    handler: makeHttpHandler(sc),
  });
  ctx.effect(() => dispose, 'skill-center: /skill-center-api routes');
}
