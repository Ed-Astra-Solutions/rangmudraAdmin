// Admin panel runtime config.
//
// RANGMUDRA_API_BASE is the origin of the backend API.
//   - Leave empty ('') when the admin is served BY the backend itself
//     (e.g. EC2 at https://your-domain/admin/) — requests go to the same origin.
//   - Set it to the backend's full HTTPS origin when the admin is hosted
//     elsewhere (e.g. GitHub Pages), so the SPA calls the EC2 API cross-origin:
//       window.RANGMUDRA_API_BASE = 'https://api.rangmudra.com';
//
// NOTE: GitHub Pages is served over HTTPS, so the API base MUST be https://
// (a plain http:// EC2 endpoint will be blocked by the browser as mixed content).
// The backend must also list this page's origin in its CORS_ORIGINS env var.
window.RANGMUDRA_API_BASE = 'https://api.rangmudra.com';
