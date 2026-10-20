// Vercel entry point: every path is rewritten here (vercel.json), so the same handler
// serves the static files, security headers and API on Vercel as it does everywhere else.
import { makeHandler } from '../server.js';

export default makeHandler();
