// Allow side-effect imports of plain CSS files (used by Next.js for global styles).
declare module '*.css' {
  const styles: { readonly [key: string]: string }
  export default styles
}
