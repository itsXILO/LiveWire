import arcjet, {detectBot, shield, slidingWindow} from "@arcjet/node";

const arcjetKey = process.env.ARCJET_KEY;
const arcjetMode = process.env.ARCJET_MODE === 'DRY_RUN' ? 'DRY_RUN' : 'LIVE';

if(!arcjetKey) throw new Error('ARCJET_KEY environment variable is missing.');

export const httpArcjet = arcjetKey ?
  arcjet({
    key: arcjetKey,
    rules: [
      shield({ mode: arcjetMode }),
      detectBot({ mode: arcjetMode, allow: ['CATEGORY:SEARCH_ENGINE', 'CATEGORY:PREVIEW'] }),
      slidingWindow({ mode: arcjetMode, interval: '10s', max: 50 })
    ],
  }) : null;

export const wsArcjet = arcjetKey ?
  arcjet({
  }) : null;
