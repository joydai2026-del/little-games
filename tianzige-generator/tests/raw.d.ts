// Vite's `?raw` import (the exact file bytes as a string), for the worker
// tests, which do not load vite/client types.
declare module '*?raw' {
  const content: string;
  export default content;
}
