// Vite's `?raw` suffix imports a file as its text. The mark's drawing (docs/media/mark.svg) is read this way, so the lab holds no copy of it (B1, Mark.tsx).
declare module "*.svg?raw" {
  const text: string;
  export default text;
}
