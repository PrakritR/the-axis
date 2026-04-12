// Vercel discovers serverless functions in api/ at the project root.
// The actual implementation lives in backend/api/ alongside its server modules.
export { default } from '../backend/api/[route].js'
