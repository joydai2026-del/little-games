// Vite's ?raw imports, used by tests to load committed fixtures byte-for-byte.
declare module '*?raw' {
  const content: string;
  export default content;
}
