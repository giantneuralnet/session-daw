declare module "*?worker&url" {
  const url: string;
  export default url;
}
interface ImportMeta {
  readonly env: { readonly PROD: boolean };
}
