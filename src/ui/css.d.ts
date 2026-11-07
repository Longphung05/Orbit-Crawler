// Vite's `?inline` suffix imports a stylesheet as a string (no extra file is emitted or fetched).
declare module '*.css?inline' {
  const css: string;
  export default css;
}
